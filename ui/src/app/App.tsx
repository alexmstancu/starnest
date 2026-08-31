import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAppConfig } from "../config/AppConfigContext";
import { PlaceholderScreen } from "../routes/PlaceholderScreen";
import { Sidebar } from "../shell/Sidebar";
import { SelectionProvider } from "../shell/SelectionContext";
import { DEFAULT_ROUTE, ROUTES, findRouteByPath } from "./routes";

/**
 * The shell: a persistent sidebar beside one of four routes (`reqs.md` 8).
 *
 * The routes are generated from the one route table, so a tab cannot exist in the navigation
 * without existing in the router. Each currently renders a placeholder; P6 replaces the
 * element, not the routing.
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
            {ROUTES.map((route) => (
              <Route key={route.path} path={route.path} element={<PlaceholderScreen route={route} />} />
            ))}
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
