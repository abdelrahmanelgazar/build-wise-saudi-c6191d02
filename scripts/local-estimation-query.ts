export type Row = Record<string, unknown>;

const defaults = {
  projects: { status: "studying", estimated_value: 0, budget: 0 },
  resources: { unit_price: 0 },
  boq_items: {
    quantity: 0,
    material_cost: 0,
    labor_cost: 0,
    equipment_cost: 0,
    subcontractor_cost: 0,
    is_group: false,
    level: 0,
    sort_order: 0,
  },
  price_analysis_items: { quantity: 0, unit_price: 0, sort_order: 0 },
  price_analysis_markup: { indirect_pct: 0, overhead_pct: 0, risk_pct: 0, profit_pct: 0 },
  project_files: {},
  clients: { status: "active", type: "government" },
  tenders: { status: "studying", estimated_value: 0 },
  tender_transitions: {},
  companies: {},
  company_client_links: {},
  supplier_quotes: { currency: "SAR", version_no: 1, status: "quoted", vat_included: false, transport_included: true },
  supplier_quote_items: {
    pack_size: 1,
    pack_price: 0,
    unit_price: 0,
    waste_pct: 0,
    unit_conversion_factor: 1,
    vat_included: false,
    transport_included: true,
    min_order_qty: 0,
    min_order_charge: 0,
    shift_hours: 8,
  },
  assembly_coverage_records: { assembly_version: 1, coverage_status: "matched", included_scopes: [], excluded_scopes: [] },
  tender_submissions: { currency: "SAR", pricing_policy: "additive_v2", vat_rate: 15 },
  workspace_memberships: {},
};
export type Table = keyof typeof defaults;
export type LocalQueryRequest = {
  table: Table;
  filters: [string, unknown][];
  orders: { column: string; ascending?: boolean; nullsFirst?: boolean }[];
  operation: "read" | "insert" | "upsert" | "update" | "delete";
  values: Row[];
  conflict: string[];
  columns?: string;
  head: boolean;
  count: boolean;
  cardinality: "many" | "single" | "optional";
};
type Tables = Partial<Record<Table, Row[]>>;

function deleteRelatedRows(database: Tables, table: Table, rows: Row[]) {
  const ids = new Set(rows.map((row) => row["id"]));
  function remove(table: Table, column: string, values: Set<unknown>) {
    database[table] = (database[table] ?? []).filter((row) => !values.has(row[column]));
  }
  if (table === "projects") {
    for (const child of Object.keys(defaults) as Table[]) {
      if (child !== "projects") remove(child, "project_id", ids);
    }
  }
  if (table === "boq_items") {
    const items = database.boq_items ?? [];
    for (let size = -1; size !== ids.size;) {
      size = ids.size;
      for (const item of items) if (ids.has(item["parent_id"])) ids.add(item["id"]);
    }
    remove("boq_items", "id", ids);
    remove("price_analysis_items", "boq_item_id", ids);
    remove("price_analysis_markup", "boq_item_id", ids);
    remove("assembly_coverage_records", "boq_item_id", ids);
  }
  if (table === "resources") {
    for (const item of database.price_analysis_items ?? []) {
      if (ids.has(item["resource_id"])) item["resource_id"] = null;
    }
  }
  if (table === "tenders") {
    remove("tender_transitions", "tender_id", ids);
  }
}

export function executeLocalQuery(
  query: LocalQueryRequest,
  read: () => string,
  write: (data: string) => void,
) {
  try {
    if (!Object.hasOwn(defaults, query.table)) throw new Error("Unsupported local table");
    const database: Tables = JSON.parse(read());
    const tableRows = database[query.table] ?? [];
    let rows = tableRows.filter((row) =>
      query.filters.every(([column, value]) => row[column] === value),
    );
    const now = new Date().toISOString();

    if (query.operation === "insert" || query.operation === "upsert") {
      rows = query.values.map((value) => {
        const existing =
          query.operation === "upsert" &&
          tableRows.find((row) =>
            query.conflict.every(
              (column) => value[column] != null && row[column] === value[column],
            ),
          );
        if (existing) return Object.assign(existing, value, { updated_at: now });
        // Markup is keyed by the BOQ item in the hosted schema.
        const id =
          query.table === "price_analysis_markup" ? value["boq_item_id"] : crypto.randomUUID();
        const row = { id, created_at: now, updated_at: now, ...defaults[query.table], ...value };
        if (tableRows.some((entry) => entry["id"] === row["id"]))
          throw new Error("Duplicate row ID");
        tableRows.push(row);
        return row;
      });
      database[query.table] = tableRows;
    } else if (query.operation === "update") {
      if (query.table === "tender_submissions") {
        throw new Error("Submitted tender versions are immutable");
      }
      for (const row of rows) Object.assign(row, query.values[0], { updated_at: now });
    } else if (query.operation === "delete") {
      if (query.table === "tender_submissions") {
        throw new Error("Submitted tender versions cannot be deleted");
      }
      const removed = new Set(rows);
      database[query.table] = tableRows.filter((row) => !removed.has(row));
      deleteRelatedRows(database, query.table, rows);
    }

    rows.sort((left, right) => {
      for (const { column, ascending = true, nullsFirst = !ascending } of query.orders) {
        const a = left[column];
        const b = right[column];
        if (a === b || (a == null && b == null)) continue;
        if (a == null) return nullsFirst ? -1 : 1;
        if (b == null) return nullsFirst ? 1 : -1;
        const direction = ascending ? 1 : -1;
        return (
          direction *
          (typeof a === "number" && typeof b === "number"
            ? a - b
            : String(a).localeCompare(String(b)))
        );
      }
      return 0;
    });
    if (
      query.cardinality !== "many" &&
      (rows.length > 1 || (query.cardinality === "single" && !rows.length))
    ) {
      throw new Error("Expected exactly one row");
    }

    const count = query.count ? rows.length : null;
    if (query.operation !== "read") write(JSON.stringify(database));
    if (query.columns && query.columns !== "*") {
      const columns = query.columns.split(",").map((column) => column.trim());
      rows = rows.map((row) =>
        Object.fromEntries(columns.map((column) => [column, row[column] ?? null])),
      );
    }
    const data =
      query.head || (query.operation !== "read" && !query.columns)
        ? null
        : query.cardinality === "many"
          ? rows
          : (rows[0] ?? null);
    return { data, count, error: null };
  } catch (error) {
    return { data: null, count: null, error };
  }
}
