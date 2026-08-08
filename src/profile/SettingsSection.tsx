import { Button, useTheme } from "@picoframe/frame";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  ClipboardCheck,
  FilePlus2,
  Loader2,
  Package,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";
import { useUnitsyncScan } from "../content/config";
import { useAdvancedModeSetting } from "../general/advanced";
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
  const profile = getProfile();
  const source = getProfileSource();
  const loaded = source !== "default";

  if (!loaded) {
    return (
      <div className="space-y-8">
        <Header />
        <p className="text-sm text-muted-foreground">
          No distribution profile loaded — standard Coilbox.
        </p>
        <ProfileValidation />
        <ProfileAuthoring />
      </div>
    );
  }

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
    : "Default";

  return (
    <div className="space-y-8">
      <Header />
      <section className="space-y-3">
        <p className="text-sm text-muted-foreground">
          A distribution profile is active (loaded from{" "}
          <span className="font-medium text-foreground">{source}</span>). It
          reskins and narrows this build:
        </p>
        <dl className="divide-y divide-border rounded-md border border-border text-sm">
          <Row label="Title" value={profile.title ?? "Coilbox"} />
          <Row label="Colour scheme" value={profile.mode ?? "User choice"} />
          <Row label="Accent" value={profile.accent ?? "User choice"} />
          <Row
            label="Hidden features"
            value={hidden.length ? hidden.join(", ") : "None"}
          />
          <Row
            label="Hidden settings"
            value={hiddenSettings.length ? hiddenSettings.join(", ") : "None"}
          />
          <Row label="Game filter" value={filterText ?? "None"} />
          <Row label="Update repo" value={profile.release?.repo ?? "None"} />
          <Row
            label="Coilbox updates"
            value={profile.updater === false ? "Off" : "On"}
          />
          <Row
            label="Authoring tools"
            value={profile.authoring === false ? "Off" : "On"}
          />
          <Row label="Quit button" value={profile.quit ? "Shown" : "Hidden"} />
          <Row
            label="Welcome screen"
            value={profile.welcome ? "Custom" : "Default"}
          />
          <Row label="Home page" value={homeSummary} />
          <Row
            label="Theme overrides"
            value={themeCount ? `${themeCount} variable(s)` : "None"}
          />
        </dl>
      </section>
      <ProfileValidation />
      <ProfileAuthoring />
    </div>
  );
}

/**
 * On-demand profile validation. A "Validate profile" button runs the health checks
 * against the current profile and reveals the results inline — including the no-op
 * advisories (a `hide`/`hideSettings` id that matches nothing, an unknown link icon,
 * a zero-match game filter, a `home` entry that was dropped) that otherwise fail
 * silently — on a release build, with no console, this is the only place they show.
 * Remounting the checklist on
 * each click (via the `run` key) re-runs it, so it doubles as a manual refresh.
 */
function ProfileValidation() {
  const [run, setRun] = useState(0);
  return (
    <section className="space-y-3">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => setRun((n) => n + 1)}
      >
        <ClipboardCheck size={15} aria-hidden />
        {run === 0 ? "Validate profile" : "Re-run validation"}
      </Button>
      {run > 0 && <HealthChecklist key={run} />}
    </section>
  );
}

/**
 * Profile authoring tools (issue #406). Exactly one of the two is useful at a time, so
 * only one is shown. With a profile loaded, "Reload profile" re-reads the file and
 * re-applies it without an app restart. Without one, "Create profile.json" scaffolds a
 * starter from the current app state. Reload can't help before a profile exists,
 * because Coilbox resolves the portable folder once at startup and a folder with no
 * `profile.json` isn't one. The whole block goes away on `"authoring": false`, so a
 * shipped distribution doesn't hand players a way to reload or replace its branding.
 */
function ProfileAuthoring() {
  const { mode, accent } = useTheme();
  const [advanced] = useAdvancedModeSetting();
  const [fullscreen] = useFullscreenSetting();
  // The games a seeded `gameFilter` may name, from the same unitsync scan every
  // picker reads. A file name out of `games/` would seed a filter that matches
  // nothing, because a filter matches the name unitsync reports (issue #959).
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScaffoldResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isProfileAuthoringEnabled()) return null;
  const loaded = getProfileSource() !== "default";

  const scaffold = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const installedGames = installedGameNames(scan.data?.games ?? []);
      const profile = buildScaffoldProfile({
        title: getProfile().title ?? "Coilbox",
        mode,
        accent,
        advanced,
        fullscreen,
        installedGames,
      });
      setResult(await scaffoldProfile(profile));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Authoring
      </h3>
      <p className="text-sm text-muted-foreground">
        {loaded
          ? "Reload re-reads .coilbox/profile.json and applies it to this window, so editing a profile does not need an app restart. You stay on this page, but anything in progress elsewhere resets."
          : "Start a distribution profile from how Coilbox is set up right now. It is written to .coilbox/profile.json beside the app, and never overwrites a profile that is already there."}
      </p>
      <div className="flex flex-wrap gap-2">
        {loaded ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={reloadProfile}
          >
            <RefreshCw size={15} aria-hidden />
            Reload profile
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={busy}
            onClick={scaffold}
          >
            {busy ? (
              <Loader2 size={15} className="animate-spin" aria-hidden />
            ) : (
              <FilePlus2 size={15} aria-hidden />
            )}
            Create profile.json
          </Button>
        )}
      </div>
      {error && <p className="break-words text-sm text-destructive">{error}</p>}
      {result &&
        (result.written ? (
          <div className="space-y-2">
            <p className="text-sm">
              Wrote <Path value={result.path} />. Restart Coilbox to load it.
            </p>
            <Button type="button" size="sm" onClick={() => relaunch()}>
              Restart Coilbox
            </Button>
          </div>
        ) : (
          <p className="text-sm">
            A profile is already there: <Path value={result.path} />. Edit that
            file, then restart Coilbox to pick it up.
          </p>
        ))}
    </section>
  );
}

function Path({ value }: { value: string }) {
  return <span className="font-mono text-xs">{value}</span>;
}

function Header() {
  return (
    <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
      <Package size={15} /> Distribution profile
    </h2>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 px-3 py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
