import { useEffect } from "react";

/**
 * Which part of the app a file dropped on the window belongs to.
 *
 * Tauri reports a drop to every listener on the webview, wherever on the window
 * it landed. The app-wide listener offers to install a dropped game or map
 * archive, and a few pages take dropped files for a job of their own. A page
 * that does holds a claim while it is mounted, and the app-wide listener stands
 * down for as long as any claim is held.
 */

let claims = 0;

/** True while a mounted page is taking dropped files itself. */
export function fileDropClaimed(): boolean {
  return claims > 0;
}

/** Hold a claim on dropped files for as long as the calling page is mounted. */
export function useClaimFileDrop(): void {
  useEffect(() => {
    claims += 1;
    return () => {
      claims -= 1;
    };
  }, []);
}
