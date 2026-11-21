import { plural, t } from "@lingui/core/macro";
import { useLingui as useLocale } from "@lingui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { Loader2 } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { DemoInfo, ReplayTrackHeader } from "../../bindings";
import { playerTeam } from "../../matchStats";
import {
  ANALYSIS_ACTION_ATTRIBUTE,
  ANALYSIS_SECTION_ID,
} from "../../replayAnalysis";
import { startDots } from "../../replayMapLayers";
import type { MapLayer } from "../../replayMapLayerToggles";
import type { ReplayClock } from "../../replayMapView/clock";
import { LEAST_ICON_EDGE } from "../../replayMapView/icons";
import {
  createMapView,
  type MapView,
  type MapViewStatus,
} from "../../replayMapView/loop";
import type { TeamStyle } from "../../replayMapView/paint";
import { TIMELINE_KEYS } from "../../replayMapView/timelineKeys";
import { teamLabel } from "../../replaySideLabel";
import type { ReplayTrackError, ReplayTrackHandle } from "../../replayTrack";
import { type UnitDrawing, useUnitDrawing } from "../../unitMapDrawing";
import { useUnitMapExplosions } from "../../unitMapExplosions";
import { useMatchClock } from "../../useMatchClock";
import { usePrimaryPlayer } from "../../usePrimaryPlayer";
import { useMapLayerToggles } from "../../useReplayMapLayers";
import { useReplayStartAreas } from "../../useReplayStartAreas";
import { useUnitMapIcons } from "../../useUnitMapIcons";
import { useUnitMapStyles } from "../../useUnitMapStyles";
import { LayerSwitches, MapHelp, ReplayMapLayout } from "./ReplayMapRail";
import { StartAreas, StartDotMarks } from "./ReplayStartAreas";
import { useTimelineKeys } from "./ReplayTimelineDock";

/** Said under the analysis and recording section, which has already said the
 *  track is out of date. This says what that means here. */
export const staleWords = () =>
  t`The track has to be recorded again before the match can be shown here.`;

const capital = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

/** A unit the pointer is on, or that a click chose. */
interface Named {
  serial: number;
  def: number;
  team: number;
}

export function faultWords(error: ReplayTrackError): string {
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
export function NotShown({ words }: { words: string }) {
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

/** The layers of the map card's rail that the unit map draws. The same two
 *  switches steer the flat map, so one choice holds in both modes. */
const UNIT_MAP_LAYERS: readonly MapLayer[] = ["startBoxes", "starts"];

/** What the marks are and how the timeline moves them. Behind the help button. */
function Legend({
  boxes,
  dots,
  drawing,
}: {
  boxes: boolean;
  dots: boolean;
  drawing: UnitDrawing;
}) {
  useLocale();
  const leastIcon = LEAST_ICON_EDGE;
  return (
    <>
      <p className="text-muted-foreground">
        <Trans>
          From playing the match back with coilbox's own recorder. Nothing here
          runs the game.
        </Trans>
      </p>
      {drawing === "icons" ? (
        <>
          <p>
            <Trans>
              An icon is a unit, drawn as the game draws it on its own map, in
              the colour of its player's line in the chart. A unit still being
              built is faint. An icon is never smaller than {leastIcon} pixels,
              so small units look bigger than they are. A unit whose icon is not
              known is a rectangle, as is every unit while the icons load.
            </Trans>
          </p>
          <p>
            <Trans>
              Footprints, in the switch beside the map, draws each unit as a
              rectangle the size of its footprint instead.
            </Trans>
          </p>
        </>
      ) : (
        <p>
          <Trans>
            A rectangle is a unit, in the colour of its player's line in the
            chart and the size of its footprint, with a line the way it faces. A
            unit still being built is faint. On a large map a mark is never
            smaller than 3 pixels, so small units look bigger than they are.
          </Trans>
        </p>
      )}
      <p>
        <Trans>
          A player unticked in the players table has faint units. Point at a
          player in the table and their units get a white edge while everyone
          else's go faint.
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
          A yellow circle that grows and fades is an explosion: a projectile
          landing, or, larger, a unit destroyed. Debris landing makes none. The
          Explosions switch turns them off.
        </Trans>
      </p>
      {boxes && (
        <p>
          <Trans>A start box is where a team was allowed to start.</Trans>
        </p>
      )}
      {dots && (
        <p>
          <Trans>
            A dot is where a player's start was set before the game. The engine
            can move a start into its start box, so the commander may have
            appeared a short way off.
          </Trans>
        </p>
      )}
      {(boxes || dots) && (
        <p>
          <Trans>
            Start boxes and dots are drawn under the units, so they never hide
            one.
          </Trans>
        </p>
      )}
      <p>
        <Trans>
          Point at a unit to name it. Click one to keep it named, and click the
          ground to let it go.
        </Trans>
      </p>
      <p>
        <Trans>
          In the timeline at the bottom of the page, the knob sets the time and
          the buttons play the match forward or in reverse, at the speed beside
          them. A tall bar is a unit destroyed, a dot is a chat line and a
          diamond is a player joining, pausing, resigning, giving everything
          away, leaving or a team dying, taken from the replay and its analysis.
          A chat dot is green for allies, blue for spectators, violet for
          whispers and hollow for the system. Marks that would touch are drawn
          as one, larger, and clicking it goes to the earliest event in it. A
          replay that has not been analysed has no kills. The address holds the
          time, so a link opens at that moment.
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
    </>
  );
}

/** Whose colour is whose, in the rail under the map. */
function TeamKey({
  header,
  styles,
}: {
  header: ReplayTrackHeader;
  styles: ReadonlyMap<number, TeamStyle>;
}) {
  return (
    <ul className="flex flex-col gap-1 text-xs">
      {header.teams.map((team) => (
        <li key={team.id} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-2.5 shrink-0 rounded-[2px] border border-foreground/40"
            style={{
              backgroundColor:
                styles.get(team.id)?.fill ?? `rgb(${team.colour.join(", ")})`,
            }}
          />
          {ownerWords(header, team.id)}
        </li>
      ))}
    </ul>
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

/**
 * Whether the page's match clock has the track's range, which is when the map
 * can draw from it. The card adopts the range in every mode, so the dock has the
 * track's range whichever mode is open.
 */
export function useAdoptedTrack(header: ReplayTrackHeader | null): boolean {
  const { range, adoptTrack } = useMatchClock();
  const firstFrame = header?.firstFrame;
  const lastFrame = header?.lastFrame;
  const framesPerSecond = header?.framesPerSecond;
  useLayoutEffect(
    () =>
      firstFrame === undefined ||
      lastFrame === undefined ||
      framesPerSecond === undefined
        ? undefined
        : adoptTrack({ firstFrame, lastFrame, framesPerSecond }),
    [adoptTrack, firstFrame, lastFrame, framesPerSecond],
  );
  return (
    range.source === "track" &&
    range.firstFrame === firstFrame &&
    range.lastFrame === lastFrame &&
    range.framesPerSecond === framesPerSecond
  );
}

/**
 * The Units mode of the replay's map card (#3807): every unit, projectile and
 * wreck where it was at one moment of the match, drawn from the recorded track
 * with no engine and none of the game's Lua.
 *
 * The time is the page's match clock, which keeps it in the address as
 * `?frame=`. A link opens at that frame, held inside the match. The address is
 * replaced, never added to, and only when playing stops or a seek ends. The
 * timeline dock moves the clock and this draws whatever the clock says.
 *
 * Keys act while focus is anywhere in the map, and in the dock, and nowhere
 * else. A text field, and a control that keeps a key for itself, keep it.
 */
export function ReplayMapUnits({
  handle,
  info,
  replayPath,
  adopted,
  mapName,
  minimapUrl,
}: {
  handle: ReplayTrackHandle;
  /** Whose colours the teams wear: the chart's, from the replay's own match. */
  info: DemoInfo;
  replayPath: string | undefined;
  /** From {@link useAdoptedTrack}. Nothing is drawn before it is true. */
  adopted: boolean;
  mapName: string;
  minimapUrl: string | null;
}) {
  const { clock } = useMatchClock();
  if (!adopted) return null;
  return (
    <UnitsView
      handle={handle}
      info={info}
      replayPath={replayPath}
      clock={clock}
      mapName={mapName}
      minimapUrl={minimapUrl}
    />
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
function UnitsView({
  handle,
  info,
  replayPath,
  clock,
  mapName,
  minimapUrl,
}: {
  handle: ReplayTrackHandle;
  info: DemoInfo;
  replayPath: string | undefined;
  clock: ReplayClock;
  mapName: string;
  minimapUrl: string | null;
}) {
  const { t: tr } = useLingui();
  const keys = useTimelineKeys();
  const { header } = handle;
  const [mapX, mapZ] = header.mapSize;
  const groundRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const countsRef = useRef<HTMLParagraphElement | null>(null);
  const viewRef = useRef<MapView | null>(null);
  const [status, setStatus] = useState<MapViewStatus>({ kind: "ready" });
  const [pointed, setPointed] = useState<Named | null>(null);
  const [chosen, setChosen] = useState<Named | null>(null);
  // Read by the loop when it is made, and handed to it again as they change.
  const styles = useUnitMapStyles(info, replayPath, header.teams);
  const stylesRef = useRef(styles);
  stylesRef.current = styles;
  const [drawing, setDrawing] = useUnitDrawing();
  const loaded = useUnitMapIcons(info, header.unitDefs, drawing === "icons");
  const icons = drawing === "icons" ? loaded : null;
  const iconsRef = useRef(icons);
  iconsRef.current = icons;
  const [explosions, setExplosions] = useUnitMapExplosions();
  const explosionsRef = useRef(explosions);
  explosionsRef.current = explosions;
  const layers = useMapLayerToggles(UNIT_MAP_LAYERS);
  const { on } = layers;
  // The map's size in world units, which a Zero-K file's areas are placed in.
  const extent = useMemo(() => ({ x: mapX, z: mapZ }), [mapX, mapZ]);
  const startAreas = useReplayStartAreas({
    info,
    extent: on.startBoxes ? extent : null,
  });
  const hasBoxes = startAreas.loading || startAreas.areas.length > 0;
  const noStarts = on.starts && (info.startPositions?.length ?? 0) === 0;
  const primary = usePrimaryPlayer();
  const meTeam = primary ? playerTeam(info, primary) : undefined;
  // In the colour the chart gives each team, as the flat map's dots are.
  const dots = useMemo(() => {
    if (!on.starts) return [];
    const colours = new Map<number, string>();
    for (const [team, style] of styles) colours.set(team, style.fill);
    return startDots(
      info,
      { worldWidth: mapX, worldHeight: mapZ },
      colours,
      meTeam,
      new Map(),
    );
  }, [on.starts, info, styles, mapX, mapZ, meTeam]);

  useEffect(() => {
    const ground = groundRef.current;
    const canvas = canvasRef.current;
    if (!ground || !canvas) return;
    const ctx = canvas.getContext("2d");
    let pixelRatio = 1;

    const view = createMapView({
      handle,
      clock,
      teams: stylesRef.current,
      icons: iconsRef.current,
      explosions: explosionsRef.current,
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
  }, [handle, clock, mapX, mapZ]);

  useEffect(() => {
    viewRef.current?.setTeams(styles);
  }, [styles]);

  useEffect(() => {
    viewRef.current?.setIcons(icons);
  }, [icons]);

  useEffect(() => {
    viewRef.current?.setExplosions(explosions);
  }, [explosions]);

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
    <ReplayMapLayout
      shape={{ width: mapX, height: mapZ }}
      map={
        // biome-ignore lint/a11y/useSemanticElements: a box that holds the map, which a fieldset would restyle.
        <div
          role="group"
          aria-label={tr`Recorded match`}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: where keyboard focus lands to use the timeline's keys on the map.
          tabIndex={0}
          onKeyDown={keys?.onKeyDown}
          className="flex flex-col gap-1.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
            {/* Under the canvas, so a box or a dot never hides a unit or takes
                the pointer from it. */}
            {on.startBoxes && <StartAreas set={startAreas} named={false} />}
            <StartDotMarks dots={dots} />
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
          {!minimapUrl && (
            <p className="text-xs text-muted-foreground">
              <Trans>
                A picture of this map is not available, so the match is drawn on
                plain ground.
              </Trans>
            </p>
          )}
        </div>
      }
      rail={
        <>
          <MapHelp section={tr`the recorded match`}>
            <Legend
              boxes={on.startBoxes && startAreas.areas.length > 0}
              dots={dots.length > 0}
              drawing={drawing}
            />
          </MapHelp>
          <p
            ref={countsRef}
            className="min-h-4 text-xs text-muted-foreground tabular-nums"
          />
          <p
            data-testid="recorded-unit-name"
            className="min-h-4 text-xs font-medium"
          >
            {named ? `${unitName}, ${ownerWords(header, named.team)}` : ""}
          </p>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={1}
            aria-label={tr`Unit drawing`}
            className="w-full flex-wrap items-stretch @xl:flex-col @xl:flex-nowrap"
            value={drawing}
            onValueChange={(next) => {
              if (next) setDrawing(next as UnitDrawing);
            }}
          >
            <ToggleGroupItem value="icons" className="@xl:justify-start">
              <Trans>Icons</Trans>
            </ToggleGroupItem>
            <ToggleGroupItem value="footprints" className="@xl:justify-start">
              <Trans>Footprints</Trans>
            </ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup
            type="multiple"
            variant="outline"
            size="sm"
            spacing={1}
            aria-label={tr`Marks on the unit map`}
            className="w-full flex-wrap items-stretch @xl:flex-col @xl:flex-nowrap"
            value={explosions ? ["explosions"] : []}
            onValueChange={(picked) =>
              setExplosions(picked.includes("explosions"))
            }
          >
            <ToggleGroupItem value="explosions" className="@xl:justify-start">
              <Trans>Explosions</Trans>
            </ToggleGroupItem>
          </ToggleGroup>
          {layers.layersShown ? (
            <div data-map-controls className="flex flex-col gap-3">
              <LayerSwitches layers={layers} only={UNIT_MAP_LAYERS} />
              <div data-map-notes className="flex flex-col gap-2">
                {on.startBoxes && !hasBoxes && (
                  <p className="text-xs text-muted-foreground">
                    <Trans>This match set no start boxes.</Trans>
                  </p>
                )}
                {noStarts && (
                  <p className="text-xs text-muted-foreground">
                    <Trans>This replay recorded no start positions.</Trans>
                  </p>
                )}
              </div>
            </div>
          ) : (
            on.startBoxes &&
            startAreas.areas.length > 0 && (
              <p className="text-xs text-muted-foreground">
                <Trans>Start boxes per team.</Trans>
              </p>
            )
          )}
          <TeamKey header={header} styles={styles} />
        </>
      }
    />
  );
}
