import { useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useState } from "react";
import { describeError } from "@/i18n/uiError";
import { useUnitDefs } from "@/workshop/config";
import { type LuaCompatResult, unitsyncLuaCompatScan } from "./bindings";
import { buildReport } from "./compatReport";
import { useUnitsyncArchiveTree } from "./config";
import { shareInFlight } from "./inFlight";

/** Session cache of Lua scans, keyed by `dataDir::enginePath::archive`. */
const luaCache = new Map<string, LuaCompatResult>();
const luaPending = new Map<string, Promise<LuaCompatResult>>();
const NO_SCAN = { result: null, error: null } as const;

function useLuaCompatScan(
  enginePath?: string,
  dataDir?: string,
  archiveName?: string,
) {
  const key =
    enginePath && dataDir && archiveName
      ? `${dataDir}::${enginePath}::${archiveName}`
      : undefined;
  const [state, setState] = useState<{
    key?: string;
    result: LuaCompatResult | null;
    error: string | null;
  }>({ result: null, error: null });

  useEffect(() => {
    if (!enginePath || !dataDir || !archiveName || !key) return;
    const cached = luaCache.get(key);
    if (cached) {
      setState({ key, result: cached, error: null });
      return;
    }
    let cancelled = false;
    shareInFlight(luaPending, key, () =>
      unitsyncLuaCompatScan({ enginePath, dataDir, archiveName }),
    )
      .then((res) => {
        if (cancelled) return;
        luaCache.set(key, res);
        setState({ key, result: res, error: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({
          key,
          result: null,
          error: describeError(e),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [enginePath, dataDir, archiveName, key]);

  return state.key === key ? state : NO_SCAN;
}

/**
 * What would stop a game running on the current engine (issue #4554), from
 * three reads of its primary archive: the member list, the Lua scan and the
 * unit defs. Empty until the member list answers, since every file check
 * reads it and an empty list would claim the game has no widgets. The Lua and
 * def rows join as their reads answer.
 */
export function useCompatReport(
  enginePath?: string,
  dataDir?: string,
  gameArchive?: string,
) {
  const { tree, loading: treeLoading } = useUnitsyncArchiveTree(
    enginePath,
    dataDir,
    gameArchive,
  );
  const lua = useLuaCompatScan(enginePath, dataDir, gameArchive);
  const {
    defs,
    defsFor,
    error: defsError,
    loading: defsLoading,
  } = useUnitDefs(enginePath, dataDir, gameArchive);
  const { t } = useLingui();
  const findings = useMemo(() => {
    if (!tree) return [];
    const errors = [
      ...tree.errors,
      ...(lua.error ? [t`Lua scan: ${lua.error}`] : []),
      ...(defsError ? [t`Unit defs: ${defsError}`] : []),
    ];
    return buildReport({
      files: tree.files.map((f) => f.path),
      lua: lua.result,
      defs: defsFor === gameArchive ? defs : null,
      errors,
    });
  }, [tree, lua, defs, defsFor, defsError, gameArchive, t]);
  const asked = !!(enginePath && dataDir && gameArchive);
  return {
    findings,
    archivePath: tree?.archivePath,
    /** A read is still out, so more findings may join. */
    checking:
      asked && (treeLoading || (!lua.result && !lua.error) || defsLoading),
    /** The member list was read, so an empty report means nothing was found. */
    read: tree != null,
  };
}
