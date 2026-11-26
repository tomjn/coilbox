import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { OptionSelect } from "@/components/OptionSelect";
import { SettingList, SettingRow } from "@/components/SettingRow";
import { Switch } from "@/components/ui/switch";
import { formatNumber } from "@/lib/format";
import { useLanguageSetting } from "../../i18n/language";
import { pickerLocales, SYSTEM_LANGUAGE } from "../../i18n/locales";
import { languageLabel, packOnlyLocales } from "../../i18n/packs";
import { clampUiZoom, UI_ZOOM_LEVELS } from "../../lib/uiZoom";
import { requestOnboardingRerun } from "../../onboarding/rerun";
import {
  type ReduceMotionSetting,
  useEffectsSetting,
  usePerformanceModeSetting,
  useReduceMotionSetting,
  useShowFrameRateSetting,
} from "../display";
import { FeatureToggles } from "../FeatureToggles";
import { isFullscreenLocked, useFullscreenSetting } from "../fullscreen";
import { hasProfileSplash, useSplashSetting } from "../splash";
import { useUiZoomSetting } from "../uiZoom";
import { AboutCoilbox } from "./AboutCoilbox";

/**
 * The General settings section (frame settings page at `/settings/general`).
 * Owns the feature toggles, persisted immediately via the frame settings store
 * (no Save button). Each one shows or hides one group of making and developer
 * tools in the sidebar and on the welcome screen.
 */
export default function GeneralSettings() {
  const { t } = useLingui();
  const [language, setLanguage] = useLanguageSetting();
  const [fullscreen, setFullscreen] = useFullscreenSetting();
  const [splash, setSplash] = useSplashSetting();
  const [reduceMotion, setReduceMotion] = useReduceMotionSetting();
  const [effects, setEffects] = useEffectsSetting();
  const [performance, setPerformance] = usePerformanceModeSetting();
  const [zoom, setZoom] = useUiZoomSetting();
  const [showFrameRate, setShowFrameRate] = useShowFrameRateSetting();
  // A kiosk-locked build forces fullscreen and hides the toggle entirely.
  const fullscreenLocked = isFullscreenLocked();
  // The splash toggle only makes sense when the profile actually ships one.
  const showSplashToggle = hasProfileSplash();

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">
          <Trans>Tools</Trans>
        </h2>
        <FeatureToggles />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">
          <Trans>Interface</Trans>
        </h2>
        <SettingList>
          <SettingRow id="language" label={t`Language`}>
            <OptionSelect
              id="language"
              value={language}
              onValueChange={setLanguage}
              size="sm"
              className="w-56"
              options={[
                { value: SYSTEM_LANGUAGE, label: t`System` },
                ...pickerLocales(packOnlyLocales()).map((code) => ({
                  value: code,
                  label: languageLabel(code),
                  hint: code,
                })),
              ]}
            />
          </SettingRow>
          <SettingRow
            id="interface-size"
            label={t`Interface size`}
            helpLabel={t`About interface size`}
            help={
              <p>
                <Trans>
                  Scales text, spacing and the 3D views. Cmd or Ctrl with plus
                  or minus changes it, and with zero sets it back to 100%.
                </Trans>
              </p>
            }
          >
            <OptionSelect
              id="interface-size"
              value={String(clampUiZoom(zoom))}
              onValueChange={(v) => setZoom(Number(v))}
              size="sm"
              className="w-28"
              options={UI_ZOOM_LEVELS.map((level) => ({
                value: String(level),
                label: formatNumber(level, {
                  style: "percent",
                  maximumFractionDigits: 0,
                }),
              }))}
            />
          </SettingRow>
          {!fullscreenLocked && (
            <SettingRow
              id="fullscreen-mode"
              label={t`Fullscreen`}
              helpLabel={t`About fullscreen`}
              help={
                <p>
                  <Trans>
                    F11 and the button in the top bar also switch it.
                  </Trans>
                </p>
              }
            >
              <Switch
                id="fullscreen-mode"
                checked={fullscreen}
                onCheckedChange={(v) => setFullscreen(v === true)}
              />
            </SettingRow>
          )}
          {showSplashToggle && (
            <SettingRow
              id="startup-splash"
              label={t`Startup splash`}
              helpLabel={t`About the startup splash`}
              help={
                <p>
                  <Trans>
                    Click the splash or press Escape to close it early.
                  </Trans>
                </p>
              }
            >
              <Switch
                id="startup-splash"
                checked={splash}
                onCheckedChange={(v) => setSplash(v === true)}
              />
            </SettingRow>
          )}
          <SettingRow
            id="show-frame-rate"
            label={t`Show frame rate`}
            helpLabel={t`About the frame rate`}
            help={
              <p>
                <Trans>
                  Shows how many frames a second each 3D view draws, in its
                  bottom right corner.
                </Trans>
              </p>
            }
          >
            <Switch
              id="show-frame-rate"
              checked={showFrameRate}
              onCheckedChange={(v) => setShowFrameRate(v === true)}
            />
          </SettingRow>
        </SettingList>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">
          <Trans>Motion and effects</Trans>
        </h2>
        <SettingList>
          <SettingRow
            id="reduce-motion"
            label={t`Reduce motion`}
            helpLabel={t`About reduce motion`}
            help={
              <p>
                <Trans>
                  Stops ambient animation, such as the galaxy twinkle, scrolling
                  panoramas, spinning map previews and result flourishes. Follow
                  system uses your operating system's accessibility setting.
                </Trans>
              </p>
            }
          >
            <OptionSelect
              id="reduce-motion"
              value={reduceMotion}
              onValueChange={(v) => setReduceMotion(v as ReduceMotionSetting)}
              size="sm"
              className="w-44"
              options={[
                { value: "system", label: t`Follow system` },
                { value: "on", label: t`Reduce motion` },
                { value: "off", label: t`Full motion` },
              ]}
            />
          </SettingRow>
          <SettingRow
            id="display-effects"
            label={t`Ambient effects`}
            helpLabel={t`About ambient effects`}
            help={
              <p>
                <Trans>
                  Star twinkle, nebulae and other decorative touches. Sound has
                  its own settings page.
                </Trans>
              </p>
            }
          >
            <Switch
              id="display-effects"
              checked={effects}
              onCheckedChange={(v) => setEffects(v === true)}
            />
          </SettingRow>
          <SettingRow
            id="display-performance"
            label={t`Performance mode`}
            helpLabel={t`About performance mode`}
            help={
              <p>
                <Trans>
                  Draws 3D views at a lower resolution with fewer particles, for
                  laptops and older graphics cards.
                </Trans>
              </p>
            }
          >
            <Switch
              id="display-performance"
              checked={performance}
              onCheckedChange={(v) => setPerformance(v === true)}
            />
          </SettingRow>
        </SettingList>
      </section>

      <section aria-labelledby="setup-heading" className="flex flex-col gap-3">
        <h2 id="setup-heading" className="text-sm font-semibold">
          <Trans>Setup</Trans>
        </h2>
        <SettingList>
          <SettingRow label={t`Setup wizard`}>
            <Button
              variant="outline"
              size="sm"
              onClick={() => requestOnboardingRerun()}
            >
              <Trans>Run setup again</Trans>
            </Button>
          </SettingRow>
        </SettingList>
      </section>

      <AboutCoilbox />
    </div>
  );
}
