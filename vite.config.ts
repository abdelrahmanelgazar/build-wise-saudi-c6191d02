import { defineConfig, loadEnv } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { localEstimationDb } from "./scripts/local-estimation-db";

export default defineConfig(async ({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const envDefine: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    envDefine[`import.meta.env.${key}`] = JSON.stringify(value);
  }

  const plugins: any[] = [
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tailwindcss(),
    tanstackStart({
      server: { entry: "server" },
    }),
  ];

  if (command === "build") {
    const { nitro } = await import("nitro/vite");
    plugins.push(
      nitro({
        preset: process.env["NITRO_PRESET"] || "cloudflare-module",
        cloudflare: {
          nodeCompat: true,
          deployConfig: true,
        },
      } as any),
    );
  }

  plugins.push(viteReact() as any, localEstimationDb() as any);

  return {
    base: "./",
    define: envDefine,
    css: { transformer: "lightningcss" as const },
    resolve: {
      alias: { "@": `${process.cwd()}/src` },
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
      ignoreOutdatedRequests: true,
    },
    server: {
      host: "127.0.0.1",
      port: 8080,
      strictPort: false,
      watch: { ignored: ["**/data/*.sqlite*", "**/src/routeTree.gen.ts"] },
      fs: { deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/*.sqlite*"] },
    },
    plugins,
  };
});
