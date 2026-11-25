import { useSyncExternalStore } from "react";
import { isLocalDevelopment } from "./local-development";

const KEY = isLocalDevelopment()
  ? "taqdiri:local-development:active-project"
  : "taqdiri:active_project_id";
const TENDER_KEY = isLocalDevelopment()
  ? "taqdiri:local-development:active-tender"
  : "taqdiri:active_tender_id";
const listeners = new Set<() => void>();

function getSnapshot(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(KEY);
}

function getTenderSnapshot(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TENDER_KEY);
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === TENDER_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function setActiveProjectId(id: string | null) {
  if (typeof window === "undefined") return;
  const prev = window.localStorage.getItem(KEY);
  if (id) window.localStorage.setItem(KEY, id);
  else window.localStorage.removeItem(KEY);
  // Reset active tender when switching projects so tenders never leak across projects
  if (prev !== id) {
    window.localStorage.removeItem(TENDER_KEY);
  }
  listeners.forEach((cb) => cb());
}

export function useActiveProjectId(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

export function setActiveTenderId(tenderId: string | null) {
  if (typeof window === "undefined") return;
  if (tenderId) window.localStorage.setItem(TENDER_KEY, tenderId);
  else window.localStorage.removeItem(TENDER_KEY);
  listeners.forEach((cb) => cb());
}

export function useActiveTenderId(): string | null {
  return useSyncExternalStore(subscribe, getTenderSnapshot, () => null);
}
