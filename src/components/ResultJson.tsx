import { useRef, useEffect, useCallback } from "react";
import VimJsonEditor, { type VimJsonEditorHandle } from "./VimJsonEditor";

interface ResultJsonProps {
  data: unknown[];
  focused: boolean;
}

export default function ResultJson({ data, focused }: ResultJsonProps) {
  const editorRef = useRef<VimJsonEditorHandle>(null);

  useEffect(() => {
    if (focused) {
      editorRef.current?.focus();
    }
  }, [focused]);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
        No results
      </div>
    );
  }

  const displayData = data.length === 1 ? data[0] : data;
  const jsonText = JSON.stringify(displayData, null, 2);

  return (
    <div className="h-full overflow-hidden">
      <VimJsonEditor ref={editorRef} value={jsonText} />
    </div>
  );
}
