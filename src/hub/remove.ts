/**
 * Undoing an import from the hub (feedback, 10 August 2026).
 *
 * The item page could say "Imported" and offer to open it, and that was the
 * whole of it. Somebody who imported a thing, looked at it and did not want it
 * had to work out for themselves where it had landed and delete it there.
 *
 * So Remove deletes it. Not "stop counting this as imported": the preset, run,
 * galaxy or scenario the import produced is destroyed, in the store its kind
 * lands in, and the import record goes with it so the item reads as never
 * imported.
 *
 * This is the wiring. It reads the four stores an import can land in, hands
 * them to `./removePlan.ts`, which decides what goes and what the reader should
 * be warned about, and turns that answer into the calls that delete. The
 * deciding is over there because it is worth testing and this is not testable:
 * importing the settings store pulls the whole app frame in behind it.
 */

import { useSetting } from "@picoframe/frame";
import { useCallback } from "react";
import { useCampaigns } from "@/campaign/campaigns";
import { scenarioIsAttached } from "@/campaign/missionScenario";
import { conquestDelete } from "@/conquest/bindings";
import {
  refreshGalaxies,
  useConquestState,
  useGalaxies,
} from "@/conquest/conquests";
import { useSkirmishPresets } from "@/play/presets";
import { useRuns } from "@/runlite/runs";
import { refreshScenarios, useScenarios } from "@/scenario/scenarios";
import { deleteScenario } from "@/scenario/storage";
import type { HubItem } from "./api";
import { HUB_IMPORTS_KEY, type HubImportRecord } from "./importRecord";
import {
  planRemoval,
  type RemovalPlan,
  type RemovalStores,
} from "./removePlan";

/** What pressing Remove will do, which is a plan plus the doing of it. */
export interface HubRemoval extends RemovalPlan {
  /** Resolves once everything is gone and the record has been dropped. */
  run: () => Promise<void>;
}

/**
 * How to remove any hub item, given what this install holds. Reads every store
 * an import can land in, so call it once per screen and call the returned
 * function per item.
 */
export function useHubRemoval(): (item: HubItem) => HubRemoval | null {
  const { presets, removePreset } = useSkirmishPresets();
  const { galaxies } = useGalaxies();
  const { file: conquestState, saveFor } = useConquestState();
  const { runs, deleteRun, refresh: refreshRuns } = useRuns();
  const { scenarios } = useScenarios();
  const { campaigns } = useCampaigns();
  const [records, setRecords] = useSetting<HubImportRecord[]>(
    HUB_IMPORTS_KEY,
    [],
  );

  const destroy = useCallback(
    async (removal: RemovalPlan) => {
      if (removal.store === "preset") {
        for (const t of removal.targets) removePreset(t.id);
        return;
      }
      if (removal.store === "run") {
        for (const t of removal.targets) await deleteRun(t.id);
        await refreshRuns();
        return;
      }
      if (removal.store === "galaxy") {
        for (const t of removal.targets) {
          await conquestDelete({ id: t.id });
          // Run state lives in its own file, keyed by galaxy id, so it outlives
          // the document unless it is cleared too.
          await saveFor(t.id, undefined);
        }
        // These lists are module caches with their own listeners, so every
        // screen showing one hears about the deletion rather than only the
        // screen that did it.
        await refreshGalaxies();
        return;
      }
      for (const t of removal.targets) {
        // A mission that attached this scenario still loads its dialogue clips
        // by file name, so those stay behind for it (issue #866).
        await deleteScenario(t.id, { keepMedia: t.keepMedia === true });
      }
      await refreshScenarios();
    },
    [removePreset, deleteRun, refreshRuns, saveFor],
  );

  return useCallback(
    (item: HubItem): HubRemoval | null => {
      const stores: RemovalStores = {
        presets: presets.map((p) => ({ id: p.id, name: p.name })),
        galaxies: galaxies
          .filter((g) => g.source === "local")
          .map((g) => ({ id: g.galaxy.id, title: g.galaxy.title })),
        playing: new Set(Object.keys(conquestState.conquests)),
        runs: Object.entries(runs).map(([id, run]) => ({ id, name: run.name })),
        scenarios: scenarios
          .filter((s) => s.source === "local")
          .map((s) => ({ id: s.scenario.id, name: s.scenario.name })),
        attached: new Set(
          scenarios
            .map((s) => s.scenario.id)
            .filter((id) =>
              scenarioIsAttached(
                campaigns.map((c) => c.campaign),
                id,
              ),
            ),
        ),
      };

      const found = planRemoval(
        item,
        records.find((r) => r.id === item.id),
        stores,
      );
      if (!found) return null;

      return {
        ...found,
        run: async () => {
          await destroy(found);
          setRecords(records.filter((r) => r.id !== item.id));
        },
      };
    },
    [
      records,
      setRecords,
      runs,
      galaxies,
      conquestState,
      scenarios,
      campaigns,
      presets,
      destroy,
    ],
  );
}
