import { isLocalDevelopment } from "./local-development";
import { readLocalSetting, writeLocalSetting } from "./local-estimation-store";

const memoryFallbackSettings = new Map<string, string>();

function hasHttpOrigin(): boolean {
  if (typeof process !== "undefined" && Boolean(process.env?.["VITEST"])) return false;
  return typeof globalThis.location?.origin === "string" && globalThis.location.origin.startsWith("http");
}

export function readWorkspaceSetting(key: string) {
  if (!hasHttpOrigin()) return memoryFallbackSettings.get(key) ?? null;
  return isLocalDevelopment() ? readLocalSetting(key) : localStorage.getItem(key);
}

export async function writeWorkspaceSetting(key: string, value: string) {
  if (!hasHttpOrigin()) {
    memoryFallbackSettings.set(key, value);
    return;
  }
  if (isLocalDevelopment()) await writeLocalSetting(key, value);
  else localStorage.setItem(key, value);
}
