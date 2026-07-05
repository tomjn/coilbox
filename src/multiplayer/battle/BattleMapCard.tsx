import { useEffect, useState } from "react";
import type { MapItem } from "@/content/bindings";
import {
  useUnitsyncMapInfo,
  useUnitsyncMinimap,
  useUnitsyncThumbnails,
} from "@/content/config";
import { MapCard } from "@/play/pages/components/MapCard";
import type { Battle } from "../bindings";
import { hexToI32, type MemberRow } from "./config";
import { MissingMapBox } from "./MissingMapBox";
import { StartBoxOverlay } from "./StartBoxOverlay";

/**
 * The battle's map, rendered through the shared singleplayer `MapCard` so it
 * carries the same minimap + name + info tags. Adds an ally start-box overlay for
 * "choose in-game" battles (hiding the fixed-position dots, which don't apply
 * then). When we host the battle ourselves the picker changes the map directly
 * (`onChangeMap` → UPDATEBATTLEINFO); otherwise it's a *suggestion* to the
 * autohost (`!map`) — a suggestion never changes the local view, the host's does.
 */
export function BattleMapCard({
  battle,
  rows,
  enginePath,
  dataDir,
  maps,
  localMap,
  mapMissing,
  startPosType,
  selfHost,
  onSuggestMap,
  onChangeMap,
  onRescan,
}: {
  battle: Battle;
  rows: MemberRow[];
  enginePath: string | undefined;
  dataDir: string | undefined;
  maps: MapItem[];
  localMap: MapItem | undefined;
  mapMissing: boolean;
  startPosType: number;
  /** We host this battle: the picker changes the map instead of suggesting it. */
  selfHost: boolean;
  onSuggestMap: (name: string) => void;
  onChangeMap: (name: string, maphash: number) => void;
  onRescan: () => Promise<void>;
}) {
  const minimap = useUnitsyncMinimap(enginePath, dataDir, battle.map);
  const { thumbs } = useUnitsyncThumbnails(enginePath, dataDir);

  // As host, changing the map needs the new map's CRC for UPDATEBATTLEINFO so
  // joiners can sync. The checksum comes from the unitsync worker (a hook keyed
  // on map name), so a pick stashes the name and we fire onChangeMap once its
  // info resolves; a hash failure just drops the pick.
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

  const players = rows
    .filter((r) => !r.spectator)
    .sort((a, b) => a.teamId - b.teamId);
  const markerColors = players.map((r) => r.colorHex);
  const allyColors: Record<number, string> = {};
  for (const r of players) {
    if (allyColors[r.ally] == null) allyColors[r.ally] = r.colorHex;
  }

  const boxMode = startPosType === 2;
  const showBoxes = boxMode && Object.keys(battle.startRects).length > 0;
  const startPositions = boxMode ? [] : minimap.startPositions;

  // Synthesize a bare map so the card still shows the battle's map name when it
  // isn't installed locally (the minimap then falls back to "No minimap").
  const displayMap: MapItem = localMap ?? {
    name: battle.map,
    archives: [],
    info: {},
  };

  return (
    <MapCard
      map={displayMap}
      maps={maps}
      thumbs={thumbs}
      minimapDataUrl={minimap.dataUrl}
      startPositions={startPositions}
      minimapLoading={minimap.loading}
      markerColors={markerColors}
      env={minimap.env}
      onSelectMap={selfHost ? setPendingMap : onSuggestMap}
      selectLabel={
        selfHost ? (pendingMap ? "Changing map…" : "Change map") : "Suggest map"
      }
      overlay={
        showBoxes ? (
          <StartBoxOverlay rects={battle.startRects} allyColors={allyColors} />
        ) : undefined
      }
      placeholder={
        mapMissing ? (
          <MissingMapBox mapName={battle.map} onRescan={onRescan} />
        ) : undefined
      }
    />
  );
}
