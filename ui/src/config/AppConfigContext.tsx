import { createContext, useContext, type ReactNode } from "react";
import type { AppConfig } from "./appConfig";

/**
 * The configuration is loaded once, before first paint, so every consumer can treat it as
 * present. A component that had to handle "the name has not arrived yet" would flash a
 * placeholder name -- which is a wrong name on screen, briefly.
 */
const AppConfigContext = createContext<AppConfig | null>(null);

export function AppConfigProvider({
  config,
  children,
}: {
  config: AppConfig;
  children: ReactNode;
}) {
  return <AppConfigContext.Provider value={config}>{children}</AppConfigContext.Provider>;
}

export function useAppConfig(): AppConfig {
  const config = useContext(AppConfigContext);
  if (!config) {
    throw new Error("useAppConfig must be used inside AppConfigProvider");
  }
  return config;
}
