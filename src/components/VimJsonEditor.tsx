import { useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import { EditorView, lineNumbers, drawSelection, highlightActiveLine } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { json } from "@codemirror/lang-json";
import { vim, Vim, getCM } from "@replit/codemirror-vim";
import { history, defaultKeymap, historyKeymap } from "@codemirror/commands";
import { keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  detailSaveRef,
  detailCmRef,
  quitCallbackRef,
  ensureExCommands,
} from "../lib/vim-commands";

// Lightweight extensions for large JSON — no bracket matching, fold gutter,
// autocomplete, or JSON language parser
const lightweightSetup = [
  lineNumbers(),
  history(),
  drawSelection(),
  highlightActiveLine(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  keymap.of([...defaultKeymap, ...historyKeymap]),
];

interface VimJsonEditorProps {
  value: string;
  onSave?: (value: string) => void;
  onQuit?: () => void;
  lightweight?: boolean;
}

export interface VimJsonEditorHandle {
  focus: () => void;
  blur: () => void;
  getValue: () => string;
}

export default forwardRef<VimJsonEditorHandle, VimJsonEditorProps>(
  function VimJsonEditor({ value, onSave, onQuit, lightweight = false }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const initialValueRef = useRef(value);

    useImperativeHandle(ref, () => ({
      focus() {
        viewRef.current?.focus();
      },
      blur() {
        viewRef.current?.contentDOM.blur();
      },
      getValue() {
        return viewRef.current?.state.doc.toString() ?? "";
      },
    }));

    // Set detail-level callbacks (higher priority than editor)
    useEffect(() => {
      detailSaveRef.current = onSave ?? null;
      quitCallbackRef.current = onQuit ?? null;
      return () => {
        detailSaveRef.current = null;
        quitCallbackRef.current = null;
      };
    }, [onSave, onQuit]);

    // Create editor once
    useEffect(() => {
      if (!containerRef.current) return;

      ensureExCommands();

      const extensions = lightweight
        ? [vim(), ...lightweightSetup, oneDark]
        : [vim(), basicSetup, json(), oneDark];

      const state = EditorState.create({
        doc: initialValueRef.current,
        extensions,
      });

      const view = new EditorView({
        state,
        parent: containerRef.current,
      });

      viewRef.current = view;
      detailCmRef.current = getCM(view);

      Vim.map("jk", "<Esc>", "insert");

      return () => {
        detailCmRef.current = null;
        view.destroy();
      };
    }, []);

    // Update doc when value changes without destroying editor
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      const current = view.state.doc.toString();
      if (current !== value) {
        view.dispatch({
          changes: { from: 0, to: current.length, insert: value },
        });
      }
    }, [value]);

    return (
      <div
        ref={containerRef}
        className="h-full overflow-hidden vim-json-editor"
      />
    );
  }
);
