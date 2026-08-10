/**
 * The hub's "do you already have this" answer, wired to the four stores an
 * import can land in (issue #1368). The record shape and the reasoning live in
 * `./importRecord.ts`, which has no stores in it so the deep-link handler can
 * use the same record without pulling every play surface in behind it.
 *
 * A setup pack that bundles no presets leaves nothing behind at all, so its
 * record has no ids in it and reads as "imported before", never as "you have
 * this". That is the honest answer: its engine, game and maps may well still be
 * installed, but the pack itself left nothing to point at.
 */

import { useSetting } from "@picoframe/frame";
import { useCallback, useMemo, useRef } from "react";
import { useGalaxies } from "@/conquest/conquests";
import { useSkirmishPresets } from "@/play/presets";
import { useRuns } from "@/runlite/runs";
import { useScenarios } from "@/scenario/scenarios";
import type { HubItem } from "./api";
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
 */
export function useRecordHubImport() {
  const [records, setRecords] = useSetting<HubImportRecord[]>(
    HUB_IMPORTS_KEY,
    [],
  );
  // An importer holds this callback for as long as its drawer is open, so read
  // the list through a ref rather than closing over one render's copy of it.
  const latest = useRef(records);
  latest.current = records;
  return useCallback(
    (hubItemId: string | undefined, refs: string[], route: string) => {
      if (!hubItemId) return;
      setRecords(
        withRecord(latest.current, {
          id: hubItemId,
          refs,
          route,
          at: new Date().toISOString(),
        }),
      );
    },
    [setRecords],
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

  const presetIds = useMemo(() => new Set(presets.map((p) => p.id)), [presets]);
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
      return presenceOf(byId.get(item.id), local);
    },
    [byId, presetIds, galaxyIds, runIds, scenarioIds],
  );
}
