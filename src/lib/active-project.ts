import { useSyncExternalStore } from "react";
import { isLocalDevelopment } from "./local-development";

const KEY = isLocalDevelopment()
  ? "taqdiri:local-development:active-project"
  : "taqdiri:active_project_id";
const listeners = new Set<() => void>();

function getSnapshot(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(KEY);
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function setActiveProjectId(id: string | null) {
  if (typeof window === "undefined") return;
  if (id) window.localStorage.setItem(KEY, id);
  else window.localStorage.removeItem(KEY);
  listeners.forEach((cb) => cb());
}

export function useActiveProjectId(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
