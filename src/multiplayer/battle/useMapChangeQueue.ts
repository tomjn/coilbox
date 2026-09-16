import { useEffect, useState } from "react";
import { useUnitsyncMapInfo } from "@/content/config";
import { hexToI32 } from "./config";

/**
 * As host, changing the map needs the new map's CRC for UPDATEBATTLEINFO so
 * joiners can sync. The checksum comes from the unitsync worker (a hook keyed
 * on map name), so a request stashes the name and fires `onChangeMap` once its
 * info resolves. A hash failure just drops the request. Shared by the map
 * picker (`BattleMapCard`) and the chat "Accept" button on a `!map` suggestion
 * (`BattleChatCard`), so both wait on the same worker call rather than each
 * running their own copy.
 */
export function useMapChangeQueue(
  enginePath: string | undefined,
  dataDir: string | undefined,
  onChangeMap: (name: string, maphash: number) => void,
): {
  /** The map a change is in flight for, or null when none is pending. */
  pendingMap: string | null;
  /** Queue a map change: waits for its checksum, then calls `onChangeMap`. */
  requestMapChange: (name: string) => void;
} {
  const [pendingMap, setPendingMap] = useState<string | null>(null);
  const pendingInfo = useUnitsyncMapInfo(
    enginePath,
    dataDir,
    pendingMap ?? undefined,
  );
  useEffect(() => {
    if (!pendingMap) return;
    if (pendingInfo.status === "ready") {
      onChangeMap(pendingMap, hexToI32(pendingInfo.info?.checksum));
      setPendingMap(null);
    } else if (
      pendingInfo.status === "error" ||
      pendingInfo.status === "unsyncable"
    ) {
      setPendingMap(null);
    }
  }, [pendingMap, pendingInfo.status, pendingInfo.info, onChangeMap]);
  return { pendingMap, requestMapChange: setPendingMap };
}
