import { useState, useCallback } from "react";

export type Panel = "editor" | "results";

export function usePanelFocus() {
  const [activePanel, setActivePanel] = useState<Panel>("editor");

  const focusEditor = useCallback(() => setActivePanel("editor"), []);
  const focusResults = useCallback(() => setActivePanel("results"), []);

  const togglePanel = useCallback(() => {
    setActivePanel((prev) => (prev === "editor" ? "results" : "editor"));
  }, []);

  return {
    activePanel,
    setActivePanel,
    focusEditor,
    focusResults,
    togglePanel,
  };
}
