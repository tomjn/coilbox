import { Maximize2, Wrench } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useAdvancedModeSetting } from "../advanced";
import { isFullscreenLocked, useFullscreenSetting } from "../fullscreen";

/**
 * The General settings section (frame settings page at `/settings/general`).
 * Owns the Advanced-mode toggle, persisted immediately via the frame settings
 * store (no Save button). Turning it off removes the developer/modding tools from
 * the sidebar and welcome screen; on brings them back.
 */
export default function GeneralSettings() {
  const [advanced, setAdvanced] = useAdvancedModeSetting();
  const [fullscreen, setFullscreen] = useFullscreenSetting();
  // A kiosk-locked build forces fullscreen and hides the toggle entirely.
  const fullscreenLocked = isFullscreenLocked();

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Wrench size={15} /> Advanced tools
        </h2>
        <label
          htmlFor="advanced-mode"
          className="flex cursor-pointer items-start gap-3"
        >
          <Switch
            id="advanced-mode"
            checked={advanced}
            onCheckedChange={(v) => setAdvanced(v === true)}
            className="mt-0.5"
          />
          <span className="space-y-1">
            <span className="block text-sm font-medium">Advanced mode</span>
            <span className="block text-xs text-muted-foreground">
              Show the developer and modding tools — uberstress, mapconv,
              animation, and the archive explorer — in the sidebar and welcome
              screen. Off by default for a player-focused layout.
            </span>
          </span>
        </label>
      </section>

      {!fullscreenLocked && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <Maximize2 size={15} /> Display
          </h2>
          <label
            htmlFor="fullscreen-mode"
            className="flex cursor-pointer items-start gap-3"
          >
            <Switch
              id="fullscreen-mode"
              checked={fullscreen}
              onCheckedChange={(v) => setFullscreen(v === true)}
              className="mt-0.5"
            />
            <span className="space-y-1">
              <span className="block text-sm font-medium">Fullscreen</span>
              <span className="block text-xs text-muted-foreground">
                Run Coilbox in fullscreen. Also toggleable with F11 or the
                top-bar button; the choice is remembered across restarts.
              </span>
            </span>
          </label>
        </section>
      )}
    </div>
  );
}
