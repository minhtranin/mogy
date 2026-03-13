import { useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { json } from "@codemirror/lang-json";
import { vim, Vim } from "@replit/codemirror-vim";
import { basicSetup } from "codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  detailSaveRef,
  quitCallbackRef,
  ensureExCommands,
} from "../lib/vim-commands";

interface VimJsonEditorProps {
  value: string;
  onSave?: (value: string) => void;
  onQuit?: () => void;
}

export interface VimJsonEditorHandle {
  focus: () => void;
  blur: () => void;
  getValue: () => string;
}

export default forwardRef<VimJsonEditorHandle, VimJsonEditorProps>(
  function VimJsonEditor({ value, onSave, onQuit }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);

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

    useEffect(() => {
      if (!containerRef.current) return;

      ensureExCommands();

      const state = EditorState.create({
        doc: value,
        extensions: [vim(), basicSetup, json(), oneDark],
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
    }, [value]);

    return (
      <div
        ref={containerRef}
        className="h-full overflow-auto vim-json-editor"
      />
    );
  }
);
