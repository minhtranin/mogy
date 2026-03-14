import { useState, useCallback } from "react";

export type Panel = "editor" | "results";
export type PanelLayout = "split" | "editor-max" | "results-max";
export type LayoutDirection = "vertical" | "horizontal";

export function usePanelFocus() {
  const [activePanel, setActivePanel] = useState<Panel>("editor");
  const [layout, setLayout] = useState<PanelLayout>("split");
  const [layoutDirection, setLayoutDirection] = useState<LayoutDirection>("vertical");

  const focusEditor = useCallback(() => setActivePanel("editor"), []);
  const focusResults = useCallback(() => setActivePanel("results"), []);

  const toggleMaximize = useCallback(() => {
    setLayout((prev) => {
      if (prev !== "split") return "split";
      return activePanel === "editor" ? "editor-max" : "results-max";
    });
  }, [activePanel]);

  const toggleLayoutDirection = useCallback(() => {
    setLayoutDirection((prev) => (prev === "vertical" ? "horizontal" : "vertical"));
  }, []);

  return {
    activePanel,
    setActivePanel,
    layout,
    setLayout,
    layoutDirection,
    setLayoutDirection,
    focusEditor,
    focusResults,
    toggleMaximize,
    toggleLayoutDirection,
  };
}
