import { useEffect, useState } from "react";
import { campaignList } from "../campaign/bindings";
import { parseCampaignJson } from "../campaign/model";
import { contentStateLoad } from "../content/bindings";
import { dlInstalledContent, dlPathWritable } from "../downloads/bindings";
import { useDownloadsConfig } from "../downloads/config";
import {
  type CampaignFailure,
  deriveHealthChecks,
  type HealthCheck,
  type HealthInputs,
} from "./health";
import { describeJsonError } from "./jsonError";
import {
  getProfile,
  getProfileError,
  getProfileErrorSnippet,
  getProfileRoot,
  getProfileSource,
} from "./profile";

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
      const rootPaths = roots.map((r) => r.path);
      const writeRootPath = writeRootId
        ? state?.roots.find((r) => r.id === writeRootId)?.path
        : undefined;

      const installedGames = rootPaths.length
        ? await dlInstalledContent({ paths: rootPaths })
            .then((r) => r.games)
            .catch(() => [] as string[])
        : [];

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

      const inputs: HealthInputs = {
        portableRoot,
        profileSource: getProfileSource(),
        profileError: getProfileError(),
        profileErrorSnippet: getProfileErrorSnippet(),
        gameFilter: getProfile().gameFilter,
        roots,
        installedGames,
        writeRootPath,
        campaignFailures,
        writable: { writeRoot: writeRootProbe, dataDir: dataDirProbe },
      };
      setChecks(deriveHealthChecks(inputs));
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [writeRootId]);

  return { checks, loading };
}
