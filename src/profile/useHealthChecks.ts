import { useEffect, useState } from "react";
import { campaignList } from "../campaign/bindings";
import { parseCampaignJson } from "../campaign/model";
import { contentStateLoad } from "../content/bindings";
import { dlInstalledContent, dlPathWritable } from "../downloads/bindings";
import { useDownloadsConfig } from "../downloads/config";
import {
  deriveHealthChecks,
  type HealthCheck,
  type HealthInputs,
} from "./health";
import {
  getProfile,
  getProfileError,
  getProfileRoot,
  getProfileSource,
} from "./profile";

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
          const acc = { bundled: 0, local: 0 };
          for (const item of r.items) {
            if (parseCampaignJson(item.json) === null) acc[item.source] += 1;
          }
          return acc;
        })
        .catch(() => ({ bundled: 0, local: 0 }));

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
