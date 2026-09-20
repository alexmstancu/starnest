import { NavLink } from "react-router-dom";
import { ROUTES } from "../navigation/routes";

/**
 * The four tabs, across the top of the content column.
 *
 * **They were a list in the sidebar until the design said otherwise.** The design
 * ("Starnest Product", claude.ai/design) puts them above the content as a tab strip with an
 * underline on the current one, and the sidebar keeps only what is *about* the current
 * selection -- the criteria set, the level, the counts, the last run.
 *
 * **Links, not buttons.** The design draws them as `<button>`, which is how a mockup fakes
 * routing; these navigate, so they stay anchors. A tab that cannot be opened in a new window or
 * copied as a URL is a button wearing a tab's clothes, and `aria-current="page"` is what a
 * screen reader reads for "you are here".
 */
export function TabBar() {
  return (
    <nav className="tabbar" aria-label="Sections">
      {ROUTES.map((route) => (
        <NavLink
          key={route.path}
          to={route.path}
          className={({ isActive }) =>
            isActive ? "tabbar__tab tabbar__tab--current" : "tabbar__tab"
          }
        >
          {route.label}
        </NavLink>
      ))}
    </nav>
  );
}
