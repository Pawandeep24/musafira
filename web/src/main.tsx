import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/App";
import { StopPage } from "@/StopPage";
import "@/styles/tokens.css";
import "@/styles/index.css";

const stopId = /^\/s\/([A-Za-z0-9_-]{6,40})\/?$/.exec(location.pathname)?.[1];

createRoot(document.getElementById("root")!).render(<StrictMode>{stopId ? <StopPage id={stopId} /> : <App />}</StrictMode>);
