// Entry point. The four routes of reqs.md 8 and the persistent sidebar are built in W2-D
// (devplan.md), against the mock server generated from docs/openapi.yaml.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const root = document.getElementById("root");
if (!root) throw new Error("index.html must contain #root");

createRoot(root).render(
  <StrictMode>
    <p>Not built yet — see devplan.md, W2-D.</p>
  </StrictMode>,
);
