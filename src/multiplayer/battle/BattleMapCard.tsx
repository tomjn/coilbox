import { Button } from "@picoframe/frame";
import { useEffect, useState } from "react";
import type { MapItem } from "@/content/bindings";
import {
  useUnitsyncMapInfo,
  useUnitsyncMinimap,
  useUnitsyncThumbnails,
} from "@/content/config";
import { useBarMapPreview } from "@/downloads/config";
import { MapCard } from "@/play/pages/components/MapCard";
import {
  MapLayerToggle,
  MapOverlayImage,
  useMapOverlayLayer,
} from "@/play/pages/components/MapOverlay";
import type { Battle, StartRect } from "../bindings";
import { allyLetter, hexToI32, type MemberRow, readableText } from "./config";
import { MissingMapBox } from "./MissingMapBox";
import { StartBoxEditor } from "./StartBoxEditor";
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
  mapsLoading,
  localMap,
  mapMissing,
  startPosType,
  selfHost,
  canEditBoxes,
  activeAlly,
  onSetBox,
  onSuggestMap,
  onChangeMap,
  onRescan,
}: {
  battle: Battle;
  rows: MemberRow[];
  enginePath: string | undefined;
  dataDir: string | undefined;
  maps: MapItem[];
  /** The map list is still being scanned, so no maps are available yet. */
  mapsLoading: boolean;
  localMap: MapItem | undefined;
  mapMissing: boolean;
  startPosType: number;
  /** We host this battle: the picker changes the map instead of suggesting it. */
  selfHost: boolean;
  /** Host may draw/clear boxes (host privilege AND choose-in-game mode). */
  canEditBoxes: boolean;
  /** The ally (0-based) the next drawn box belongs to (`useStartBoxAllies`). */
  activeAlly: number;
  /** Commit one ally's box (0-based) on drag release. */
  onSetBox: (ally: number, rect: StartRect) => void;
  onSuggestMap: (name: string) => void;
  onChangeMap: (name: string, maphash: number) => void;
  onRescan: () => Promise<void>;
}) {
  const minimap = useUnitsyncMinimap(enginePath, dataDir, battle.map);
  const { thumbs } = useUnitsyncThumbnails(enginePath, dataDir);

  // When the map isn't installed, unitsync can't render a minimap, so fall back to
  // BAR's remote preview thumbnail (keyed by the battle's springName) behind the
  // download controls instead of a blank box. Only fetched while the map is missing.
  const remotePreview = useBarMapPreview(mapMissing ? battle.map : undefined);

  // Terrain overlay toggle: reuse the content-side metal/height infomap renders on
  // the battle minimap so hosts/players can read terrain when placing start boxes.
  // Each render is fetched lazily (only when its layer is active) and cached, so the
  // common minimap-only view stays as cheap as before.
  const { layer, setLayer, overlayUrl } = useMapOverlayLayer(
    enginePath,
    dataDir,
    battle.map,
  );
  // Overlays only make sense once the map is installed and its minimap resolves.
  const canOverlay = !!localMap && !mapMissing && !!minimap.url;

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
    <div className="space-y-2">
      <MapCard
        map={displayMap}
        maps={maps}
        mapsLoading={mapsLoading}
        thumbs={thumbs}
        minimapUrl={minimap.url}
        startPositions={startPositions}
        minimapLoading={minimap.loading}
        markerColors={markerColors}
        env={minimap.env}
        // Dim the base minimap while a terrain overlay is shown so the metal /
        // height layer reads clearly over it.
        dimBase={!!overlayUrl}
        onSelectMap={selfHost ? setPendingMap : onSuggestMap}
        selectLabel={
          selfHost
            ? pendingMap
              ? "Changing map…"
              : "Change map"
            : "Suggest map"
        }
        overlayInteractive={canEditBoxes}
        overlay={
          <>
            {overlayUrl && (
              // Under the start boxes and pointer-transparent, so the editor's
              // drag surface and the picker button are unaffected.
              <MapOverlayImage src={overlayUrl} />
            )}
            {canEditBoxes ? (
              <StartBoxEditor
                rects={battle.startRects}
                allyColors={allyColors}
                activeAlly={activeAlly}
                onCommit={onSetBox}
              />
            ) : showBoxes ? (
              <StartBoxOverlay
                rects={battle.startRects}
                allyColors={allyColors}
              />
            ) : null}
          </>
        }
        placeholder={
          mapMissing ? (
            <MissingMapBox
              battleId={battle.id}
              mapName={battle.map}
              onRescan={onRescan}
              previewUrl={remotePreview}
            />
          ) : undefined
        }
      />

      {canOverlay && <MapLayerToggle layer={layer} onChange={setLayer} />}
    </div>
  );
}
