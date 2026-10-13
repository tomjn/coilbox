import { Button } from "@picoframe/frame";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Slider } from "@/components/ui/slider";
import { formatDuration } from "@/lib/format";
import type { DemoInfo, ReplayTrackHeader } from "../../bindings";
import { useUnitsyncMinimap } from "../../config";
import { createReplayClock, type ReplayClock } from "../../replayMapView/clock";
import {
  createMapView,
  type MapView,
  type MapViewStatus,
} from "../../replayMapView/loop";
import { teamStyles } from "../../replayMapView/paint";
import { teamLabel } from "../../replaySideLabel";
import type { ReplayTrackError, ReplayTrackHandle } from "../../replayTrack";
import { useReplayTrack } from "../../replayTrack";
import { useStoredTracks } from "../../replayTracks";
import { plural } from "./ReplayAnalysisSection";
import { RECORDING_SECTION_ID } from "./ReplayRecordingSection";
import { SectionHelp } from "./SectionHelp";

/** Said under the recording section, which has already said the track is out
 *  of date. This says what that means here. */
const STALE_WORDS =
  "The track has to be recorded again before the match can be shown here.";

const capital = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

/** A unit the pointer is on, or that a click chose. */
interface Named {
  serial: number;
  def: number;
  team: number;
}

/**
 * The replay page's map view of a recorded track (#3807): every unit,
 * projectile and wreck where it was at one moment of the match, drawn from the
 * track with no engine and none of the game's Lua.
 *
 * It is shown when the replay has a track. A current track is drawn. A stale
 * one, or one that cannot be read, says so and leads to the recording section
 * above it, which has the button that records the replay again.
 *
 * The time comes from a {@link ReplayClock} this section owns. For now a plain
 * slider sets it. The timeline of #3808 replaces the slider and drives the same
 * clock, so nothing in the view changes when it does.
 */
export function ReplayMapViewSection({
  info,
  enginePath,
  dataDir,
}: {
  info: DemoInfo;
  /** For the map's picture. Without them the units are on plain ground. */
  enginePath: string | undefined;
  dataDir: string | undefined;
}) {
  const tracks = useStoredTracks();
  // A remix carries its original's game id and has no track of its own.
  const gameId = info.remixed ? undefined : info.gameId;
  const stored = gameId ? tracks.get(gameId) : undefined;
  // A stale track is never opened: it has no footprints to size a mark from.
  const track = useReplayTrack(
    stored?.state === "current" && gameId ? gameId : null,
  );
  const minimap = useUnitsyncMinimap(enginePath, dataDir, info.mapName);

  if (!stored) return null;

  return (
    <section className="flex flex-col gap-2" aria-label="Recorded match">
      <div className="flex items-center gap-1">
        <h2 className="text-sm font-medium">Recorded match</h2>
        {track.status === "ready" && (
          <SectionHelp section="the recorded match">
            <Legend header={track.handle.header} />
          </SectionHelp>
        )}
      </div>
      <div className="flex flex-col gap-3 rounded-lg border border-border/50 bg-card p-3 text-sm">
        {stored.state === "stale" ? (
          <NotShown words={STALE_WORDS} />
        ) : track.status === "error" ? (
          <NotShown words={faultWords(track.error)} />
        ) : track.status === "ready" ? (
          track.handle.header.mapSize[0] > 0 &&
          track.handle.header.mapSize[1] > 0 ? (
            <RecordedMatch
              handle={track.handle}
              mapName={info.mapName}
              minimapUrl={minimap.url}
            />
          ) : (
            <NotShown words="The recorded track does not say how large the map is, so it is not shown." />
          )
        ) : (
          <p
            role="status"
            className="flex items-center gap-1.5 text-muted-foreground"
          >
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
            Reading the recorded track.
          </p>
        )}
      </div>
    </section>
  );
}

function faultWords(error: ReplayTrackError): string {
  const { fault } = error;
  switch (fault.kind) {
    case "stale":
      return STALE_WORDS;
    case "missing":
      return "The recorded track is no longer on this computer.";
    case "otherGame":
      return "The track stored for this replay belongs to another match, so it is not shown.";
    case "unknownFormat":
      return `The recorded track is not shown: its ${fault.field} is ${fault.found} and this version of coilbox reads ${fault.expected}.`;
    case "noSuchWindow":
      return `The recorded track could not be read. It has no window ${fault.window}.`;
    case "unreadable":
    case "corruptWindow":
    case "io":
      return `The recorded track could not be read. ${capital(fault.message)}.`;
  }
}

/**
 * Why there is no picture, and the way to the section that can make one. The
 * button that records is in that section and is not repeated here.
 */
function NotShown({ words }: { words: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p>{words}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          const section = document.getElementById(RECORDING_SECTION_ID);
          section?.scrollIntoView({ block: "nearest" });
          section?.querySelector("button")?.focus();
        }}
      >
        Go to recording
      </Button>
    </div>
  );
}

/** What the marks are, and whose colour is whose. Behind the help button. */
function Legend({ header }: { header: ReplayTrackHeader }) {
  return (
    <>
      <p className="text-muted-foreground">
        From playing the match back with coilbox's own recorder. Nothing here
        runs the game.
      </p>
      <p>
        A rectangle is a unit, in its team's colour and the size of its
        footprint, with a line the way it faces. A unit still being built is
        faint. On a large map a mark is never smaller than 3 pixels, so small
        units look bigger than they are.
      </p>
      <p>
        A pale line is a projectile, drawn along the way it is moving. A grey
        square is a wreck, or anything else left on the map during the match.
      </p>
      <p>
        Point at a unit to name it. Click one to keep it named, and click the
        ground to let it go.
      </p>
      <ul className="flex flex-col gap-1">
        {header.teams.map((team) => (
          <li key={team.id} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-[2px] border border-foreground/40"
              style={{ backgroundColor: `rgb(${team.colour.join(", ")})` }}
            />
            {ownerWords(header, team.id)}
          </li>
        ))}
      </ul>
    </>
  );
}

/** Whose a team is, in words, so two teams are told apart without colour. */
function ownerWords(header: ReplayTrackHeader, teamId: number): string {
  const team = header.teams.find((t) => t.id === teamId);
  if (!team) return "no team";
  const owner = team.leader || `player ${team.id + 1}`;
  return `${owner}${team.isAi ? " (AI)" : ""}, ${teamLabel(team.allyTeam)}`;
}

/** The map, the canvas over it, and the control that sets the time. */
function RecordedMatch({
  handle,
  mapName,
  minimapUrl,
}: {
  handle: ReplayTrackHandle;
  mapName: string;
  minimapUrl: string | null;
}) {
  const { header } = handle;
  const clock = useMemo(
    () => createReplayClock(header.firstFrame),
    [header.firstFrame],
  );
  return (
    <>
      <RecordedMatchCanvas
        handle={handle}
        clock={clock}
        mapName={mapName}
        minimapUrl={minimapUrl}
      />
      <TemporaryTimeSlider header={header} clock={clock} />
      {!minimapUrl && (
        <p className="text-xs text-muted-foreground">
          A picture of this map is not available, so the match is drawn on plain
          ground.
        </p>
      )}
    </>
  );
}

/**
 * The canvas and what is said about it.
 *
 * Nothing here renders as time moves. The drawing loop draws on the canvas and
 * writes the counts into their line directly. React renders when the status
 * changes between ready, loading and unreadable, and when the unit that is
 * named changes, and at no other time.
 */
function RecordedMatchCanvas({
  handle,
  clock,
  mapName,
  minimapUrl,
}: {
  handle: ReplayTrackHandle;
  clock: ReplayClock;
  mapName: string;
  minimapUrl: string | null;
}) {
  const { header } = handle;
  const [mapX, mapZ] = header.mapSize;
  const groundRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const countsRef = useRef<HTMLParagraphElement | null>(null);
  const viewRef = useRef<MapView | null>(null);
  const [status, setStatus] = useState<MapViewStatus>({ kind: "ready" });
  const [pointed, setPointed] = useState<Named | null>(null);
  const [chosen, setChosen] = useState<Named | null>(null);

  useEffect(() => {
    const ground = groundRef.current;
    const canvas = canvasRef.current;
    if (!ground || !canvas) return;
    const ctx = canvas.getContext("2d");
    let pixelRatio = 1;

    const view = createMapView({
      handle,
      clock,
      teams: teamStyles(header.teams),
      surface: () =>
        ctx && canvas.width > 0
          ? {
              ctx,
              view: {
                width: canvas.width,
                height: canvas.height,
                scale: canvas.width / mapX,
                pixelRatio,
              },
            }
          : null,
      env: {
        requestFrame: (callback) => requestAnimationFrame(callback),
        cancelFrame: (id) => cancelAnimationFrame(id),
      },
      onStatus: setStatus,
      onPainted: (_frame, counts) => {
        if (!countsRef.current) return;
        countsRef.current.textContent = [
          plural(counts.units, "unit", "units"),
          plural(counts.projectiles, "projectile", "projectiles"),
          plural(counts.wrecks, "wreck", "wrecks"),
        ].join(", ");
      },
      onHighlightLost: () => {
        setPointed(null);
        setChosen(null);
      },
    });
    viewRef.current = view;
    if (import.meta.env.DEV) {
      // For measuring a draw from the Tauri MCP in a development build.
      (canvas as unknown as Record<string, unknown>).__replayMapView = {
        view,
        clock,
        handle,
      };
    }

    // The canvas has the screen's own pixels, so a mark's edge is sharp.
    const resize = () => {
      const width = ground.getBoundingClientRect().width;
      pixelRatio = window.devicePixelRatio || 1;
      const w = Math.round(width * pixelRatio);
      const h = Math.round((w * mapZ) / mapX);
      if (canvas.width === w && canvas.height === h) return;
      canvas.width = w;
      canvas.height = h;
      view.invalidate();
    };
    resize();
    const resized =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    resized?.observe(ground);

    // It draws only while somebody can see it: the document is not hidden and
    // the canvas is not scrolled out of view.
    let onScreen = true;
    const seen = () => view.setShown(!document.hidden && onScreen);
    const watcher =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver((entries) => {
            const last = entries[entries.length - 1];
            if (!last) return;
            onScreen = last.isIntersecting;
            seen();
          });
    watcher?.observe(ground);
    document.addEventListener("visibilitychange", seen);
    seen();

    return () => {
      document.removeEventListener("visibilitychange", seen);
      watcher?.disconnect();
      resized?.disconnect();
      view.dispose();
      viewRef.current = null;
    };
  }, [handle, clock, header.teams, mapX, mapZ]);

  // The ring goes round the unit the pointer is on, or the chosen one.
  const named = pointed ?? chosen;
  useEffect(() => {
    viewRef.current?.setHighlight(named?.serial ?? null);
  }, [named?.serial]);

  const unitAt = (event: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current;
    if (!canvas || !viewRef.current) return null;
    const box = canvas.getBoundingClientRect();
    if (box.width === 0) return null;
    const toCanvas = canvas.width / box.width;
    return viewRef.current.pick(
      (event.clientX - box.left) * toCanvas,
      (event.clientY - box.top) * toCanvas,
    );
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div
        ref={groundRef}
        data-map-ground
        // As wide as the card lets it be, and never taller than most of the
        // window, so a tall map still fits with its controls.
        style={{
          aspectRatio: `${mapX} / ${mapZ}`,
          width: `min(100%, 44rem, 70vh * ${mapX} / ${mapZ})`,
        }}
        className="relative overflow-hidden rounded-md border border-border/50 bg-[#0d1117]"
      >
        {minimapUrl && (
          // Dimmed, so a team colour stands out from ground of the same hue.
          <img
            src={minimapUrl}
            alt={`Minimap of ${mapName}`}
            className="absolute inset-0 size-full object-fill opacity-55 saturate-50"
          />
        )}
        <canvas
          ref={canvasRef}
          data-layer="recorded-units"
          role="img"
          aria-label={`Units on ${mapName} at the chosen time`}
          className="absolute inset-0 size-full"
          onPointerMove={(event) => {
            const found = unitAt(event);
            setPointed((was) =>
              was?.serial === found?.serial ? was : (found ?? null),
            );
          }}
          onPointerLeave={() => setPointed(null)}
          onClick={(event) => setChosen(unitAt(event))}
        />
        {status.kind === "loading" && (
          <span
            role="status"
            aria-label="Loading this part of the match"
            className="pointer-events-none absolute right-1.5 top-1.5 rounded bg-black/70 p-1 text-white"
          >
            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
          </span>
        )}
        {status.kind === "fault" && (
          <div
            role="alert"
            className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-black/80 px-2 py-1.5 text-xs text-white"
          >
            <span>This part of the match cannot be read from the track.</span>
            <span className="text-white/70">
              {capital(status.error.message)}.
            </span>
          </div>
        )}
      </div>
      <div className="flex min-h-4 flex-wrap items-baseline justify-between gap-x-4 text-xs">
        <p ref={countsRef} className="text-muted-foreground tabular-nums" />
        <p data-testid="recorded-unit-name" className="font-medium">
          {named
            ? `${header.unitDefs[named.def] ?? "unknown unit"}, ${ownerWords(header, named.team)}`
            : ""}
        </p>
      </div>
    </div>
  );
}

/**
 * Sets the time, until the timeline of #3808 replaces it. It does nothing but
 * move the clock: no play, no reverse, no keys of its own beyond the slider's.
 *
 * Its own state is the knob's place, so dragging renders this and not the map.
 */
function TemporaryTimeSlider({
  header,
  clock,
}: {
  header: ReplayTrackHeader;
  clock: ReplayClock;
}) {
  const [frame, setFrame] = useState(clock.frame);
  const seconds = (frame - header.firstFrame) / header.framesPerSecond;
  return (
    <div className="flex items-center gap-3">
      <Slider
        aria-label="Time in the match"
        className="max-w-[44rem]"
        min={header.firstFrame}
        max={header.lastFrame}
        step={1}
        value={[frame]}
        onValueChange={([next]) => {
          // Dragging back is time going backward, which the track follows by
          // holding the window before this one.
          clock.set(next, next < clock.frame ? -1 : 1);
          setFrame(next);
        }}
      />
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {formatDuration(seconds)}
      </span>
    </div>
  );
}
