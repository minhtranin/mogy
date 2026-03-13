import { useRef, useEffect, useCallback } from "react";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { vim, getCM } from "@replit/codemirror-vim";
import { basicSetup } from "codemirror";
import { oneDark } from "@codemirror/theme-one-dark";

interface EditorProps {
  focused: boolean;
  onRunQuery: (text: string) => void;
  onFocus: () => void;
}

export default function Editor({ focused, onRunQuery, onFocus }: EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Get selected text or full buffer
  const getQueryText = useCallback((): string => {
    const view = viewRef.current;
    if (!view) return "";

    const selection = view.state.selection.main;
    if (selection.from !== selection.to) {
      return view.state.sliceDoc(selection.from, selection.to);
    }
    return view.state.doc.toString();
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const runQueryKeymap = keymap.of([
      {
        key: "Ctrl-Enter",
        run: () => {
          onRunQuery(getQueryText());
          return true;
        },
      },
    ]);

    const state = EditorState.create({
      doc: '// Write your MongoDB query here\n// Example: db.users.find({"name": "John"})\n// Ctrl+Enter to run\n\ndb.collection.find({})\n',
      extensions: [
        vim(),
        basicSetup,
        javascript(),
        oneDark,
        runQueryKeymap,
        EditorView.updateListener.of((update) => {
          if (update.focusChanged && update.view.hasFocus) {
            onFocus();
          }
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus the editor when panel becomes active
  useEffect(() => {
    if (focused && viewRef.current) {
      viewRef.current.focus();
    }
  }, [focused]);

  return (
    <div
      ref={containerRef}
      className={`h-full overflow-auto border ${
        focused ? "border-[var(--accent)]" : "border-[var(--border)]"
      }`}
      onClick={onFocus}
    />
  );
}
