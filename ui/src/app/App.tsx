import { useEffect, type ComponentType } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAppConfig } from "../config/AppConfigContext";
import { ConfigureScreen } from "../routes/ConfigureScreen";
import { PlaceholderScreen } from "../routes/PlaceholderScreen";
import { RankScreen } from "../routes/RankScreen";
import { Sidebar } from "../shell/Sidebar";
import { SelectionProvider } from "../shell/SelectionContext";
import { DEFAULT_ROUTE, ROUTES, findRouteByPath, type RouteDefinition } from "./routes";

/**
 * Which routes have a real screen. The route table stays the single list of paths, and a tab
 * that is not in here still renders its placeholder -- so building the next screen is one
 * entry, not a change to the routing.
 */
const SCREENS: Record<string, ComponentType<{ route: RouteDefinition }>> = {
  "/configure": ConfigureScreen,
  "/rank": RankScreen,
};

/**
 * The shell: a persistent sidebar beside one of four routes (`reqs.md` 8).
 *
 * The routes are generated from the one route table, so a tab cannot exist in the navigation
 * without existing in the router. A route with no screen yet renders a placeholder that says
 * so, rather than an empty table that would look like an answer.
 */
export function App() {
  return (
    <SelectionProvider>
      <DocumentTitle />
      <div className="layout">
        <Sidebar />
        <main className="content">
          <Routes>
            <Route path="/" element={<Navigate to={DEFAULT_ROUTE} replace />} />
            {ROUTES.map((route) => {
              const Screen = SCREENS[route.path] ?? PlaceholderScreen;
              return <Route key={route.path} path={route.path} element={<Screen route={route} />} />;
            })}
            <Route path="*" element={<NotFound />} />
          </Routes>
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
      <p className="screen__summary">The address does not match any of the four tabs.</p>
    </section>
  );
}
