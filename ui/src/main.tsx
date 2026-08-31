/**
 * Entry point.
 *
 * Boot order matters: the presentation configuration is fetched *before* the first paint, so
 * the application name is never briefly wrong on screen, and the mock server -- when it is
 * enabled -- is started before any component can issue a request.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./app/App";
import { AppConfigProvider } from "./config/AppConfigContext";
import { loadAppConfig } from "./config/appConfig";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("index.html must contain #root");
const root = createRoot(container);

async function startMockServerIfRequested(): Promise<void> {
  // Until the backend answers, `npm run dev:mock` serves every path of docs/openapi.yaml from
  // a mock. It is opt-in so that the day the backend is up, `npm run dev` talks to it and no
  // one has to remember to switch anything off.
  if (import.meta.env.VITE_USE_MOCKS !== "1") return;
  const { startMockWorker } = await import("./mocks/browser");
  await startMockWorker();
}

async function boot(): Promise<void> {
  await startMockServerIfRequested();
  const config = await loadAppConfig();

  root.render(
    <StrictMode>
      <AppConfigProvider config={config}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AppConfigProvider>
    </StrictMode>,
  );
}

boot().catch((error: unknown) => {
  // Deliberately unbranded: if the configuration did not load, this interface does not know
  // what the product is called, and inventing a name here would defeat the whole arrangement.
  root.render(
    <StrictMode>
      <div className="boot-failure" role="alert">
        <h1>The interface could not start</h1>
        <p>{error instanceof Error ? error.message : String(error)}</p>
      </div>
    </StrictMode>,
  );
});
