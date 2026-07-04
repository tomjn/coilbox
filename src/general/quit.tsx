import { Button } from "@picoframe/frame";
import { exit } from "@tauri-apps/plugin-process";
import { LogOut } from "lucide-react";
import { getProfile } from "../profile/profile";

/**
 * Quitting the app has a single entry point so every surface that offers an exit
 * (the sidebar-footer button below, and a profile's welcome-HTML marker handled in
 * `../profile/BrandedWelcome`) closes it the same way. Best-effort, mirroring
 * `applyFullscreen` in `./fullscreen`: it must not throw at a click handler.
 *
 * This is deliberately *not* gated by the `fullscreenLocked` kiosk lock — quit is
 * the escape hatch a fullscreen build otherwise lacks.
 */
export function quitApp(): void {
  exit(0).catch((e) => console.warn("quit: exit failed", e));
}

/**
 * Sidebar-footer control (contributed to the `sidebar.footer` slot). Only present
 * when the distribution profile opts in with `quit: true`; a vanilla build keeps the
 * footer empty. Renders a labelled button so the exit is obvious to a player who may
 * not know any other way out.
 */
export function QuitControl() {
  if (getProfile().quit !== true) return null;

  return (
    <Button
      variant="ghost"
      className="w-full justify-start gap-2"
      onClick={quitApp}
    >
      <LogOut size={16} />
      Quit
    </Button>
  );
}
