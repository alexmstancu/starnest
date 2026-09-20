import { useEffect, type ComponentType } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAppConfig } from "../config/AppConfigContext";
import { CompareScreen } from "../routes/compare/CompareScreen";
import { ConfigureScreen } from "../routes/configure/ConfigureScreen";
import { RankScreen } from "../routes/rank/RankScreen";
import { RunScreen } from "../routes/run/RunScreen";
import { Sidebar } from "../shell/Sidebar";
import { TabBar } from "../shell/TabBar";
import { SelectionProvider } from "../shell/SelectionContext";
import {
  DEFAULT_ROUTE,
  ROUTES,
  findRouteByPath,
  type RouteDefinition,
  type RoutePath,
} from "../navigation/routes";

/**
 * The screen each route renders. **Keyed by the route table's own paths**, so a tab added
 * there without a screen here fails to compile -- which is what the placeholder screen used to
 * cover, less well, at runtime (removed with the last unbuilt tab, P6 W6-C).
 */
const SCREENS: Record<RoutePath, ComponentType<{ route: RouteDefinition }>> = {
  "/configure": ConfigureScreen,
  "/rank": RankScreen,
  "/run": RunScreen,
  "/compare": CompareScreen,
};

/**
 * The shell: a persistent sidebar beside one of four routes (`reqs.md` 8).
 *
 * The routes are generated from the one route table, so a tab cannot exist in the navigation
 * without existing in the router -- and `SCREENS` is typed to require every one of them, so a
 * route added to the table without a screen fails to compile rather than rendering nothing.
 * The placeholder that stood in for the unbuilt tabs is gone with the last of them (P6 W6-C).
 */
export function App() {
  return (
    <SelectionProvider>
      <DocumentTitle />
      <div className="layout">
        <Sidebar />
        <main className="main">
          <TabBar />
          <div className="content">
            <Routes>
            <Route path="/" element={<Navigate to={DEFAULT_ROUTE} replace />} />
            {ROUTES.map((route) => {
              // Total by construction: `SCREENS` is keyed by the route table's own paths.
              // `noUncheckedIndexedAccess` cannot see that, hence the assertion.
              const Screen = SCREENS[route.path]!;
              return (
                <Route
                  key={route.path}
                  path={route.path}
                  element={<Screen route={route} />}
                />
              );
            })}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </div>
        </main>
      </div>
    </SelectionProvider>
  );
}

/**
 * The browser tab carries the configured display name, never a compiled-in one. Setting it
 * here rather than in `index.html` is what makes renaming the product a change to
 * `config.json` alone.
 */
function DocumentTitle() {
  const { displayName } = useAppConfig();
  const { pathname } = useLocation();
  const route = findRouteByPath(pathname);

  useEffect(() => {
    document.title = route ? `${route.label} · ${displayName}` : displayName;
  }, [route, displayName]);

  return null;
}

function NotFound() {
  return (
    <section className="screen">
      <h2 className="screen__heading">No such screen</h2>
      <p className="screen__summary">
        The address does not match any of the four tabs.
      </p>
    </section>
  );
}
