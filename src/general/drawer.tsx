/**
 * Closing the frame's drawer when the route changes.
 *
 * The drawer is a single frame-managed panel that lives above the router, and
 * its content is a snapshot taken when it was opened. Nothing in the frame
 * closes it on a navigation, so a drawer opened on one page stays open, and
 * keeps showing that page's content, over whatever the player went to next
 * (issue #858). Every drawer in the app has that property, so the fix belongs
 * here rather than in the page that happened to notice it.
 *
 * Mounted as the general plugin's `Provider`, which the frame renders inside
 * both the router and the drawer's own provider.
 */

import { useDrawer } from "@picoframe/frame";
import { type ReactNode, useEffect, useRef } from "react";
import { useLocation } from "react-router";

export function CloseDrawerOnNavigate({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { close } = useDrawer();
  const previous = useRef(pathname);

  // A move to a different path, and nothing else. `close` is stable, so opening
  // a drawer cannot re-run this and close what was just opened, and the first
  // render closes nothing.
  useEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    close();
  }, [pathname, close]);

  return children;
}
