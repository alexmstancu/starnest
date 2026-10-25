import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../app/App";
import { AddressListener } from "./AddressListener";
import { AppConfigProvider } from "../config/AppConfigContext";
import type { AppConfig } from "../config/appConfig";

/**
 * Renders the shell the way `main.tsx` does, minus the boot sequence.
 *
 * The configuration is injected rather than fetched, because a test of a screen should fail
 * for a reason in the screen. `appConfig.test.ts` covers the fetching on its own.
 */

export const TEST_CONFIG: AppConfig = { displayName: "Test Nest" };

export function renderShell(
  initialPath = "/",
  config: AppConfig = TEST_CONFIG,
  /** Told the address, path and query, whenever it changes: what a screen wrote into it. */
  onAddress?: (address: string) => void,
) {
  return render(
    <AppConfigProvider config={config}>
      <MemoryRouter initialEntries={[initialPath]}>
        <App />
        {onAddress !== undefined && <AddressListener onAddress={onAddress} />}
      </MemoryRouter>
    </AppConfigProvider>,
  );
}
