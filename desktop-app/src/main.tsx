import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles/globals.css";
import "./styles/wotann-tokens.css";
import "./styles/liquid-glass.css";
import { injectValknutKeyframes } from "./components/wotann/ValknutSpinner";

// Inject the Valknut + RuneForge keyframes once at boot so signature
// loading indicators are available globally without per-component setup.
injectValknutKeyframes();

// Monaco worker registration (session-10 audit fix).
//
// @monaco-editor/react defaults to loading Monaco's AMD bundle from
// jsDelivr at runtime. Tauri's sandboxed webview + strict CSP break
// that path, and even when CSP is loosened the AMD fallback loads
// workers from blob: URLs that lack language-server support. Wiring
// the worker URLs explicitly via `MonacoEnvironment.getWorker` gives
// Vite deterministic control — workers enter the bundle graph (with
// the `?worker` suffix so Vite compiles them as Web Workers) and ship
// alongside the app. No CDN, no AMD fallback, no runtime eval.
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import TsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker(_id: string, label: string): Worker {
    switch (label) {
      case "json":
        return new JsonWorker();
      case "css":
      case "scss":
      case "less":
        return new CssWorker();
      case "html":
      case "handlebars":
      case "razor":
        return new HtmlWorker();
      case "typescript":
      case "javascript":
        return new TsWorker();
      default:
        return new EditorWorker();
    }
  },
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
