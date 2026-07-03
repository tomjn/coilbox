import { Wrench } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useAdvancedModeSetting } from "../advanced";

/**
 * The General settings section (frame settings page at `/settings/general`).
 * Owns the Advanced-mode toggle, persisted immediately via the frame settings
 * store (no Save button). Turning it off removes the developer/modding tools from
 * the sidebar and welcome screen; on brings them back.
 */
export default function GeneralSettings() {
  const [advanced, setAdvanced] = useAdvancedModeSetting();

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
    </div>
  );
}
