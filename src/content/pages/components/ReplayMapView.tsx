import { plural, t } from "@lingui/core/macro";
import { useLingui as useLocale } from "@lingui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import type { DemoInfo, ReplayTrackHeader } from "../../bindings";
import { useUnitsyncMinimap } from "../../config";
import {
  ANALYSIS_ACTION_ATTRIBUTE,
  ANALYSIS_SECTION_ID,
} from "../../replayAnalysis";
import type { ReplayWatch } from "../../replayEngine";
import { createReplayClock, type ReplayClock } from "../../replayMapView/clock";
import {
  createMapView,
  type MapView,
  type MapViewStatus,
} from "../../replayMapView/loop";
import { teamStyles } from "../../replayMapView/paint";
import { createPlayback, type Playback } from "../../replayMapView/playback";
import { TIMELINE_KEYS } from "../../replayMapView/timelineKeys";
import {
  type MarkGroup,
  toFrameParam,
  urlFrame,
} from "../../replayMapView/timelineMarks";
import { teamLabel } from "../../replaySideLabel";
import type { ReplayTrackError, ReplayTrackHandle } from "../../replayTrack";
import { useReplayTrack } from "../../replayTrack";
import { useStoredTracks } from "../../replayTracks";
import { useReplayTimelineMarks } from "../../useReplayTimelineMarks";
import { OpenInEngineButton } from "./OpenInEngineButton";
import {
  performAction,
  ReplayPlaybackBar,
  timelineKeyHandler,
} from "./ReplayPlaybackBar";
import { SectionHelp } from "./SectionHelp";

/** Said under the analysis and recording section, which has already said the
 *  track is out of date. This says what that means here. */
const staleWords = () =>
  t`The track has to be recorded again before the match can be shown here.`;

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
 * one, or one that cannot be read, says so and leads to the analysis and
 * recording section above it, which has the button that records the replay
 * again.
 *
 * The time comes from a {@link ReplayClock} this section owns. The timeline
 * under the map (#3808) sets it, and the view draws whatever the clock says.
 */
export function ReplayMapViewSection({
  info,
  enginePath,
  dataDir,
  replayPath,
  watch,
  dependencyBlock,
  game,
}: {
  info: DemoInfo;
  /** The replay file, whose chat and leavers are marks on the timeline. */
  replayPath: string;
  /** For the map's picture. Without them the units are on plain ground. */
  enginePath: string | undefined;
  dataDir: string | undefined;
  /** The page's engine decision, for the button that opens the engine. */
  watch: ReplayWatch;
  /** `replayDependencyBlock`: why the replay's game cannot run, or null. */
  dependencyBlock: string | null;
  /** Another installed version of the replay's game, when its own is missing. */
  game?: string;
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
  const { t: tr } = useLingui();

  if (!stored) return null;

  return (
    <section className="flex flex-col gap-2" aria-label={tr`Recorded match`}>
      <div className="flex items-center gap-1">
        <h2 className="text-sm font-medium">
          <Trans>Recorded match</Trans>
        </h2>
        {track.status === "ready" && (
          <SectionHelp section={tr`the recorded match`}>
            <Legend header={track.handle.header} />
          </SectionHelp>
        )}
      </div>
      <div className="flex flex-col gap-3 rounded-lg border border-border/50 bg-card p-3 text-sm">
        {stored.state === "stale" ? (
          <NotShown words={staleWords()} />
        ) : track.status === "error" ? (
          <NotShown words={faultWords(track.error)} />
        ) : track.status === "ready" ? (
          track.handle.header.mapSize[0] > 0 &&
          track.handle.header.mapSize[1] > 0 ? (
            <RecordedMatch
              info={info}
              replayPath={replayPath}
              watch={watch}
              dependencyBlock={dependencyBlock}
              game={game}
              handle={track.handle}
              mapName={info.mapName}
              minimapUrl={minimap.url}
            />
          ) : (
            <NotShown
              words={tr`The recorded track does not say how large the map is, so it is not shown.`}
            />
          )
        ) : (
          <p
            role="status"
            className="flex items-center gap-1.5 text-muted-foreground"
          >
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
            <Trans>Reading the recorded track.</Trans>
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
      return staleWords();
    case "missing":
      return t`The recorded track is no longer on this computer.`;
    case "otherGame":
      return t`The track stored for this replay belongs to another match, so it is not shown.`;
    case "unknownFormat": {
      const { field, found, expected } = fault;
      return t`The recorded track is not shown: its ${field} is ${found} and this version of coilbox reads ${expected}.`;
    }
    case "noSuchWindow": {
      const windowIndex = fault.window;
      return t`The recorded track could not be read. It has no window ${windowIndex}.`;
    }
    case "unreadable":
    case "corruptWindow":
    case "io": {
      const reason = capital(fault.message);
      return t`The recorded track could not be read. ${reason}.`;
    }
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
          const section = document.getElementById(ANALYSIS_SECTION_ID);
          section?.scrollIntoView({ block: "nearest" });
          section
            ?.querySelector<HTMLElement>(`[${ANALYSIS_ACTION_ATTRIBUTE}]`)
            ?.focus();
        }}
      >
        <Trans>Go to recording</Trans>
      </Button>
    </div>
  );
}

/** What the marks are, and whose colour is whose. Behind the help button. */
function Legend({ header }: { header: ReplayTrackHeader }) {
  useLocale();
  return (
    <>
      <p className="text-muted-foreground">
        <Trans>
          From playing the match back with coilbox's own recorder. Nothing here
          runs the game.
        </Trans>
      </p>
      <p>
        <Trans>
          A rectangle is a unit, in its team's colour and the size of its
          footprint, with a line the way it faces. A unit still being built is
          faint. On a large map a mark is never smaller than 3 pixels, so small
          units look bigger than they are.
        </Trans>
      </p>
      <p>
        <Trans>
          A pale line is a projectile, drawn along the way it is moving. A grey
          square is a wreck, or anything else left on the map during the match.
        </Trans>
      </p>
      <p>
        <Trans>
          Point at a unit to name it. Click one to keep it named, and click the
          ground to let it go.
        </Trans>
      </p>
      <p>
        <Trans>
          Under the map, the knob sets the time and the buttons play the match
          forward or in reverse, at the speed beside them. A tall bar is a unit
          destroyed, a dot is chat and a diamond is a player leaving, taken from
          the replay and its analysis. Marks that would touch are drawn as one,
          larger, and clicking it goes to the earliest event in it. A replay
          that has not been analysed has no kills. The address holds the time,
          so a link opens at that moment.
        </Trans>
      </p>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5">
        {TIMELINE_KEYS.map((row) => (
          <div key={row.show} className="contents">
            <dt className="font-medium">{row.show}</dt>
            <dd>{row.does}</dd>
          </div>
        ))}
      </dl>
      <p className="text-muted-foreground">
        <Trans>The keys work while focus is in the map or the timeline.</Trans>
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
  const team = header.teams.find((candidate) => candidate.id === teamId);
  if (!team) return t`no team`;
  const slot = team.id + 1;
  const owner = team.leader || t`player ${slot}`;
  const side = teamLabel(team.allyTeam);
  return team.isAi ? t`${owner} (AI), ${side}` : t`${owner}, ${side}`;
}

/** The address's name for the time, in frames of the track. */
const TIME_PARAM = "frame";

/**
 * The map, the canvas over it, and the timeline that sets the time.
 *
 * The time is kept in the page's address as `?frame=`. A link opens at that
 * frame, held inside the match. The address is replaced, never added to, and
 * only when playing stops or a seek ends.
 *
 * Keys act while focus is anywhere in here and nowhere else. A text field, and
 * a control that keeps a key for itself, keep it.
 */
function RecordedMatch({
  info,
  replayPath,
  watch,
  dependencyBlock,
  game,
  handle,
  mapName,
  minimapUrl,
}: {
  info: DemoInfo;
  replayPath: string;
  watch: ReplayWatch;
  dependencyBlock: string | null;
  game?: string;
  handle: ReplayTrackHandle;
  mapName: string;
  minimapUrl: string | null;
}) {
  const { t: tr } = useLingui();
  const { header } = handle;
  const [params, setParams] = useSearchParams();
  // Read once, when the match is opened. The address follows the time after.
  const [opened] = useState(() =>
    urlFrame(params.get(TIME_PARAM), {
      first: header.firstFrame,
      last: header.lastFrame,
    }),
  );
  const clock = useMemo(
    () => createReplayClock(opened ?? header.firstFrame),
    [header.firstFrame, opened],
  );

  const setParamsRef = useRef(setParams);
  setParamsRef.current = setParams;
  const [playback, setPlayback] = useState<Playback | null>(null);
  useEffect(() => {
    const made = createPlayback({
      clock,
      header,
      env: {
        requestFrame: (callback) => requestAnimationFrame(callback),
        cancelFrame: (id) => cancelAnimationFrame(id),
      },
      onSettled: (frame) =>
        setParamsRef.current(
          (was) => {
            const next = new URLSearchParams(was);
            next.set(TIME_PARAM, toFrameParam(frame));
            return next;
          },
          { replace: true },
        ),
    });
    setPlayback(made);
    return () => {
      made.dispose();
      setPlayback(null);
    };
  }, [clock, header]);

  const marks = useReplayTimelineMarks(info, replayPath);
  const groupsRef = useRef<readonly MarkGroup[]>([]);
  const [status, setStatus] = useState<MapViewStatus>({ kind: "ready" });

  const onKeyDown = useMemo(
    () =>
      playback
        ? timelineKeyHandler((action) =>
            performAction(action, {
              playback,
              clock,
              header,
              groups: groupsRef.current,
            }),
          )
        : undefined,
    [playback, clock, header],
  );

  return (
    // biome-ignore lint/a11y/useSemanticElements: a box that holds the map and the bar, which a fieldset would restyle.
    <div
      role="group"
      aria-label={tr`Recorded match`}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the one place keyboard focus lands to use the timeline's keys on the map and the bar together.
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="flex flex-col gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <RecordedMatchCanvas
        handle={handle}
        clock={clock}
        mapName={mapName}
        minimapUrl={minimapUrl}
        onStatus={setStatus}
      />
      {playback && onKeyDown && (
        <div
          style={{
            width: `min(100%, 44rem, 70vh * ${header.mapSize[0]} / ${header.mapSize[1]})`,
          }}
        >
          <ReplayPlaybackBar
            header={header}
            clock={clock}
            playback={playback}
            marks={marks}
            groupsRef={groupsRef}
            loading={status.kind === "loading"}
            onKeyDown={onKeyDown}
          />
          <div className="mt-2 flex justify-end">
            <OpenInEngineButton
              replayPath={replayPath}
              engineVersion={info.engineVersion}
              watch={watch}
              dependencyBlock={dependencyBlock}
              game={game}
              clock={clock}
            />
          </div>
        </div>
      )}
      {!minimapUrl && (
        <p className="text-xs text-muted-foreground">
          <Trans>
            A picture of this map is not available, so the match is drawn on
            plain ground.
          </Trans>
        </p>
      )}
    </div>
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
  onStatus,
}: {
  handle: ReplayTrackHandle;
  clock: ReplayClock;
  mapName: string;
  minimapUrl: string | null;
  /** Tells the timeline when the picture is waiting for a window. */
  onStatus: (status: MapViewStatus) => void;
}) {
  const { t: tr } = useLingui();
  const { header } = handle;
  const [mapX, mapZ] = header.mapSize;
  const groundRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const countsRef = useRef<HTMLParagraphElement | null>(null);
  const viewRef = useRef<MapView | null>(null);
  const [status, setStatus] = useState<MapViewStatus>({ kind: "ready" });
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
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
      onStatus: (next) => {
        setStatus(next);
        onStatusRef.current(next);
      },
      onPainted: (_frame, counts) => {
        if (!countsRef.current) return;
        countsRef.current.textContent = [
          plural(counts.units, { one: "# unit", other: "# units" }),
          plural(counts.projectiles, {
            one: "# projectile",
            other: "# projectiles",
          }),
          plural(counts.wrecks, { one: "# wreck", other: "# wrecks" }),
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
  const unitName = named
    ? (header.unitDefs[named.def] ?? tr`unknown unit`)
    : "";
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
    <div
      // As wide as the card lets it be, and never taller than most of the
      // window, so a tall map still fits with its controls. What is said about
      // the picture is held to the picture's width.
      style={{ width: `min(100%, 44rem, 70vh * ${mapX} / ${mapZ})` }}
      className="flex flex-col gap-1.5"
    >
      <div
        ref={groundRef}
        data-map-ground
        style={{ aspectRatio: `${mapX} / ${mapZ}` }}
        className="relative w-full overflow-hidden rounded-md border border-border/50 bg-[#0d1117]"
      >
        {minimapUrl && (
          // Dimmed, so a team colour stands out from ground of the same hue.
          <img
            src={minimapUrl}
            alt={tr`Minimap of ${mapName}`}
            className="absolute inset-0 size-full object-fill opacity-55 saturate-50"
          />
        )}
        <canvas
          ref={canvasRef}
          data-layer="recorded-units"
          role="img"
          aria-label={tr`Units on ${mapName} at the chosen time`}
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
            aria-label={tr`Loading this part of the match`}
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
            <span>
              <Trans>
                This part of the match cannot be read from the track.
              </Trans>
            </span>
            <span className="text-white/70">
              {capital(status.error.message)}.
            </span>
          </div>
        )}
      </div>
      <div className="flex min-h-4 flex-wrap items-baseline justify-between gap-x-4 text-xs">
        <p ref={countsRef} className="text-muted-foreground tabular-nums" />
        <p data-testid="recorded-unit-name" className="font-medium">
          {named ? `${unitName}, ${ownerWords(header, named.team)}` : ""}
        </p>
      </div>
    </div>
  );
}
