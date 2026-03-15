import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/globals.css";

// Show window immediately so splash screen is visible while JS loads
import { getCurrentWindow } from "@tauri-apps/api/window";
getCurrentWindow().show();

// Lazy-load App so the window + splash appear before heavy imports (CodeMirror etc.)
const App = React.lazy(() => import("./App"));

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <React.Suspense fallback={null}>
      <App />
    </React.Suspense>
  </React.StrictMode>
);
