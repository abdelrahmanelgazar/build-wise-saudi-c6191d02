import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import { executeLocalQuery, type LocalQueryRequest } from "./local-estimation-query";

const prefix = "/__taqdiri_local";

function reply(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export function localEstimationDb(): Plugin {
  return {
    name: "taqdiri-local-database",
    apply: "serve",
    async configureServer(server) {
      const { DatabaseSync } = await import("node:sqlite");
      const directory = resolve(server.config.root, "data");
      mkdirSync(directory, { recursive: true });
      const db = new DatabaseSync(resolve(directory, "taqdiri-local.sqlite"));
      db.exec(`
        PRAGMA busy_timeout = 5000;
        CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, mime TEXT NOT NULL, content BLOB NOT NULL);
      `);
      const readWorkspace = db.prepare("SELECT data FROM workspace WHERE id = 1");
      const writeWorkspace = db.prepare(
        "INSERT OR REPLACE INTO workspace (id, data) VALUES (1, ?)",
      );
      const listSettings = db.prepare("SELECT key, value FROM settings");
      const writeSetting = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
      const writeFile = db.prepare("INSERT INTO files (path, mime, content) VALUES (?, ?, ?)");
      const readFile = db.prepare("SELECT mime, content FROM files WHERE path = ?");
      const deleteFile = db.prepare("DELETE FROM files WHERE path = ?");

      server.httpServer?.once("close", () => db.close());
      server.middlewares.use(prefix, async (req, res) => {
        try {
          const host = req.headers.host ?? "";
          const origin = req.headers.origin;
          if (
            !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host) ||
            req.headers["x-taqdiri-local"] !== "1" ||
            (origin && origin !== `http://${host}`)
          ) {
            reply(res, 403, { error: { message: "Local development requests only" } });
            return;
          }
          const url = new URL(req.url ?? "/", "http://localhost");
          const path = url.searchParams.get("path");
          if (url.pathname === "/files" && path && req.method === "GET") {
            const file = readFile.get(path) as { mime: string; content: Uint8Array } | undefined;
            if (!file) {
              reply(res, 404, { error: { message: "Local file not found" } });
              return;
            }
            res.writeHead(200, { "Content-Type": file.mime, "Cache-Control": "no-store" });
            res.end(file.content);
            return;
          }
          if (url.pathname === "/files" && path && req.method === "PUT") {
            const content = await readBody(req);
            writeFile.run(path, req.headers["content-type"] ?? "application/octet-stream", content);
            reply(res, 200, { data: { path }, error: null });
            return;
          }
          if (req.method === "POST") {
            const body = JSON.parse((await readBody(req)).toString("utf8"));
            if (url.pathname === "/query") {
              const result = executeLocalQuery(
                body as LocalQueryRequest,
                () => String(readWorkspace.get()?.["data"] ?? "{}"),
                (data) => {
                  writeWorkspace.run(data);
                },
              );
              reply(res, result.error ? 400 : 200, result);
              return;
            }
            if (url.pathname === "/settings") {
              if (typeof body.key === "string" && typeof body.value === "string") {
                writeSetting.run(body.key, body.value);
              }
              const data = Object.fromEntries(
                listSettings.all().map((row) => [String(row["key"]), row["value"]]),
              );
              reply(res, 200, { data, error: null });
              return;
            }
            if (url.pathname === "/files/remove" && Array.isArray(body)) {
              for (const filePath of body) deleteFile.run(String(filePath));
              reply(res, 200, { error: null });
              return;
            }
          }
          reply(res, 404, { error: { message: "Unknown local database operation" } });
        } catch (error) {
          reply(res, 400, {
            error: { message: error instanceof Error ? error.message : String(error) },
          });
        }
      });
    },
  };
}
