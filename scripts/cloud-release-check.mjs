import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const isStrict = process.argv.includes("--strict") || process.env.CI === "true";
const errors = [];
const warnings = [];

console.log(`=== Taqdiri Cloud Release Preflight Check (${isStrict ? "STRICT" : "STANDARD"}) ===`);

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
    errors.push(`Migration numeric prefix ${prefix} (${f}) is not strictly greater than previous ${prevPrefixNum}`);
  }
  prevPrefixNum = num;
}
console.log(`Migrations checked (${migFiles.length}): ${migFiles.join(", ")}`);

// 2. Compare supabase/config.toml vs VITE_SUPABASE_URL & VITE_SUPABASE_PROJECT_ID (fail on mismatch)
const configTomlPath = path.join(root, "supabase", "config.toml");
const envPath = path.join(root, ".env");
let tomlRef = null;
if (fs.existsSync(configTomlPath)) {
  const m = fs.readFileSync(configTomlPath, "utf8").match(/project_id\s*=\s*"([^"]+)"/);
  tomlRef = m?.[1]?.trim() ?? null;
}

let envUrl = process.env.VITE_SUPABASE_URL || "";
let envProjectId = process.env.VITE_SUPABASE_PROJECT_ID || process.env.SUPABASE_PROJECT_ID || "";
if ((!envUrl || !envProjectId) && fs.existsSync(envPath)) {
  const rawEnv = fs.readFileSync(envPath, "utf8");
  if (!envUrl) {
    envUrl = rawEnv.match(/^\s*VITE_SUPABASE_URL\s*=\s*(.+)$/m)?.[1]?.trim() || "";
  }
  if (!envProjectId) {
    envProjectId = rawEnv.match(/^\s*(?:VITE_)?SUPABASE_PROJECT_ID\s*=\s*(.+)$/m)?.[1]?.trim() || "";
  }
}

const urlRef = envUrl.match(/https?:\/\/([a-z0-9-]+)\.supabase\.co/i)?.[1] ?? null;

if (!tomlRef) {
  errors.push("supabase/config.toml is missing an explicit project_id.");
}
if (tomlRef && urlRef && tomlRef !== urlRef) {
  errors.push(
    `Supabase target mismatch: supabase/config.toml project_id='${tomlRef}' does not match VITE_SUPABASE_URL ref='${urlRef}'.`,
  );
}
if (tomlRef && envProjectId && tomlRef !== envProjectId) {
  errors.push(
    `Supabase target mismatch: supabase/config.toml project_id='${tomlRef}' does not match SUPABASE_PROJECT_ID='${envProjectId}'.`,
  );
}
if (urlRef && envProjectId && urlRef !== envProjectId) {
  errors.push(
    `Supabase target mismatch: VITE_SUPABASE_URL ref='${urlRef}' does not match SUPABASE_PROJECT_ID='${envProjectId}'.`,
  );
}

// 3. Enforce explicit credentials & lockfile checks
if (process.env.REQUIRE_EXPLICIT_SUPABASE === "true" || process.env.VITE_REQUIRE_EXPLICIT_SUPABASE === "true") {
  if (!process.env.VITE_SUPABASE_URL || !process.env.VITE_SUPABASE_PUBLISHABLE_KEY) {
    errors.push("REQUIRE_EXPLICIT_SUPABASE=true requires VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.");
  }
}

if (isStrict && !fs.existsSync(path.join(root, "package-lock.json"))) {
  warnings.push("package-lock.json not found — run 'npm install --package-lock-only' for reproducible CI builds.");
}

// 4. Verify critical server/edge/backup/pricing files exist
const requiredFiles = [
  "src/lib/ai-estimation-fn.ts",
  "src/lib/estimation-calc.ts",
  "src/lib/project-backup.ts",
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
console.log(`=== Preflight Check PASSED (${warnings.length} warning(s), 0 blocking errors) ===`);
