import { Maximize2, Sparkles, Wrench } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { OptionSelect } from "../../uberstress/pages/components/OptionSelect";
import { useAdvancedModeSetting } from "../advanced";
import {
  type ReduceMotionSetting,
  useEffectsSetting,
  usePerformanceModeSetting,
  useReduceMotionSetting,
} from "../display";
import { isFullscreenLocked, useFullscreenSetting } from "../fullscreen";
import { hasProfileSplash, useSplashSetting } from "../splash";
import { AboutCoilbox } from "./AboutCoilbox";

/**
 * The General settings section (frame settings page at `/settings/general`).
 * Owns the Advanced-mode toggle, persisted immediately via the frame settings
 * store (no Save button). Turning it off removes the developer/modding tools from
 * the sidebar and welcome screen; on brings them back.
 */
export default function GeneralSettings() {
  const [advanced, setAdvanced] = useAdvancedModeSetting();
  const [fullscreen, setFullscreen] = useFullscreenSetting();
  const [splash, setSplash] = useSplashSetting();
  const [reduceMotion, setReduceMotion] = useReduceMotionSetting();
  const [effects, setEffects] = useEffectsSetting();
  const [performance, setPerformance] = usePerformanceModeSetting();
  // A kiosk-locked build forces fullscreen and hides the toggle entirely.
  const fullscreenLocked = isFullscreenLocked();
  // The splash toggle only makes sense when the profile actually ships one.
  const showSplashToggle = hasProfileSplash();

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

      {(!fullscreenLocked || showSplashToggle) && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <Maximize2 size={15} /> Display
          </h2>
          {!fullscreenLocked && (
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
          )}
          {showSplashToggle && (
            <label
              htmlFor="startup-splash"
              className="flex cursor-pointer items-start gap-3"
            >
              <Switch
                id="startup-splash"
                checked={splash}
                onCheckedChange={(v) => setSplash(v === true)}
                className="mt-0.5"
              />
              <span className="space-y-1">
                <span className="block text-sm font-medium">
                  Startup splash
                </span>
                <span className="block text-xs text-muted-foreground">
                  Show the brand splash when Coilbox launches. Click it or press
                  Escape to dismiss it early.
                </span>
              </span>
            </label>
          )}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Sparkles size={15} /> Motion &amp; effects
        </h2>
        <div className="flex items-start gap-3">
          <div className="w-40">
            <OptionSelect
              value={reduceMotion}
              onValueChange={(v) => setReduceMotion(v as ReduceMotionSetting)}
              size="sm"
              options={[
                { value: "system", label: "Follow system" },
                { value: "on", label: "Reduce motion" },
                { value: "off", label: "Full motion" },
              ]}
            />
          </div>
          <span className="space-y-1">
            <span className="block text-sm font-medium">Reduce motion</span>
            <span className="block text-xs text-muted-foreground">
              Stops ambient animation — the galaxy twinkle, scrolling panoramas,
              spinning map previews and result flourishes. "Follow system"
              respects your OS accessibility preference.
            </span>
          </span>
        </div>
        <label
          htmlFor="display-effects"
          className="flex cursor-pointer items-start gap-3"
        >
          <Switch
            id="display-effects"
            checked={effects}
            onCheckedChange={(v) => setEffects(v === true)}
            className="mt-0.5"
          />
          <span className="space-y-1">
            <span className="block text-sm font-medium">Ambient effects</span>
            <span className="block text-xs text-muted-foreground">
              Star twinkle, nebulae, ambience audio and other decorative
              touches. Turn off for a plainer, quieter interface.
            </span>
          </span>
        </label>
        <label
          htmlFor="display-performance"
          className="flex cursor-pointer items-start gap-3"
        >
          <Switch
            id="display-performance"
            checked={performance}
            onCheckedChange={(v) => setPerformance(v === true)}
            className="mt-0.5"
          />
          <span className="space-y-1">
            <span className="block text-sm font-medium">Performance mode</span>
            <span className="block text-xs text-muted-foreground">
              Renders 3D views at a lower resolution with fewer particles — for
              laptops and older GPUs.
            </span>
          </span>
        </label>
      </section>

      <AboutCoilbox />
    </div>
  );
}
