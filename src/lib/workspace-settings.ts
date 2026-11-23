import { isLocalDevelopment } from "./local-development";
import { readLocalSetting, writeLocalSetting } from "./local-estimation-store";

export function readWorkspaceSetting(key: string) {
  return isLocalDevelopment() ? readLocalSetting(key) : localStorage.getItem(key);
}

export async function writeWorkspaceSetting(key: string, value: string) {
  if (isLocalDevelopment()) await writeLocalSetting(key, value);
  else localStorage.setItem(key, value);
}
