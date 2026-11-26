import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button, useTheme } from "@picoframe/frame";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  ClipboardCheck,
  FilePlus2,
  Loader2,
  RefreshCw,
  RotateCw,
} from "lucide-react";
import { useState } from "react";
import { HelpPopover } from "@/components/HelpPopover";
import { SettingList, SettingRow } from "@/components/SettingRow";
import { describeError } from "@/i18n/uiError";
import { useUnitsyncScan } from "../content/config";
import { useFeatureStates } from "../general/features";
import { useFullscreenSetting } from "../general/fullscreen";
import { describeHome, resolveHome } from "../home/config";
import { usePreferredTarget } from "../play/config";
import {
  buildScaffoldProfile,
  installedGameNames,
  reloadProfile,
  type ScaffoldResult,
  scaffoldProfile,
} from "./authoring";
import HealthChecklist from "./HealthChecklist";
import {
  getProfile,
  getProfileSource,
  isProfileAuthoringEnabled,
} from "./profile";

/**
 * Read-only "Distribution profile" settings section. Because a profile silently
 * hides features and presets filters, this is the support-visible surface that
 * makes the reskin diagnosable ("where did the Games tab go?" → it's the profile).
 * Reflects the profile loaded once at startup; nothing here is editable.
 */
export default function ProfileSettings() {
  const { t } = useLingui();
  const profile = getProfile();
  const loaded = getProfileSource() !== "default";

  const hidden = profile.hide ?? [];
  const hiddenSettings = profile.hideSettings ?? [];
  const filter = profile.gameFilter;
  const filterText = filter
    ? [filter.regex, ...(filter.names ?? [])].filter(Boolean).join(", ")
    : null;
  const themeCount = profile.theme ? Object.keys(profile.theme).length : 0;
  // Described by the resolver that built the page, so the row counts the zones
  // that were drawn rather than the ones that were written (issue #1080). A
  // profile with no `home` key says so in one word, like the welcome row above.
  const homeSummary = profile.home
    ? describeHome(resolveHome(profile.home))
    : t`Default`;
  const userChoice = t`User choice`;
  const none = t`None`;
  const themeSummary = themeCount
    ? plural(themeCount, { one: "# variable", other: "# variables" })
    : none;

  return (
    <div className="space-y-6 pb-8">
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-1">
          <h2 className="text-sm font-semibold">
            <Trans>Profile</Trans>
          </h2>
          <HelpPopover label={t`About distribution profiles`}>
            <p>
              <Trans>
                A game can ship its own build of Coilbox with a profile.json
                beside the app. The profile renames Coilbox, hides features and
                settings, and limits which games show. This page lists what the
                loaded profile changed.
              </Trans>
            </p>
          </HelpPopover>
        </div>
        <SettingList>
          {/* "file" is the only source a profile loads from today; "seed"
              is reserved and reads the same way until it exists. */}
          <SettingRow label={t`Loaded from`}>
            {loaded ? (
              <span className="select-text font-mono text-xs">
                .coilbox/profile.json
              </span>
            ) : (
              <Value text={t`Nothing, this is standard Coilbox`} />
            )}
          </SettingRow>
          {loaded && (
            <>
              <SettingRow label={t`Title`}>
                <Value text={profile.title ?? "Coilbox"} />
              </SettingRow>
              <SettingRow label={t`Colour scheme`}>
                <Value text={profile.mode ?? userChoice} />
              </SettingRow>
              <SettingRow label={t`Accent`}>
                <Value text={profile.accent ?? userChoice} />
              </SettingRow>
              <SettingRow label={t`Hidden features`}>
                <Value text={hidden.length ? hidden.join(", ") : none} />
              </SettingRow>
              <SettingRow label={t`Hidden settings`}>
                <Value
                  text={
                    hiddenSettings.length ? hiddenSettings.join(", ") : none
                  }
                />
              </SettingRow>
              <SettingRow label={t`Game filter`}>
                <Value text={filterText ?? none} />
              </SettingRow>
              <SettingRow label={t`Update repo`}>
                <Value text={profile.release?.repo ?? none} />
              </SettingRow>
              <SettingRow label={t`Coilbox updates`}>
                <Value text={profile.updater === false ? t`Off` : t`On`} />
              </SettingRow>
              <SettingRow label={t`Authoring tools`}>
                <Value text={profile.authoring === false ? t`Off` : t`On`} />
              </SettingRow>
              <SettingRow label={t`Quit button`}>
                <Value text={profile.quit ? t`Shown` : t`Hidden`} />
              </SettingRow>
              <SettingRow label={t`Welcome screen`}>
                <Value text={profile.welcome ? t`Custom` : t`Default`} />
              </SettingRow>
              <SettingRow label={t`Home page`}>
                <Value text={homeSummary} />
              </SettingRow>
              <SettingRow label={t`Theme overrides`}>
                <Value text={themeSummary} />
              </SettingRow>
            </>
          )}
        </SettingList>
      </section>
      <ProfileTools />
    </div>
  );
}

/**
 * A read-only value on the right of a row. Long lists of ids wrap rather than
 * push the row's name off the side.
 */
function Value({ text }: { text: string }) {
  return (
    <span className="block max-w-xs select-text break-words text-right text-sm">
      {text}
    </span>
  );
}

/**
 * The profile's tools, as one list. "Check" runs the health checks against the
 * current profile and shows the results below, including the no-op advisories
 * (a `hide`/`hideSettings` id that matches nothing, an unknown link icon, a
 * zero-match game filter, a `home` entry that was dropped) that otherwise fail
 * silently. On a release build, with no console, this is the only place they
 * show. Remounting the checklist on each press (via the `run` key) re-runs it.
 *
 * Then the authoring tool (issue #406). Exactly one of two is useful at a time,
 * so only one is shown. With a profile loaded, "Reload" re-reads the file and
 * re-applies it without an app restart. Without one, "Create" scaffolds a
 * starter from the current app state. Reload can't help before a profile
 * exists, because Coilbox resolves the portable folder once at startup and a
 * folder with no `profile.json` isn't one. The authoring row goes away on
 * `"authoring": false`, so a shipped distribution doesn't hand players a way
 * to reload or replace its branding.
 */
function ProfileTools() {
  const { t } = useLingui();
  const [run, setRun] = useState(0);
  const authoring = isProfileAuthoringEnabled();
  const loaded = getProfileSource() !== "default";
  return (
    <>
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">
          <Trans>Tools</Trans>
        </h2>
        <SettingList>
          <SettingRow
            label={t`Check profile`}
            help={
              <p>
                <Trans>
                  Checks the profile, content folders and bundled content, and
                  lists anything a player would trip over. Mistakes that fail
                  quietly, such as a hidden id that matches nothing, only show
                  up here.
                </Trans>
              </p>
            }
            helpLabel={t`About checking the profile`}
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setRun((n) => n + 1)}
            >
              <ClipboardCheck aria-hidden />
              {run === 0 ? t`Check` : t`Check again`}
            </Button>
          </SettingRow>
          {authoring && (loaded ? <ReloadRow /> : <CreateRow />)}
        </SettingList>
      </section>
      {run > 0 && <HealthChecklist key={run} />}
    </>
  );
}

function ReloadRow() {
  const { t } = useLingui();
  return (
    <SettingRow
      label={t`Reload profile`}
      help={
        <p>
          <Trans>
            Re-reads .coilbox/profile.json and applies it to this window, so
            editing a profile does not need a restart. You stay on this page,
            but anything in progress elsewhere resets.
          </Trans>
        </p>
      }
      helpLabel={t`About reloading the profile`}
    >
      <Button type="button" variant="outline" size="sm" onClick={reloadProfile}>
        <RefreshCw aria-hidden />
        <Trans>Reload</Trans>
      </Button>
    </SettingRow>
  );
}

/**
 * Scaffolds a starter profile.json from how Coilbox is set up now. The result,
 * or why it failed, shows under the row's name.
 */
function CreateRow() {
  const { t } = useLingui();
  const { mode, accent } = useTheme();
  const features = useFeatureStates();
  const [fullscreen] = useFullscreenSetting();
  // The games a seeded `gameFilter` may name, from the same unitsync scan every
  // picker reads. A file name out of `games/` would seed a filter that matches
  // nothing, because a filter matches the name unitsync reports (issue #959).
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScaffoldResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scaffold = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      // A failed scan has no games to seed the filter from, and an empty list
      // would write a profile that says none are installed.
      if (scan.error) {
        const scanError = scan.error;
        throw new Error(
          t`The content scan failed, so the profile could not be seeded with the installed games. unitsync said: ${scanError}`,
        );
      }
      const installedGames = installedGameNames(scan.data?.games ?? []);
      const profile = buildScaffoldProfile({
        title: getProfile().title ?? "Coilbox",
        mode,
        accent,
        features,
        fullscreen,
        installedGames,
      });
      setResult(await scaffoldProfile(profile));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const path = result?.path ?? "";
  const description = !result
    ? undefined
    : result.written
      ? t`Wrote ${path}. Restart Coilbox to load it.`
      : t`A profile is already there: ${path}. Edit that file, then restart Coilbox to pick it up.`;

  return (
    <SettingRow
      label={t`Create profile.json`}
      description={description}
      error={error}
      help={
        <p>
          <Trans>
            Starts a distribution profile from how Coilbox is set up now. It is
            written to .coilbox/profile.json beside the app, and never
            overwrites a profile that is already there.
          </Trans>
        </p>
      }
      helpLabel={t`About creating a profile`}
    >
      {result?.written ? (
        <Button type="button" size="sm" onClick={() => void relaunch()}>
          <RotateCw aria-hidden />
          <Trans>Restart</Trans>
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void scaffold()}
        >
          {busy ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <FilePlus2 aria-hidden />
          )}
          <Trans>Create</Trans>
        </Button>
      )}
    </SettingRow>
  );
}
