const KEY = "kelvoy.sidebar.collapsed";
type StorageAccess = () => Pick<Storage, "getItem" | "setItem">;
const browserStorage: StorageAccess = () => window.localStorage;

export function readCollapsed(storage: StorageAccess = browserStorage): boolean {
  try { return storage().getItem(KEY) === "true"; }
  catch { return false; }
}

export function saveCollapsed(value: boolean, storage: StorageAccess = browserStorage): void {
  // Private browsing or blocked storage must not prevent navigation.
  try { storage().setItem(KEY, String(value)); }
  catch { /* The preference remains usable for this session. */ }
}
