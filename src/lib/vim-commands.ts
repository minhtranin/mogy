import { Vim } from "@replit/codemirror-vim";

// Each editor registers its save callback; :w dispatches based on which editor invoked it
export const editorSaveRef = { current: null as ((text: string) => void) | null };
export const detailSaveRef = { current: null as ((text: string) => void) | null };
export const quitCallbackRef = { current: null as (() => void) | null };
export const saveAndQuitAllRef = { current: null as (() => void) | null };

// Track which CodeMirror instance belongs to the detail view
export const detailCmRef = { current: null as unknown };

let defined = false;
let clipboardPatched = false;

// Sync vim unnamed register to system clipboard so y/Y/yy/d/dd etc.
// are available outside the app
function patchClipboardSync() {
  if (clipboardPatched) return;
  clipboardPatched = true;

  const rc = Vim.getRegisterController();
  const reg = rc.getRegister('"');
  const origSetText = reg.setText.bind(reg);
  const origPushText = reg.pushText.bind(reg);

  reg.setText = (text: string, linewise?: boolean, blockwise?: boolean) => {
    origSetText(text, linewise, blockwise);
    if (text) navigator.clipboard.writeText(text).catch(() => {});
  };
  reg.pushText = (text: string, linewise?: boolean) => {
    origPushText(text, linewise);
    navigator.clipboard.writeText(reg.keyBuffer.join("")).catch(() => {});
  };
}

export function ensureExCommands() {
  if (defined) return;
  defined = true;

  patchClipboardSync();

  Vim.defineEx("write", "w", (cm: { getValue: () => string }) => {
    const text = cm.getValue();
    if (detailSaveRef.current && cm === detailCmRef.current) {
      detailSaveRef.current(text);
    } else if (editorSaveRef.current) {
      editorSaveRef.current(text);
    }
  });

  Vim.defineEx("quit", "q", () => {
    quitCallbackRef.current?.();
  });

  Vim.defineEx("wqa", "wqa", () => {
    saveAndQuitAllRef.current?.();
  });

  // gc in visual mode — toggle line comments
  Vim.defineAction("toggleComment", (cm: any) => {
    const sel = cm.listSelections()[0];
    const startLine = Math.min(sel.anchor.line, sel.head.line);
    const endLine = Math.max(sel.anchor.line, sel.head.line);

    let allCommented = true;
    for (let i = startLine; i <= endLine; i++) {
      const line = cm.getLine(i);
      if (line.trim() !== "" && !line.trimStart().startsWith("//")) {
        allCommented = false;
        break;
      }
    }

    for (let i = endLine; i >= startLine; i--) {
      const line = cm.getLine(i);
      if (line.trim() === "") continue;

      if (allCommented) {
        const idx = line.indexOf("//");
        const removeLen = line[idx + 2] === " " ? 3 : 2;
        cm.replaceRange("", { line: i, ch: idx }, { line: i, ch: idx + removeLen });
      } else {
        const indent = line.match(/^\s*/)?.[0].length ?? 0;
        cm.replaceRange("// ", { line: i, ch: indent }, { line: i, ch: indent });
      }
    }
  });
  Vim.mapCommand("gc", "action", "toggleComment", {}, { context: "visual" });

  // gcc in normal mode — toggle comment on current line
  Vim.defineAction("toggleCommentLine", (cm: any) => {
    const cursor = cm.getCursor();
    const line = cm.getLine(cursor.line);
    if (line.trim() === "") return;

    if (line.trimStart().startsWith("//")) {
      const idx = line.indexOf("//");
      const removeLen = line[idx + 2] === " " ? 3 : 2;
      cm.replaceRange("", { line: cursor.line, ch: idx }, { line: cursor.line, ch: idx + removeLen });
    } else {
      const indent = line.match(/^\s*/)?.[0].length ?? 0;
      cm.replaceRange("// ", { line: cursor.line, ch: indent }, { line: cursor.line, ch: indent });
    }
  });
  Vim.mapCommand("gcc", "action", "toggleCommentLine", {}, {});

  // gsa' in visual mode — wrap with single quotes
  Vim.defineAction("wrapSingleQuote", (cm: any) => {
    const sel = cm.listSelections()[0];
    const text = cm.getSelection();
    cm.replaceSelection("'" + text + "'");
    cm.setSelection(
      { line: sel.anchor.line, ch: sel.anchor.ch + 1 },
      { line: sel.head.line, ch: sel.head.ch + 1 }
    );
  });
  Vim.mapCommand("gsa'", "operator", "wrapSingleQuote", {}, { context: "visual" });

  // gsa" in visual mode — wrap with double quotes
  Vim.defineAction("wrapDoubleQuote", (cm: any) => {
    const sel = cm.listSelections()[0];
    const text = cm.getSelection();
    cm.replaceSelection('"' + text + '"');
    cm.setSelection(
      { line: sel.anchor.line, ch: sel.anchor.ch + 1 },
      { line: sel.head.line, ch: sel.head.ch + 1 }
    );
  });
  Vim.mapCommand('gsa"', "operator", "wrapDoubleQuote", {}, { context: "visual" });

}
