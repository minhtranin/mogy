import { useRef, useEffect, useImperativeHandle, forwardRef } from "react";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { vim, Vim } from "@replit/codemirror-vim";
import { basicSetup } from "codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { editorSaveRef, ensureExCommands } from "../lib/vim-commands";

interface EditorProps {
  focused: boolean;
  onFocus: () => void;
  onSave?: () => void;
  onChange?: () => void;
}

export interface EditorHandle {
  focus: () => void;
  blur: () => void;
  getQueryText: () => string;
  getText: () => string;
  setText: (text: string) => void;
  appendText: (text: string) => void;
}

export default forwardRef<EditorHandle, EditorProps>(function Editor(
  { focused, onFocus, onSave, onChange },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useImperativeHandle(ref, () => ({
    focus() {
      viewRef.current?.focus();
    },
    blur() {
      viewRef.current?.contentDOM.blur();
    },
    getQueryText(): string {
      const view = viewRef.current;
      if (!view) return "";
      const selection = view.state.selection.main;
      if (selection.from !== selection.to) {
        return view.state.sliceDoc(selection.from, selection.to);
      }
      return view.state.doc.toString();
    },
    getText(): string {
      return viewRef.current?.state.doc.toString() ?? "";
    },
    setText(text: string) {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
      });
    },
    appendText(text: string) {
      const view = viewRef.current;
      if (!view) return;
      const doc = view.state.doc;
      const lastLine = doc.line(doc.lines).text;
      const prefix = lastLine.trim() ? "\n" : "";
      view.dispatch({
        changes: { from: doc.length, insert: prefix + text },
      });
    },
  }));

  // Set editor-level save callback
  useEffect(() => {
    editorSaveRef.current = () => {
      onSaveRef.current?.();
    };
    return () => {
      editorSaveRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    ensureExCommands();

    const state = EditorState.create({
      doc: "// Ctrl+Enter to run query\n\ndb.collection.find({})\n",
      extensions: [
        vim(),
        basicSetup,
        javascript(),
        oneDark,
        EditorView.updateListener.of((update) => {
          if (update.focusChanged && update.view.hasFocus) {
            onFocus();
          }
          if (update.docChanged) {
            onChangeRef.current?.();
          }
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    Vim.map("jk", "<Esc>", "insert");

    return () => {
      view.destroy();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (focused && viewRef.current) {
      viewRef.current.focus();
    }
  }, [focused]);

  return (
    <div
      ref={containerRef}
      className={`h-full overflow-auto border ${
        focused ? "border-[var(--accent)]" : "border-transparent"
      }`}
      onClick={onFocus}
    />
  );
});
