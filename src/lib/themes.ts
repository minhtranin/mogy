import { EditorView } from "@codemirror/view";
import { type Extension } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";

export type ThemeName = "mocha" | "latte";

export const THEME_LIST: { id: ThemeName; label: string }[] = [
  { id: "mocha", label: "Catppuccin Mocha (Dark)" },
  { id: "latte", label: "Catppuccin Latte (Light)" },
];

// --- CSS variable sets ---

const cssVars: Record<ThemeName, Record<string, string>> = {
  mocha: {
    "--bg-primary": "#1e1e2e",
    "--bg-secondary": "#181825",
    "--bg-surface": "#313244",
    "--text-primary": "#cdd6f4",
    "--text-secondary": "#a6adc8",
    "--text-muted": "#6c7086",
    "--accent": "#89b4fa",
    "--accent-hover": "#74c7ec",
    "--accent-dim": "#1e3a5f",
    "--border": "#45475a",
    "--success": "#a6e3a1",
    "--error": "#f38ba8",
    "--warning": "#fab387",
  },
  latte: {
    "--bg-primary": "#eff1f5",
    "--bg-secondary": "#e6e9ef",
    "--bg-surface": "#ccd0da",
    "--text-primary": "#4c4f69",
    "--text-secondary": "#5c5f77",
    "--text-muted": "#9ca0b0",
    "--accent": "#1e66f5",
    "--accent-hover": "#04a5e5",
    "--accent-dim": "#bcc6e0",
    "--border": "#bcc0cc",
    "--success": "#40a02b",
    "--error": "#d20f39",
    "--warning": "#fe640b",
  },
};

export function applyCssVariables(theme: ThemeName) {
  const vars = cssVars[theme];
  const root = document.documentElement;
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
}

// --- CodeMirror themes ---

const latteTheme = EditorView.theme(
  {
    "&": { backgroundColor: "#eff1f5", color: "#4c4f69" },
    ".cm-content": { caretColor: "#1e66f5" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#1e66f5" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "#ccd0da",
    },
    ".cm-panels": { backgroundColor: "#e6e9ef", color: "#5c5f77" },
    ".cm-panels.cm-panels-top": { borderBottom: "1px solid #bcc0cc" },
    ".cm-panels.cm-panels-bottom": { borderTop: "1px solid #bcc0cc" },
    ".cm-searchMatch": { backgroundColor: "#bcc6e0" },
    ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "#ccd0da" },
    ".cm-activeLine": { backgroundColor: "#bcc0cc30" },
    ".cm-selectionMatch": { backgroundColor: "#bcc6e0" },
    ".cm-matchingBracket, .cm-nonmatchingBracket": { backgroundColor: "#ccd0da" },
    ".cm-gutters": {
      backgroundColor: "#e6e9ef",
      color: "#9ca0b0",
      borderRight: "1px solid #bcc0cc",
    },
    ".cm-activeLineGutter": { backgroundColor: "#ccd0da" },
    ".cm-foldPlaceholder": {
      backgroundColor: "transparent",
      border: "none",
      color: "#9ca0b0",
    },
    ".cm-tooltip": {
      border: "1px solid #bcc0cc",
      backgroundColor: "#e6e9ef",
      color: "#4c4f69",
    },
    ".cm-tooltip .cm-tooltip-arrow:before": {
      borderTopColor: "transparent",
      borderBottomColor: "transparent",
    },
    ".cm-tooltip .cm-tooltip-arrow:after": {
      borderTopColor: "#e6e9ef",
      borderBottomColor: "#e6e9ef",
    },
    ".cm-tooltip-autocomplete": {
      "& > ul > li[aria-selected]": {
        backgroundColor: "#ccd0da",
        color: "#4c4f69",
      },
    },
  },
  { dark: false }
);

export function getCmTheme(name: ThemeName): Extension {
  return name === "mocha" ? oneDark : latteTheme;
}
