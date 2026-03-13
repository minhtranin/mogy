export interface KeyBindingMap {
  runQuery: string;
  focusEditor: string;
  focusResults: string;
  nextPage: string;
  prevPage: string;
  firstPage: string;
  lastPage: string;
  tableView: string;
  jsonView: string;
  showHelp: string;
  leader: string;
  "leader.connections": string;
  "leader.databases": string;
  "leader.collections": string;
  "leader.maximize": string;
  "leader.loadFile": string;
  "leader.newFile": string;
}

export const DEFAULT_BINDINGS: KeyBindingMap = {
  runQuery: "ctrl+Enter",
  focusEditor: "ctrl+k",
  focusResults: "ctrl+j",
  nextPage: "ctrl+n",
  prevPage: "ctrl+p",
  firstPage: "ctrl+shift+p",
  lastPage: "ctrl+shift+n",
  tableView: "shift+h",
  jsonView: "shift+l",
  showHelp: "?",
  leader: "ctrl+space",
  "leader.connections": "a",
  "leader.databases": "d",
  "leader.collections": "o",
  "leader.maximize": "m",
  "leader.loadFile": "l",
  "leader.newFile": "c",
};

export function mergeBindings(
  defaults: KeyBindingMap,
  overrides: Partial<KeyBindingMap>
): KeyBindingMap {
  return { ...defaults, ...overrides };
}

export function matchesBinding(e: KeyboardEvent, binding: string): boolean {
  const parts = binding.split("+");
  const key = parts.pop()!;
  const mods = new Set(parts.map((m) => m.toLowerCase()));

  if (e.ctrlKey !== mods.has("ctrl")) return false;
  if (e.altKey !== mods.has("alt")) return false;
  if (e.metaKey !== mods.has("meta")) return false;

  // Special key names
  const keyLower = key.toLowerCase();
  if (keyLower === "enter") {
    if (e.key !== "Enter") return false;
  } else if (keyLower === "space") {
    if (e.key !== " ") return false;
  } else if (keyLower === "escape" || keyLower === "esc") {
    if (e.key !== "Escape") return false;
  } else {
    // For single letter keys with shift modifier, compare uppercase
    const isLetter = /^[a-zA-Z]$/.test(key);
    if (isLetter) {
      if (e.shiftKey !== mods.has("shift")) return false;
      if (mods.has("shift")) {
        if (e.key !== key.toUpperCase()) return false;
      } else {
        if (e.key.toLowerCase() !== key.toLowerCase()) return false;
      }
    } else {
      // Non-letter keys (like "?", "/", etc.) — don't enforce shift
      if (mods.has("shift") && !e.shiftKey) return false;
      if (e.key !== key) return false;
    }
  }

  return true;
}

export function matchesLeaderKey(e: KeyboardEvent, key: string): boolean {
  return e.key.toLowerCase() === key.toLowerCase() && !e.ctrlKey && !e.altKey && !e.metaKey;
}
