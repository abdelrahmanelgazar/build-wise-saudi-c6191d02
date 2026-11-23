import type { LocalQueryRequest, Row, Table } from "../../scripts/local-estimation-query";

type LocalResult = { data: unknown; count: number | null; error: { message: string } | null };
const headers = { "X-Taqdiri-Local": "1" };

async function localFetch(path: string, init?: RequestInit) {
  return fetch(`/__taqdiri_local${path}`, {
    ...init,
    headers: { ...headers, ...init?.headers },
  });
}

async function request(path: string, body: unknown): Promise<LocalResult> {
  try {
    const response = await localFetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return await response.json();
  } catch (error) {
    return { data: null, count: null, error: { message: String(error) } };
  }
}

let settings: Record<string, string> = {};
let settingsPromise: Promise<void> | undefined;

export function loadLocalSettings() {
  settingsPromise ??= request("/settings", {}).then(({ data, error }) => {
    if (error) {
      settingsPromise = undefined;
      throw new Error(error.message);
    }
    settings = data as Record<string, string>;
  });
  return settingsPromise;
}

export function readLocalSetting(key: string) {
  return settings[key] ?? null;
}

export async function writeLocalSetting(key: string, value: string) {
  const { error } = await request("/settings", { key, value });
  if (error) throw new Error(error.message);
  settings[key] = value;
}

class LocalQuery {
  private filters: [string, unknown][] = [];
  private orders: { column: string; ascending?: boolean; nullsFirst?: boolean }[] = [];
  private operation: "read" | "insert" | "upsert" | "update" | "delete" = "read";
  private values: Row[] = [];
  private conflict: string[] = [];
  private columns: string | undefined;
  private head = false;
  private count = false;
  private cardinality: "many" | "single" | "optional" = "many";

  constructor(private readonly table: Table) {}

  select(columns = "*", options?: { head?: boolean; count?: string }) {
    this.columns = columns;
    this.head = !!options?.head;
    this.count = !!options?.count;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }

  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) {
    this.orders.push({ column, ...options });
    return this;
  }

  insert(values: Row | Row[]) {
    this.operation = "insert";
    this.values = Array.isArray(values) ? values : [values];
    return this;
  }

  upsert(values: Row | Row[], options: { onConflict: string }) {
    this.insert(values);
    this.operation = "upsert";
    this.conflict = options.onConflict.split(",");
    return this;
  }

  update(values: Row) {
    this.operation = "update";
    this.values = [values];
    return this;
  }

  delete() {
    this.operation = "delete";
    return this;
  }

  single() {
    this.cardinality = "single";
    return this;
  }

  maybeSingle() {
    this.cardinality = "optional";
    return this;
  }

  then<T>(resolve: (result: LocalResult) => T) {
    return request("/query", this.toRequest()).then(resolve);
  }

  private toRequest(): LocalQueryRequest {
    return {
      table: this.table,
      filters: this.filters,
      orders: this.orders,
      operation: this.operation,
      values: this.values,
      conflict: this.conflict,
      ...(this.columns === undefined ? {} : { columns: this.columns }),
      head: this.head,
      count: this.count,
      cardinality: this.cardinality,
    };
  }
}

export const localEstimationStore = {
  auth: {
    async getUser() {
      return {
        data: { user: { id: "00000000-0000-4000-8000-000000000001" } },
        error: null,
      };
    },
  },
  from(table: Table) {
    return new LocalQuery(table);
  },
  storage: {
    from(bucket: string) {
      const fileUrl = (path: string) =>
        `/files?${new URLSearchParams({ path: `${bucket}/${path}` })}`;
      return {
        async upload(path: string, file: File) {
          try {
            const response = await localFetch(fileUrl(path), {
              method: "PUT",
              headers: { "Content-Type": file.type || "application/octet-stream" },
              body: file,
            });
            return await response.json();
          } catch (error) {
            return { data: null, error: { message: String(error) } };
          }
        },
        async createSignedUrl(path: string, expiresIn: number) {
          try {
            const response = await localFetch(fileUrl(path));
            if (!response.ok) throw new Error("Local file not found");
            const signedUrl = URL.createObjectURL(await response.blob());
            window.setTimeout(() => URL.revokeObjectURL(signedUrl), expiresIn * 1000);
            return { data: { signedUrl }, error: null };
          } catch (error) {
            return { data: null, error: { message: String(error) } };
          }
        },
        remove(paths: string[]) {
          return request(
            "/files/remove",
            paths.map((path) => `${bucket}/${path}`),
          );
        },
      };
    },
  },
};
