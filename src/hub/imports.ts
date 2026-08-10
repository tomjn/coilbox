/**
 * The hub's "do you already have this" answer, wired to the four stores an
 * import can land in (issue #1368). The record shape and the reasoning live in
 * `./importRecord.ts`, which has no stores in it so the deep-link handler can
 * use the same record without pulling every play surface in behind it.
 *
 * A setup pack that bundles no presets leaves no ids behind, so its record
 * carries the games and maps it asked for instead, by name, and reads as
 * "here" only once the installed content scan confirms every one of them is
 * still installed.
 */

import { useSetting } from "@picoframe/frame";
import { useCallback, useMemo, useRef } from "react";
import { useGalaxies } from "@/conquest/conquests";
import { useUnitsyncScan } from "@/content/config";
import { usePreferredTarget } from "@/play/config";
import { presetRoute, useSkirmishPresets } from "@/play/presets";
import { useRuns } from "@/runlite/runs";
import { scenarioRoute, useScenarios } from "@/scenario/scenarios";
import type { HubItem } from "./api";
import { useReportHubImport } from "./importCount";
import {
  HUB_IMPORTS_KEY,
  type HubImportRecord,
  type HubItemPresence,
  presenceOf,
  withRecord,
} from "./importRecord";

/**
 * Record what an import produced, for the importers to call once they have
 * saved. `hubItemId` is undefined for every import that did not come from the
 * browse screen (a pasted code, a file), and those record nothing.
 *
 * This is also where the hub is told the import happened (issue #1361), because
 * this is the one point that knows both that an import completed and which item
 * it was. The report is sent once per completed import and cannot affect it: see
 * `./importCount`.
 */
export function useRecordHubImport() {
  const [records, setRecords] = useSetting<HubImportRecord[]>(
    HUB_IMPORTS_KEY,
    [],
  );
  const reportImport = useReportHubImport();
  // An importer holds this callback for as long as its drawer is open, so read
  // the list through a ref rather than closing over one render's copy of it.
  const latest = useRef(records);
  latest.current = records;
  return useCallback(
    (
      hubItemId: string | undefined,
      refs: string[],
      route: string,
      content?: { games: string[]; maps: string[] },
    ) => {
      if (!hubItemId) return;
      setRecords(
        withRecord(latest.current, {
          id: hubItemId,
          refs,
          route,
          at: new Date().toISOString(),
          content,
        }),
      );
      reportImport(hubItemId);
    },
    [setRecords, reportImport],
  );
}

/**
 * Ask where any hub item stands with this install. Reads the four local stores
 * a hub import can land in, so it costs a listing of each: use it once per
 * screen and call the returned function per item.
 *
 * Meant to be shared. The browse screen shows it on a card, and an item page
 * (issue #1366) has room to say it properly.
 */
export function useHubItemPresence(): (item: HubItem) => HubItemPresence {
  const { presets } = useSkirmishPresets();
  const { galaxies, loading: galaxiesLoading } = useGalaxies();
  const { runs, loading: runsLoading } = useRuns();
  const { scenarios, loading: scenariosLoading } = useScenarios();
  const [records] = useSetting<HubImportRecord[]>(HUB_IMPORTS_KEY, []);
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);

  const presetIds = useMemo(() => new Set(presets.map((p) => p.id)), [presets]);
  const installed = useMemo(
    () =>
      scan.data
        ? {
            games: new Set(scan.data.games.map((g) => g.name)),
            maps: new Set(scan.data.maps.map((m) => m.name)),
          }
        : null,
    [scan.data],
  );
  const galaxyIds = useMemo(
    () => (galaxiesLoading ? null : new Set(galaxies.map((g) => g.galaxy.id))),
    [galaxies, galaxiesLoading],
  );
  const runIds = useMemo(
    () => (runsLoading ? null : new Set(Object.keys(runs))),
    [runs, runsLoading],
  );
  const scenarioIds = useMemo(
    () =>
      scenariosLoading ? null : new Set(scenarios.map((s) => s.scenario.id)),
    [scenarios, scenariosLoading],
  );
  const byId = useMemo(
    () => new Map(records.map((r) => [r.id, r] as const)),
    [records],
  );

  return useCallback(
    (item: HubItem) => {
      const local =
        item.kind === "scenario"
          ? scenarioIds
          : item.kind === "challenge"
            ? item.mode === "warpath"
              ? runIds
              : galaxyIds
            : // A preset, and a setup pack's bundled presets, land in the
              // same store.
              presetIds;
      // A challenge's recorded route already names its galaxy or its run, so
      // only the other kinds need an address building for them (issue #1372).
      // A setup pack opens the first of its bundled presets that is still
      // here. When none of its presets survive but the games and maps it
      // named are still installed, Open needs somewhere else real to land:
      // the recorded route can name a preset from that same import, which is
      // exactly the one just found to be gone.
      const routeFor =
        item.kind === "scenario"
          ? scenarioRoute
          : item.kind === "challenge"
            ? undefined
            : presetRoute;
      const contentRoute =
        item.kind === "setup-pack" ? "/downloads/maps" : undefined;
      return presenceOf(
        byId.get(item.id),
        local,
        routeFor,
        installed,
        contentRoute,
      );
    },
    [byId, presetIds, galaxyIds, runIds, scenarioIds, installed],
  );
}
