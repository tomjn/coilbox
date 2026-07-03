import type { MapItem } from "@/content/bindings";
import { useUnitsyncMinimap, useUnitsyncThumbnails } from "@/content/config";
import { MapCard } from "@/play/pages/components/MapCard";
import type { Battle } from "../bindings";
import type { MemberRow } from "./config";
import { MissingMapBox } from "./MissingMapBox";
import { StartBoxOverlay } from "./StartBoxOverlay";

/**
 * The battle's map, rendered through the shared singleplayer `MapCard` so it
 * carries the same minimap + name + info tags. Adds an ally start-box overlay for
 * "choose in-game" battles (hiding the fixed-position dots, which don't apply
 * then), and repurposes the picker as a map *suggestion* to the autohost (`!map`)
 * — our own selection never changes the local view; the host's does.
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
  onSuggestMap,
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
  onSuggestMap: (name: string) => void;
  onRescan: () => Promise<void>;
}) {
  const minimap = useUnitsyncMinimap(enginePath, dataDir, battle.map);
  const { thumbs } = useUnitsyncThumbnails(enginePath, dataDir);

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
      onSelectMap={onSuggestMap}
      selectLabel="Suggest map"
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
