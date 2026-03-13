import { Vim } from "@replit/codemirror-vim";

// Two-level callback system: detail view (VimJsonEditor) takes priority over main editor
export const editorSaveRef = { current: null as ((text: string) => void) | null };
export const detailSaveRef = { current: null as ((text: string) => void) | null };
export const quitCallbackRef = { current: null as (() => void) | null };

let defined = false;

export function ensureExCommands() {
  if (defined) return;
  defined = true;

  Vim.defineEx("write", "w", (cm: { getValue: () => string }) => {
    const text = cm.getValue();
    if (detailSaveRef.current) {
      detailSaveRef.current(text);
    } else if (editorSaveRef.current) {
      editorSaveRef.current(text);
    }
  });

  Vim.defineEx("quit", "q", () => {
    quitCallbackRef.current?.();
  });
}
