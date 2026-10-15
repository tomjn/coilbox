import { useEffect, useMemo, useState } from "react";
import type {
  GameItem,
  MatchSetup,
  ReplayUnitOrders,
  UnitDatasetEntry,
} from "./bindings";
import {
  loadUnitsyncUnitDataset,
  useScanTargetSelection,
  useUnitsyncScan,
} from "./config";
import { streamNaming } from "./unitUsage";

/** The archive and the setup a read's name holds (`StreamNaming.read`). */
function splitRead(read: string): [string, MatchSetup | undefined] {
  const at = read.indexOf("\n");
  return at < 0
    ? [read, undefined]
    : [read.slice(0, at), JSON.parse(read.slice(at + 1)) as MatchSetup];
}

/** One list, so a render with nothing installed does not look like a change. */
const NOTHING_INSTALLED: GameItem[] = [];

/**
 * The games installed under the selected engine and data directory. `installed`
 * is null until the scan has answered. With no engine to scan with, or a scan
 * that failed, nothing is installed as far as naming goes.
 */
export function useInstalledGames() {
  const { selected } = useScanTargetSelection();
  const enginePath = selected?.enginePath;
  const rootPath = selected?.rootPath;
  const scan = useUnitsyncScan(enginePath, rootPath);
  const installed =
    scan.data?.games ?? (scan.error || !selected ? NOTHING_INSTALLED : null);
  return { installed, enginePath, rootPath };
}

/**
 * Each read of an installed game's units that some replay is named from, by the
 * read's name (`StreamNaming.read`): the units, or null once a read has failed
 * or come back empty, so a read is tried once and "still reading" has an end.
 * Replays of one game with one match setup share a read, and the reads are made
 * one after another, because a setup that changes a game's unit list runs the
 * game's definitions again (#3847).
 */
export function useUnitListReads(
  replays: ReadonlyMap<string, ReplayUnitOrders> | undefined,
  lists: ReadonlyMap<string, UnitDatasetEntry[]> | undefined,
  installed: GameItem[] | null,
  enginePath: string | undefined,
  rootPath: string | undefined,
): ReadonlyMap<string, UnitDatasetEntry[] | null> {
  // As text, so the effect depends on what it says.
  const readsKey = useMemo(() => {
    if (!replays || !lists || !installed) return "";
    const reads = new Set<string>();
    for (const replay of replays.values()) {
      const naming = streamNaming(replay, lists, installed);
      if (naming.kind === "installed") reads.add(naming.read);
    }
    return JSON.stringify([...reads].sort());
  }, [replays, lists, installed]);

  const [datasets, setDatasets] = useState<
    ReadonlyMap<string, UnitDatasetEntry[] | null>
  >(() => new Map());

  useEffect(() => {
    if (!readsKey || !enginePath || !rootPath) return;
    let live = true;
    void (async () => {
      for (const read of JSON.parse(readsKey) as string[]) {
        if (!live) return;
        const [archive, setup] = splitRead(read);
        const units = await loadUnitsyncUnitDataset(
          enginePath,
          rootPath,
          archive,
          setup,
        ).then(
          (dataset) => (dataset.units.length > 0 ? dataset.units : null),
          () => null,
        );
        if (live) setDatasets((before) => new Map(before).set(read, units));
      }
    })();
    return () => {
      live = false;
    };
  }, [readsKey, enginePath, rootPath]);

  return datasets;
}
