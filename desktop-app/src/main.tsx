import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles/globals.css";
import "./styles/wotann-tokens.css";
import { injectValknutKeyframes } from "./components/wotann/ValknutSpinner";

// Inject the Valknut + RuneForge keyframes once at boot so signature
// loading indicators are available globally without per-component setup.
injectValknutKeyframes();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
