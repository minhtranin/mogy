import { useState, useCallback } from "react";

export type Panel = "editor" | "results";
export type PanelLayout = "split" | "editor-max" | "results-max";

export function usePanelFocus() {
  const [activePanel, setActivePanel] = useState<Panel>("editor");
  const [layout, setLayout] = useState<PanelLayout>("split");

  const focusEditor = useCallback(() => setActivePanel("editor"), []);
  const focusResults = useCallback(() => setActivePanel("results"), []);

  const toggleMaximize = useCallback(() => {
    setLayout((prev) => {
      if (prev !== "split") return "split";
      return activePanel === "editor" ? "editor-max" : "results-max";
    });
  }, [activePanel]);

  return {
    activePanel,
    setActivePanel,
    layout,
    setLayout,
    focusEditor,
    focusResults,
    toggleMaximize,
  };
}
