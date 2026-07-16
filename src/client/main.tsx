import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createProductionApi } from "./api/production";
import { App } from "./app";
import { syncPending } from "./offline/sync";
import "./styles/tokens.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/responsive.css";

const root = document.getElementById("root");
if (root === null) throw new Error("Missing #root");

const api = createProductionApi();

createRoot(root).render(
  <StrictMode>
    <App api={api} />
  </StrictMode>
);

if ("indexedDB" in globalThis) {
  const sync = () => {
    void syncPending(api).catch(() => undefined);
  };
  sync();
  window.addEventListener("online", sync);
}

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, { once: true });
}
