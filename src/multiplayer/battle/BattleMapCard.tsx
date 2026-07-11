import { Button } from "@picoframe/frame";
import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { MapItem } from "@/content/bindings";
import {
  useUnitsyncMapInfo,
  useUnitsyncMinimap,
  useUnitsyncThumbnails,
} from "@/content/config";
import { MapCard } from "@/play/pages/components/MapCard";
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
  localMap,
  mapMissing,
  startPosType,
  selfHost,
  canEditBoxes,
  hostCanEdit,
  onSetBox,
  onClearBox,
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
  /** Host may draw/clear boxes (host privilege AND choose-in-game mode). */
  canEditBoxes: boolean;
  /** Host may edit options at all — drives the "enable box mode" hint below. */
  hostCanEdit: boolean;
  /** Commit one ally's box (0-based) on drag release. */
  onSetBox: (ally: number, rect: StartRect) => void;
  /** Clear one ally's box (0-based). */
  onClearBox: (ally: number) => void;
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

  // Box-editing UI (host only). The ally the next drawn box belongs to defaults to
  // the lowest ally without a box; the host can pick another from the roster's
  // allies (plus any ally that already has a box).
  const allySet = new Set<number>();
  for (const k of Object.keys(allyColors)) allySet.add(Number(k));
  for (const k of Object.keys(battle.startRects)) allySet.add(Number(k));
  const sortedAllies = [...allySet].sort((a, b) => a - b);
  const allyList = sortedAllies.length > 0 ? sortedAllies : [0, 1];
  const [pickedAlly, setPickedAlly] = useState<number | null>(null);
  const activeAlly =
    pickedAlly ??
    allyList.find((a) => !battle.startRects[String(a)]) ??
    allyList[0];
  const clearAll = () => {
    for (const k of Object.keys(battle.startRects)) onClearBox(Number(k));
  };

  // Synthesize a bare map so the card still shows the battle's map name when it
  // isn't installed locally (the minimap then falls back to "No minimap").
  const displayMap: MapItem = localMap ?? {
    name: battle.map,
    archives: [],
    info: {},
  };

  const hasBoxes = Object.keys(battle.startRects).length > 0;
  const activeHasBox = !!battle.startRects[String(activeAlly)];

  return (
    <div className="space-y-2">
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
          selfHost
            ? pendingMap
              ? "Changing map…"
              : "Change map"
            : "Suggest map"
        }
        overlay={
          canEditBoxes ? (
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
          ) : undefined
        }
        placeholder={
          mapMissing ? (
            <MissingMapBox mapName={battle.map} onRescan={onRescan} />
          ) : undefined
        }
      />

      {canEditBoxes && (
        <div className="space-y-2 rounded-lg border border-border/50 bg-card p-3 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold">Start boxes</span>
            <Button
              variant="ghost"
              size="sm"
              disabled={!hasBoxes}
              onClick={clearAll}
            >
              Clear all
            </Button>
          </div>
          <p className="text-muted-foreground">
            Drag on the map to draw ally {allyLetter(activeAlly)}'s box; drag a
            box to move it, its handles to resize.
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {allyList.map((a) => {
              const color = allyColors[a] ?? "#e5e7eb";
              const active = a === activeAlly;
              return (
                <button
                  key={a}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setPickedAlly(a)}
                  className={`flex size-6 items-center justify-center rounded font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "ring-2 ring-foreground" : "opacity-70 hover:opacity-100"}`}
                  style={{ background: color, color: readableText(color) }}
                  title={`Ally ${allyLetter(a)}${battle.startRects[String(a)] ? " (has box)" : ""}`}
                >
                  {allyLetter(a)}
                </button>
              );
            })}
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={!activeHasBox}
            onClick={() => onClearBox(activeAlly)}
          >
            Clear ally {allyLetter(activeAlly)}
          </Button>
        </div>
      )}

      {!canEditBoxes && hostCanEdit && (
        <Alert variant="warning" className="px-3 py-2">
          <AlertDescription className="text-xs">
            Start boxes need the "Choose in-game" start-position mode — set it
            in Battle options to draw them.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
