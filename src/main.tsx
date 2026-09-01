import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { installBridge } from "./bridge";
import { App } from "./App";
import "./global.css";

// window.riftcompass must exist before any component mounts —
// I18nProvider reads settings in its first effect.
installBridge();

// Electron's default: dropping a stray file onto the window navigates it
// away to that file (dragDropEnabled: false in the old Tauri config).
// Nothing in this app accepts a file drop, so this is always safe to block.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
