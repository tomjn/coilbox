import { useEffect, useMemo, useState } from "react";
import { plugins } from "../app.plugins";
import { campaignList } from "../campaign/bindings";
import { parseCampaignJson } from "../campaign/model";
import { contentStateLoad } from "../content/bindings";
import { useUnitsyncScan } from "../content/config";
import { dlPathWritable } from "../downloads/bindings";
import { useDownloadsConfig } from "../downloads/config";
import { usePreferredTarget } from "../play/config";
import { scenarioList } from "../scenario/bindings";
import { parseStoredScenario } from "../scenario/storage";
import { installedGameNames } from "./authoring";
import {
  type CampaignFailure,
  deriveHealthChecks,
  type HealthCheck,
  type HealthInputs,
  type ScenarioFailure,
} from "./health";
import { HIDEABLE_NAV_IDS } from "./hidden";
import { describeJsonError } from "./jsonError";
import { linkIconNames } from "./links";
import {
  getProfile,
  getProfileError,
  getProfileErrorSnippet,
  getProfileRoot,
  getProfileSource,
} from "./profile";
import { describeScenarioFailure } from "./scenarioFailure";

/** The campaign's own `name`, or a placeholder when the JSON can't be read. */
function campaignName(json: string): string {
  try {
    const o = JSON.parse(json) as { name?: unknown };
    if (typeof o?.name === "string" && o.name.trim()) return o.name;
  } catch {
    // Unparseable — the syntax error (below) is the useful part.
  }
  return "(unnamed)";
}

/** Why a campaign was rejected: a located JSON syntax error, or a schema mismatch. */
function campaignError(json: string): string {
  try {
    JSON.parse(json);
  } catch (e) {
    return describeJsonError(json, e).message;
  }
  return "valid JSON but does not match the campaign schema";
}

/** Assemble health-check inputs and derive the checklist. Fails soft: any input
 * that can't be read falls back to an empty/neutral value, so the affected check
 * renders "unknown" rather than throwing. */
export function useHealthChecks(): { checks: HealthCheck[]; loading: boolean } {
  const [checks, setChecks] = useState<HealthCheck[]>([]);
  const [loading, setLoading] = useState(true);
  // Hook read at top level; feeds the effect (and re-runs it if the write root changes).
  const [cfg] = useDownloadsConfig();
  const writeRootId = cfg.writeRootId;
  // Which games are installed is a unitsync question, not a file-listing one, so
  // the panel asks the same scan every picker asks (issue #959). The result is
  // cached for the session, so this is usually free by the time Settings opens.
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const scannedGames = scan.data?.games;
  const installedGames = useMemo(
    () => (scannedGames ? installedGameNames(scannedGames) : null),
    [scannedGames],
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const portableRoot = getProfileRoot();

      const state = await contentStateLoad(undefined)
        .then((r) => r.state)
        .catch(() => null);
      const roots = (state?.roots ?? []).map((r) => ({
        path: r.path,
        portable: r.portable,
        engineCount: r.engines.length,
      }));
      const writeRootPath = writeRootId
        ? state?.roots.find((r) => r.id === writeRootId)?.path
        : undefined;

      const campaignFailures = await campaignList({})
        .then((r) => {
          const out: CampaignFailure[] = [];
          for (const item of r.items) {
            if (parseCampaignJson(item.json) !== null) continue;
            out.push({
              source: item.source,
              name: campaignName(item.json),
              error: campaignError(item.json),
            });
          }
          return out;
        })
        .catch(() => [] as CampaignFailure[]);

      // The same check over bundled scenarios (issue #962). A scenario a package
      // shipped that coilbox skipped is invisible otherwise: it does not appear
      // in the list, and the only trace is a console warning nobody reads.
      const scenarioFailures = await scenarioList({})
        .then((r) => {
          const out: ScenarioFailure[] = [];
          for (const item of r.items) {
            if (parseStoredScenario(item.json) !== null) continue;
            out.push({
              source: item.source,
              ...describeScenarioFailure(item.json),
            });
          }
          return out;
        })
        .catch(() => [] as ScenarioFailure[]);

      const probe = (path: string | undefined) =>
        path
          ? dlPathWritable({ path })
              .then((r) => ({ writable: r.writable, error: r.error }))
              .catch(() => undefined)
          : Promise.resolve(undefined);

      const dataDirPath = portableRoot ? `${portableRoot}/data` : undefined;
      const [writeRootProbe, dataDirProbe] = await Promise.all([
        probe(writeRootPath),
        probe(dataDirPath),
      ]);

      if (cancelled) return;

      const profile = getProfile();
      // Every settings-section id in the app — the set `hideSettings` can affect
      // (applyProfileSettingsHiding wraps them all). The authoritative source of truth.
      const settingsIds = plugins.flatMap(
        (p) => p.settings?.map((s) => s.id) ?? [],
      );
      // Non-empty icon names on the profile's links; blanks fall back on purpose.
      const linkIcons = (profile.links ?? [])
        .map((l) => l.icon)
        .filter((i): i is string => typeof i === "string" && i.trim() !== "");

      const inputs: HealthInputs = {
        portableRoot,
        profileSource: getProfileSource(),
        profileError: getProfileError(),
        profileErrorSnippet: getProfileErrorSnippet(),
        gameFilter: profile.gameFilter,
        roots,
        installedGames,
        writeRootPath,
        campaignFailures,
        scenarioFailures,
        writable: { writeRoot: writeRootProbe, dataDir: dataDirProbe },
        hide: profile.hide ?? [],
        hideableNavIds: HIDEABLE_NAV_IDS,
        hideSettings: profile.hideSettings ?? [],
        settingsIds,
        linkIcons,
        validIconNames: linkIconNames(),
      };
      setChecks(deriveHealthChecks(inputs));
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [writeRootId, installedGames]);

  return { checks, loading };
}
