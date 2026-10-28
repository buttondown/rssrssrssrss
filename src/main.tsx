import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./globals.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Home from "./page";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <Home />
  </StrictMode>,
);
