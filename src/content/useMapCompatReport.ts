import { useEffect, useMemo, useState } from "react";
import { unitsyncLuaExec } from "./bindings";
import { useUnitsyncArchiveTree } from "./config";
import { shareInFlight } from "./inFlight";
import {
  buildMapReport,
  MAPINFO_ENTRIES_LUA,
  type MapInfoEntry,
  parseMapInfoEntries,
} from "./mapCompatReport";

/** Session cache of evaluated mapinfo files, keyed by `dataDir::enginePath::archive`. */
const mapinfoCache = new Map<string, MapInfoEntry[]>();
const mapinfoPending = new Map<string, Promise<MapInfoEntry[]>>();
const NO_READ = { entries: null, error: null } as const;

async function readMapInfoEntries(
  enginePath: string,
  dataDir: string,
  archive: string,
): Promise<MapInfoEntry[]> {
  const res = await unitsyncLuaExec({
    enginePath,
    dataDir,
    archive,
    source: MAPINFO_ENTRIES_LUA,
  });
  if (res.error) throw new Error(res.error);
  return parseMapInfoEntries(res.result);
}

/** The map's `mapinfo.lua`, evaluated, once `enabled` says it has one. */
function useMapInfoEntries(
  enabled: boolean,
  enginePath?: string,
  dataDir?: string,
  archive?: string,
) {
  const key =
    enabled && enginePath && dataDir && archive
      ? `${dataDir}::${enginePath}::${archive}`
      : undefined;
  const [state, setState] = useState<{
    key?: string;
    entries: MapInfoEntry[] | null;
    error: string | null;
  }>(NO_READ);

  useEffect(() => {
    if (!enginePath || !dataDir || !archive || !key) return;
    const cached = mapinfoCache.get(key);
    if (cached) {
      setState({ key, entries: cached, error: null });
      return;
    }
    let cancelled = false;
    shareInFlight(mapinfoPending, key, () =>
      readMapInfoEntries(enginePath, dataDir, archive),
    )
      .then((entries) => {
        if (cancelled) return;
        mapinfoCache.set(key, entries);
        setState({ key, entries, error: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({
          key,
          entries: null,
          error: e instanceof Error ? e.message : String(e),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [enginePath, dataDir, archive, key]);

  return state.key === key ? state : NO_READ;
}

/**
 * What would stop a map loading on the current engine (issue #4565), from the
 * map archive's member list and its evaluated `mapinfo.lua`. Empty until the
 * member list answers, since an empty list would claim the map has no
 * settings. The `mapinfo.lua` rows join when its read answers.
 */
export function useMapCompatReport(
  enginePath?: string,
  dataDir?: string,
  archive?: string,
) {
  const { tree } = useUnitsyncArchiveTree(enginePath, dataDir, archive);
  const hasMapinfo =
    tree?.files.some((f) => f.path.toLowerCase() === "mapinfo.lua") ?? false;
  const mapinfo = useMapInfoEntries(hasMapinfo, enginePath, dataDir, archive);
  return useMemo(() => {
    if (!tree) return [];
    return buildMapReport({
      files: tree.files.map((f) => f.path),
      mapinfo: mapinfo.entries,
      errors: [
        ...tree.errors,
        ...(mapinfo.error ? [`mapinfo.lua: ${mapinfo.error}`] : []),
      ],
    });
  }, [tree, mapinfo]);
}
