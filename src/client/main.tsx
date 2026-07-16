import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ApiClient } from "./api/client";
import { App } from "./app";
import "./styles/tokens.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/responsive.css";

const root = document.getElementById("root");
if (root === null) throw new Error("Missing #root");

createRoot(root).render(
  <StrictMode>
    <App api={new ApiClient()} />
  </StrictMode>
);
