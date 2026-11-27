import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { ImageOff, Loader2, ScanSearch } from "lucide-react";
import { type ReactNode, useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { DemoInfo } from "../../bindings";
import { useUnitsyncHeightmap, useUnitsyncMinimap } from "../../config";
import { analysisRunHidden, openAnalysisRun } from "../../replayAnalysis";
import { useReplayTrack } from "../../replayTrack";
import { useStoredTracks, useStoredTracksRead } from "../../replayTracks";
import { EnsureMatchClock } from "../../useMatchClock";
import { ReplayMap3D } from "./ReplayMap3D";
import { ReplayMapHeat } from "./ReplayMapHeat";
import { HelpHost } from "./ReplayMapRail";
import {
  faultWords,
  NotShown,
  ReplayMapUnits,
  staleWords,
  useAdoptedTrack,
} from "./ReplayMapUnits";

type Mode = "units" | "heat" | "3d";

/**
 * The replay page's one map (#5310): a card with a mode switch in place of the
 * two map sections the page had.
 *
 * Units shows the recorded match at the page's match clock. Heat is the flat
 * map with its layers. 3D is the terrain, with the layers that paint on it.
 * Each mode is its own file and lays itself out with the shared rail in
 * `ReplayMapRail`, so the switches and legends sit beside the map in all three.
 *
 * Units needs a recording. Without a current one the mode is disabled and the
 * card has an Analyse replay button, which is the analysis and recording
 * section's own button, so a distribution profile that hides that one hides
 * this one. The card opens on Units when there is a recording and on Heat when
 * there is not. The chosen mode is not in the address: the address holds the
 * time, and a link must not open on a mode its reader cannot use.
 *
 * The card reads the recorded track in every mode and gives its range to the
 * match clock, so the timeline dock has the track's range whichever mode is
 * open.
 */
export function ReplayMapCard(props: {
  info: DemoInfo;
  replayPath: string | undefined;
  /** For the map's pictures. Without them there is no picture. */
  enginePath: string | undefined;
  dataDir: string | undefined;
  /** What the Analyse replay button does. Without it, the button presses the
   *  analysis section's own, which is right when that is on the page already. */
  onAnalyse?: () => void;
}) {
  return (
    <EnsureMatchClock durationSec={props.info.durationSec}>
      <MapCard {...props} />
    </EnsureMatchClock>
  );
}

function MapCard({
  info,
  replayPath,
  enginePath,
  dataDir,
  onAnalyse = openAnalysisRun,
}: {
  info: DemoInfo;
  replayPath: string | undefined;
  enginePath: string | undefined;
  dataDir: string | undefined;
  onAnalyse?: () => void;
}) {
  const { t } = useLingui();
  const infoMapName = info.mapName;
  const tracks = useStoredTracks();
  const tracksRead = useStoredTracksRead();
  // A remix carries its original's game id and has no track of its own.
  const gameId = info.remixed ? undefined : info.gameId;
  const stored = gameId ? tracks.get(gameId) : undefined;
  const hasRecording = stored?.state === "current";
  // A stale track is never opened: it has no footprints to size a mark from.
  const track = useReplayTrack(hasRecording && gameId ? gameId : null);
  const header = track.status === "ready" ? track.handle.header : null;
  const adopted = useAdoptedTrack(header);

  const minimap = useUnitsyncMinimap(enginePath, dataDir, info.mapName);
  const heightmap = useUnitsyncHeightmap(enginePath, dataDir, info.mapName);
  const busy = minimap.loading || heightmap.loading;
  const preview =
    heightmap.data && heightmap.url && minimap.url
      ? {
          heightSrc: heightmap.url,
          heightRange: heightmap.range,
          textureSrc: minimap.url,
          appearance: minimap.appearance,
          minHeight: heightmap.data.minHeight ?? 0,
          maxHeight: heightmap.data.maxHeight ?? 0,
        }
      : null;

  // Where the heading has room for the help entry of the mode that is open.
  const [helpHost, setHelpHost] = useState<HTMLElement | null>(null);

  // What the card opens on is settled once the tracks have been read, and
  // stays as it was when a recording turns up later: a run that finishes does
  // not move somebody off the mode they are reading.
  const [opened, setOpened] = useState<Mode | null>(null);
  if (opened === null && tracksRead) setOpened(hasRecording ? "units" : "heat");
  const [picked, setPicked] = useState<Mode | null>(null);
  const wanted = picked ?? opened;
  const mode: Mode | null =
    wanted === "units" && !hasRecording
      ? "heat"
      : wanted === "3d" && !preview && !busy
        ? "heat"
        : wanted;

  const unitsReason = hasRecording
    ? null
    : stored
      ? staleWords()
      : t`Needs a recording of the match.`;
  const sceneReason =
    preview || busy ? null : t`Needs the map's picture and height data.`;

  return (
    <HelpHost.Provider value={helpHost}>
      <section className="flex flex-col gap-2" aria-label={t`Map`}>
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="flex items-center gap-1">
              <h2 className="text-sm font-medium">
                <Trans>Map · {infoMapName}</Trans>
              </h2>
              <span ref={setHelpHost} className="contents" />
            </div>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              spacing={1}
              aria-label={t`Map view`}
              value={mode ?? ""}
              onValueChange={(next) => {
                if (next) setPicked(next as Mode);
              }}
            >
              <ModeItem value="units" reason={unitsReason}>
                <Trans>Units</Trans>
              </ModeItem>
              <ModeItem value="heat" reason={null}>
                <Trans>Heat</Trans>
              </ModeItem>
              <ModeItem value="3d" reason={sceneReason}>
                <Trans>3D</Trans>
              </ModeItem>
            </ToggleGroup>
            {!stored && replayPath && !analysisRunHidden() && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={onAnalyse}
              >
                <ScanSearch className="size-4" />
                <Trans>Analyse replay</Trans>
              </Button>
            )}
          </div>
          {stored?.state === "stale" && <NotShown words={staleWords()} />}
        </>
        <div className="rounded-lg border border-border/50 bg-card p-3 text-sm">
          {mode === null ? (
            <Reading />
          ) : mode === "units" ? (
            track.status === "error" ? (
              <NotShown words={faultWords(track.error)} />
            ) : track.status === "ready" ? (
              track.handle.header.mapSize[0] > 0 &&
              track.handle.header.mapSize[1] > 0 ? (
                <ReplayMapUnits
                  handle={track.handle}
                  info={info}
                  replayPath={replayPath}
                  adopted={adopted}
                  mapName={info.mapName}
                  minimapUrl={minimap.url}
                />
              ) : (
                <NotShown
                  words={t`The recorded track does not say how large the map is, so it is not shown.`}
                />
              )
            ) : (
              <Reading />
            )
          ) : mode === "heat" ? (
            minimap.url ? (
              <ReplayMapHeat
                info={info}
                replayPath={replayPath}
                mapName={info.mapName}
                minimapUrl={minimap.url}
                heightmap={heightmap.data}
              />
            ) : busy ? (
              <div className="flex h-48 items-center justify-center">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <NoPicture
                info={info}
                installed={enginePath !== undefined}
                mapName={info.mapName}
              />
            )
          ) : preview ? (
            <ReplayMap3D
              info={info}
              replayPath={replayPath}
              mapName={info.mapName}
              enginePath={enginePath}
              dataDir={dataDir}
              heightmap={heightmap.data}
              preview={preview}
              track={adopted && track.status === "ready" ? track.handle : null}
            />
          ) : (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
      </section>
    </HelpHost.Provider>
  );
}

/** One switch of the mode group. When the mode cannot be used the reason is its
 *  tooltip, on a wrapper because a disabled button takes no pointer. */
function ModeItem({
  value,
  reason,
  children,
}: {
  value: Mode;
  reason: string | null;
  children: ReactNode;
}) {
  if (!reason)
    return <ToggleGroupItem value={value}>{children}</ToggleGroupItem>;
  return (
    <span title={reason}>
      <ToggleGroupItem value={value} disabled>
        {children}
      </ToggleGroupItem>
    </span>
  );
}

function Reading() {
  return (
    <p
      role="status"
      className="flex items-center gap-1.5 text-muted-foreground"
    >
      <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
      <Trans>Reading the recorded track.</Trans>
    </p>
  );
}

/** Why the flat map has no picture: no engine, no map, or a map that is not
 *  installed. The download control for that is in the notice near the top of
 *  the page (#495). */
function NoPicture({
  info,
  installed,
  mapName,
}: {
  info: DemoInfo;
  installed: boolean;
  mapName: string;
}) {
  const { t } = useLingui();
  if (!info.mapName || !installed) {
    return (
      <p className="text-sm text-muted-foreground">
        {info.mapName
          ? t`Install an engine to preview this map.`
          : t`No map recorded for this replay.`}
      </p>
    );
  }
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center">
      <ImageOff className="size-6 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">
        <Trans>
          <span className="font-medium text-foreground">{mapName}</span> isn't
          installed, so its preview can't be rendered.
        </Trans>
      </p>
    </div>
  );
}
