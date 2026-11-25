import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const errors = [];
const warnings = [];

console.log("=== Taqdiri Cloud Release Preflight Check ===");

// 1. Validate unique, ordered numeric prefixes on supabase/migrations/*.sql
const migDir = path.join(root, "supabase", "migrations");
const migFiles = fs
  .readdirSync(migDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const seenPrefixes = new Map();
let prevPrefixNum = -1n;
for (const f of migFiles) {
  const prefix = f.split("_")[0];
  if (!/^\d+$/.test(prefix)) {
    errors.push(`Migration filename missing numeric version prefix before '_': ${f}`);
    continue;
  }
  if (seenPrefixes.has(prefix)) {
    errors.push(`Duplicate Supabase migration version prefix '${prefix}': ${seenPrefixes.get(prefix)} AND ${f}`);
  } else {
    seenPrefixes.set(prefix, f);
  }
  const num = BigInt(prefix);
  if (num <= prevPrefixNum) {
    warnings.push(`Migration numeric prefix ${prefix} (${f}) is not strictly greater than previous ${prevPrefixNum}`);
  }
  prevPrefixNum = num;
}
console.log(`Migrations checked (${migFiles.length}): ${migFiles.join(", ")}`);

// 2. Compare supabase/config.toml vs .env target ref
const configTomlPath = path.join(root, "supabase", "config.toml");
const envPath = path.join(root, ".env");
let tomlRef = null;
if (fs.existsSync(configTomlPath)) {
  const m = fs.readFileSync(configTomlPath, "utf8").match(/project_id\s*=\s*"([^"]+)"/);
  tomlRef = m?.[1] ?? null;
}
let envUrlRef = null;
if (fs.existsSync(envPath)) {
  const m = fs.readFileSync(envPath, "utf8").match(/VITE_SUPABASE_URL\s*=\s*https?:\/\/([a-z0-9-]+)\.supabase\.co/i);
  envUrlRef = m?.[1] ?? null;
} else if (process.env.VITE_SUPABASE_URL) {
  const m = process.env.VITE_SUPABASE_URL.match(/https?:\/\/([a-z0-9-]+)\.supabase\.co/i);
  envUrlRef = m?.[1] ?? null;
}

if (tomlRef && envUrlRef && tomlRef !== envUrlRef) {
  warnings.push(
    `supabase/config.toml project_id='${tomlRef}' differs from .env/VITE_SUPABASE_URL ref='${envUrlRef}'. Verify linked project explicitly with 'supabase link --project-ref <TARGET_REF>' before running 'supabase db push'.`,
  );
}

// 3. Enforce explicit target check when REQUIRE_EXPLICIT_SUPABASE=true
if (process.env.REQUIRE_EXPLICIT_SUPABASE === "true" || process.env.VITE_REQUIRE_EXPLICIT_SUPABASE === "true") {
  if (!process.env.VITE_SUPABASE_URL || !process.env.VITE_SUPABASE_PUBLISHABLE_KEY) {
    errors.push("REQUIRE_EXPLICIT_SUPABASE=true requires VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to be set.");
  }
}

// 4. Verify critical server/edge files exist and aren't missing from build graph
const requiredFiles = [
  "src/lib/ai-estimation-fn.ts",
  "supabase/functions/ai-estimation/index.ts",
  "supabase/migrations/20261124_001_independence_schema_and_rls.sql",
  "supabase/migrations/20261125000002_csi_01_10_assemblies_and_quotes.sql",
  "supabase/migrations/20261125000003_v2_excel_tender_rfi_ai.sql",
  "supabase/migrations/20261126000004_rls_completeness_and_atomic_submit_rpc.sql",
];
for (const rel of requiredFiles) {
  if (!fs.existsSync(path.join(root, rel))) {
    errors.push(`Missing required release file: ${rel}`);
  }
}

for (const w of warnings) console.warn(`[WARN] ${w}`);
if (errors.length > 0) {
  for (const e of errors) console.error(`[FAIL] ${e}`);
  process.exit(1);
}
console.log("=== Preflight Check PASSED (0 blocking issues) ===");
