/**
 * Apply canned animations to a unit and watch them run.
 *
 * A preset can only be applied once its roles are filled, and the reason it
 * cannot is named rather than left as a greyed-out button. Playback changes
 * nothing in the document: stopping restores the built pose exactly.
 *
 * A unit that has taken its script over is past all of this. The presets are
 * gone for it, so playback runs the script itself: pick what happens to the
 * unit, and the viewport plays what the script does about it.
 *
 * A unit on the presets gets the same player above its preset list, running
 * the script the presets generate.
 */

import { Button, Input } from "@picoframe/frame";
import {
  ChevronRight,
  FileCode,
  Pause,
  Play,
  Square,
  StepBack,
  StepForward,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { animCobProbe, animCobRun } from "../../../animation/bindings";
import { OptionSelect } from "../../../components/OptionSelect";
import { useReduceMotion } from "../../../general/display";
import { aimPoint } from "../../aimPoint";
import {
  type Aim,
  aimsOf,
  expandForWeapons,
  resolveScenario,
  weaponCount,
  withWorld,
} from "../../aimResolver";
import {
  type AnimPreset,
  type AppliedPreset,
  countRoles,
  PRESETS,
  type PresetParam,
  presetById,
  roleLabel,
  unmetRequirements,
} from "../../animPresets";
import { legoProbeScript, legoRunScript } from "../../bindings";
import {
  DRIVE_PATHS,
  type DrivePath,
  type DriveRun,
  type DriveSource,
  driveAlong,
  driveMotion,
  ENGINE_MIN_SCRIPT_CHANGE_HEADING,
  pathPoints,
} from "../../drive";
import { type UnitMotion, unitMotion } from "../../effects";
import type { GroundId, GroundShape } from "../../environment";
import {
  paramFor,
  withInstanceParam,
  withoutInstanceSettings,
} from "../../instanceSettings";
import { presetCopies, presetInstanceIds, unitScript } from "../../luaScript";
import {
  DEFAULT_BUILDER,
  type LegoBuilder,
  type LegoMovement,
  type LegoPieceWeapon,
  type LegoProject,
} from "../../model";
import { movesInGame } from "../../movement";
import type { LoadedPack } from "../../pack";
import { pieceRest } from "../../pieceRest";
import type { RawGeometry } from "../../rawGeometry";
import { pieceWorldRest, unitBounds, unitSize } from "../../s3oBuild";
import { scenarioMark } from "../../scenarioMarks";
import { isMarked } from "../../scriptMarks";
import {
  at,
  CREATED,
  clampFrame,
  FIRE_INTERVAL_FRAMES,
  type NanoStyle,
  onGround,
  PREVIEW_FRAMES,
  PREVIEW_SECONDS,
  playable,
  SCENARIOS,
  type Scenario,
  type ScriptEvent,
  type ScriptGround,
  type ScriptTimeline,
  type StandInTrack,
  scenarioById,
} from "../../scriptPlayback";
import {
  SOLO_MOVES_NOTHING,
  soloProject,
  soloScenario,
} from "../../soloPreset";
import { standInRadius, trackBesideUnit } from "../../standIn";
import {
  anchorFor,
  DEFAULT_TARGET,
  TARGET_PATHS,
  type TargetMotion,
  type TargetPath,
  type TargetScale,
  targetTrack,
} from "../../targetMotion";
import { isBuilder } from "../../unitDef";
import { controlFor } from "../../unitValueControls";
import { overridesFit, shownParams, withoutFitOverrides } from "../../walkFit";
import { pickedWeapon } from "../../weaponModule";
import { unitReaches } from "../../weaponReach";
import type { LegoWorth } from "../../worth";
import { BuilderReport } from "./BuilderReport";
import { GameFitSection } from "./GameFitSection";
import { MovementSection } from "./MovementSection";
import type { ReferenceUnit } from "./ReferencePicker";
import { ScrubberMarks } from "./ScrubberMarks";
import { StatsSection } from "./StatsSection";
import type { DrivePlacement } from "./standInPlayback";
import { useWeaponSource, WeaponsSection } from "./WeaponsSection";
import { ProjectWorkshopMarks } from "./WorkshopChangeMarks";
import { WorthSection } from "./WorthSection";

/** The scenario Select's own entry for firing an arbitrary function by name,
 *  rather than one of the canned scenarios above it. Not a real scenario id:
 *  nothing in `SCENARIOS` uses it, and `scenarioById` finding nothing for it
 *  is how the panel tells the two apart. */
const CALL_FUNCTION = "call";

/**
 * The call-ins a scenario asks a script to name a piece for, before the run.
 *
 * Both answer with a piece rather than doing anything, which is what makes
 * them safe to call directly rather than drive over frames: see
 * `legoProbeScript` and `animCobProbe`. `QueryTransport` is not here: the
 * runtime asks it itself, at the moment the engine attaches a passenger.
 */
const STAND_IN_PROBES = ["AimFromWeapon1", "QueryBuildInfo"];

/** Nothing to place, which is what a scenario with no track asks for. */
const NO_STAND_IN: {
  track: StandInTrack | null;
  attachPieces: Map<string, string>;
  nano?: NanoStyle | null;
} = { track: null, attachPieces: new Map() };

/** A drive worked out for a scenario that also aims, to be merged with the
 *  firing events once the stand-in's track is known. */
interface Driven {
  run: DriveRun;
  source: DriveSource;
  placement: DrivePlacement;
  /** The drive's `StartMoving`, `ChangeHeading` and `StopMoving`. */
  moving: ScriptEvent[];
  /** The ambient event on each frame that says where the unit is. */
  poses: ScriptEvent[];
}

/** The unit value the engine answers `get CURRENT_SPEED` with
 *  (`rts/Sim/Units/Scripts/CobDefines.h:53`), in 65536ths of an elmo a
 *  frame. The preview answers one elmo a frame unless the panel changes it
 *  (`crates/coilbox-unitpose/src/unitvalue.rs`). */
const CURRENT_SPEED = 29;
const COB_SCALE = 65536;

/** The unit values a drive answers itself, `MAX_SPEED` and `HEADING` beside
 *  `CURRENT_SPEED` (`rts/Sim/Units/Scripts/CobDefines.h`). A control for one
 *  would change nothing while the unit drives, so none is offered. */
const DRIVEN_VALUES = new Set([CURRENT_SPEED, 75, 82]);

/** When `ChangeHeading` reaches the script: never, which is the engine's own
 *  `minScriptChangeHeading`, or on every frame the unit turns, which is a game
 *  lowering it to 1. */
const CHANGE_HEADING_OPTIONS = [
  { value: "engine", label: "ChangeHeading: never (default)" },
  { value: "every", label: "ChangeHeading: every turning frame" },
];

/** Where a drive's speed and turn rate came from, in words. */
function driveSourceText({
  motion,
  speed,
  turnRate,
  reverseSpeed,
}: DriveSource): string {
  const speedFrom = {
    movement: "from Movement",
    definition: "from the game's definition",
    preview: "the preview's own",
  }[speed];
  const turnFrom =
    turnRate === "none"
      ? "none set, so the engine's least"
      : turnRate === "movement"
        ? "from Movement"
        : "from the game's definition";
  const reverseFrom =
    reverseSpeed === "none"
      ? "none set, so it never reverses"
      : reverseSpeed === "movement"
        ? "from Movement"
        : "from the game's definition";
  const reverse = `Reverse speed ${Math.round((motion.reverseSpeed ?? 0) * 30 * 10) / 10} elmos/s, ${reverseFrom}.`;
  return `Speed ${Math.round(motion.speed * 30 * 10) / 10} elmos/s, ${speedFrom}. Turn rate ${Math.round(motion.turnRate * 10) / 10}, ${turnFrom}. ${reverse}`;
}

/** How fast a scenario's unit moves and when, from the speed the script is
 *  told it moves at. */
function motionOf(
  events: ScriptEvent[],
  values: Record<number, number>,
): UnitMotion | null {
  return unitMotion(events, (values[CURRENT_SPEED] ?? COB_SCALE) / COB_SCALE);
}

/** What a scenario's attachment could not be resolved to, in words. */
function attachNotes(scenario: Scenario, named: Map<string, string>): string[] {
  const attach = scenario.standIn?.attach;
  if (!attach || named.has(attach.from)) return [];
  return [
    `This script names no ${attach.from} piece, so the stand-in stays where the scenario puts it rather than sitting on the unit.`,
  ];
}

/**
 * `"0.8, 0.15"` into `[0.8, 0.15]`, or null when it is not a clean list of
 * numbers. Empty text is zero arguments rather than an error, since a
 * function that takes none is exactly as valid as one that does.
 */
function parseArgList(text: string): number[] | null {
  const trimmed = text.trim();
  if (trimmed === "") return [];
  const numbers: number[] = [];
  for (const part of trimmed.split(",")) {
    const piece = part.trim();
    const value = Number(piece);
    if (piece === "" || Number.isNaN(value)) return null;
    numbers.push(value);
  }
  return numbers;
}

/**
 * What each parameter's number is measured in, beside the slider.
 *
 * A map rather than a chain of ternaries, because the chain ended in a bare
 * `/s` that stood for turns per second and quietly claimed every unit added
 * after it. `deg/s` came out as `/s` with the degrees lost.
 */
const PARAM_SUFFIX: Record<PresetParam["unit"], string> = {
  deg: "°",
  s: " s",
  m: " m",
  hz: "/s",
  "deg/s": "°/s",
  "%": "%",
};

/**
 * The two numbers a builder is worth, as sliders.
 *
 * `canAssist` is not here because it is a switch rather than a number, and the
 * two ranges are the engine's own: `buildDistance` defaults to 128 and is
 * clamped up to 38, `workerTime` defaults to zero, which is the number that
 * makes a builder silently not one.
 */
const BUILDER_FIELDS: {
  id: "workerTime" | "buildDistance";
  label: string;
  suffix: string;
  min: number;
  max: number;
  step: number;
  note: string;
}[] = [
  {
    id: "workerTime",
    label: "Work rate",
    suffix: "",
    min: 10,
    max: 2000,
    step: 10,
    note: "Writes workerTime, which is also the repair, reclaim and capture speed unless a definition sets those separately.",
  },
  {
    id: "buildDistance",
    label: "Build distance",
    suffix: " elmos",
    min: 38,
    max: 1000,
    step: 8,
    note: "How far it reaches. The engine clamps anything under 38, which is the least that keeps a one by one builder clear of a one by one building.",
  },
];

/**
 * How long a change to the call arguments, or to the generated script, has to
 * sit still before the panel runs it. One number for both: typing an argument
 * and dragging a preset slider are the same kind of burst of edits, and 400 is
 * the wait the arguments field already used.
 */
const SETTLE_MS = 400;

/** The instance picker's entry for the shared settings. Every other entry is
 *  `copy:` and an instance id, because the id of pieces from no module is an
 *  empty string, which a Select option cannot be. */
const ALL_COPIES = "all";
const COPY_PREFIX = "copy:";

/** Where a run that replaces a playing one picks up from. */
interface Resume {
  paused: boolean;
  frame: number;
}

interface Props {
  project: LegoProject;
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
  onChange: (applied: AppliedPreset[]) => void;
  /** Opens the strip on its Script tab, which is where a script is read,
   *  edited, taken over or handed back now. */
  onShowScript: () => void;
  /** What the unit builds with, written into its definition. Only asked for
   *  when the unit has a build arm on it. */
  onBuilderChange: (builder: LegoBuilder) => void;
  /** The movement class, speed and turn rate, or nothing for a unit that
   *  does not move (issue #3255). */
  onMovementChange: (movement: LegoMovement | undefined) => void;
  /** The table that sets the unit's health, cost and mass (issue #3280). */
  onWorthChange: (worth: LegoWorth) => void;
  /** What a turret or aim point fires, and over what arc (issue #3274). The
   *  Weapons section is shown only when this is given. */
  onWeaponChange?: (pieceId: string, weapon: LegoPieceWeapon) => void;
  /** The game unit picked beside the build, for the stats to compare with. */
  referenceUnit?: ReferenceUnit | null;
  /**
   * The poses a run of the unit's own script produced, for the viewport to
   * play. Null whenever the presets are what is playing, or nothing is.
   */
  onScriptTimeline: (timeline: ScriptTimeline | null) => void;
  /**
   * The same run, reported whatever it managed rather than only a playable
   * one, for the Script tab's error and coverage marks. Null once the script
   * has changed since, because playback stops on that same change.
   */
  onScriptRun: (timeline: ScriptTimeline | null) => void;
  /**
   * Whether the run's clock is frozen on `scriptFrame`. Pausing holds the
   * viewport on one frame without losing the run. Stepping and scrubbing both
   * pause it first, since either only makes sense as a still frame.
   */
  scriptPaused: boolean;
  onScriptPausedChange: (paused: boolean) => void;
  /** The frame a paused run is held on, and the frame a running one is
   *  currently showing. */
  scriptFrame: number;
  onScriptFrameChange: (frame: number) => void;
  /** Both needed to measure the unit, which is what sizes the stand-in, and to
   *  work out where a piece rests, which is where an aim is measured from. */
  pack: LoadedPack;
  raw: RawGeometry | null;
  /** The track the running scenario puts a stand-in on, and the pieces its
   *  attachments resolved to, for the viewport to place it. */
  onStandIn: (placement: {
    track: StandInTrack | null;
    attachPieces: Map<string, string>;
    nano?: NanoStyle | null;
    aims?: Aim[];
    motion?: UnitMotion | null;
    /** Where the game maker let the stand-in go after dragging it, unit-local
     *  x and z in elmos, and the frame they let it go on. Only for a
     *  scenario whose target can be moved. */
    onDrag?: (at: [number, number], frame: number) => void;
    /** The unit's own drive, for the scenario that drives it. */
    drive?: DrivePlacement | null;
  }) => void;
  /** What the unit's game lacks for effects to draw its own bitmaps, or null
   *  when it has everything they need. Shown only for a scenario that fires
   *  something drawn with a bitmap. */
  effectsNote?: string | null;
  /** The ground the viewport stands the unit on, which a script asking where
   *  the ground is gets told about. Absent or a null shape is flat. */
  ground?: {
    choice?: { id: GroundId };
    shape: GroundShape | null;
    up: [number, number, number] | null;
  };
}

export function AnimationPanel({
  project,
  playing,
  onPlayingChange,
  onChange,
  onShowScript,
  onBuilderChange,
  onMovementChange,
  onWorthChange,
  onWeaponChange,
  referenceUnit,
  onScriptTimeline,
  onScriptRun,
  scriptPaused,
  onScriptPausedChange,
  scriptFrame,
  onScriptFrameChange,
  pack,
  raw,
  onStandIn,
  effectsNote,
  ground,
}: Props) {
  const reduceMotion = useReduceMotion();
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const [timeline, setTimeline] = useState<ScriptTimeline | null>(null);
  const [running, setRunning] = useState(false);
  /** A run that never reached the runtime, as opposed to one that failed in it. */
  const [failure, setFailure] = useState<string | null>(null);
  /** What the preview could not work out about the stand-in: an aim piece the
   *  script does not name, a transport piece it does not name. Said rather
   *  than hidden, because that is exactly the bug the preview exists to show. */
  const [standInNotes, setStandInNotes] = useState<string[]>([]);
  const weaponSource = useWeaponSource(project);
  // Memoised: measuring the unit bakes every piece, and this is read on each
  // run rather than on each render.
  const bounds = useMemo(
    () => unitBounds(project, pack, raw),
    [project, pack, raw],
  );
  // The unit's own size, for a script that asks how big it is. Memoised for
  // the reason `bounds` is.
  const size = useMemo(
    () => unitSize(project, pack, raw),
    [project, pack, raw],
  );
  // Read by every run rather than captured, so the run callbacks are not
  // rebuilt for it, and keyed by value for the rerun below.
  const scriptGround = useRef<ScriptGround | null>(null);
  scriptGround.current = ground?.shape
    ? { shape: ground.shape, up: ground.up }
    : null;
  const groundId = ground?.choice?.id;
  const groundKey = JSON.stringify([scriptGround.current, groundId]);
  /** Unit values the panel has changed away from what the last run's `asked`
   *  reported as their default. Never saved to the project: this is a way to
   *  poke at a script's preview, not a decision about the unit. */
  const [values, setValues] = useState<Record<number, number>>({});
  /** How the firing scenario's target moves. A way to poke at the preview,
   *  like `values`, and never saved. Read by every run through the ref, since
   *  a drag in the viewport changes it from a callback the panel handed out
   *  on an earlier run. */
  const [target, setTarget] = useState<TargetMotion>(DEFAULT_TARGET);
  const targetRef = useRef(target);
  const targetDebounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(targetDebounce.current), []);
  /** The path the driving scenario follows, the points of the game maker's
   *  own, and whether a turn is sent as `ChangeHeading`. Preview pokes, never
   *  saved, and read through the ref for the reason `target` is. */
  const [drive, setDrive] = useState<{
    path: DrivePath;
    own: [number, number][];
    everyTurn: boolean;
  }>({ path: "straight", own: [], everyTurn: false });
  const driveRef = useRef(drive);
  /** The function chosen for the "Call a function" scenario, and the text of
   *  its arguments, kept apart from `values` because neither is a unit value. */
  const [callFunction, setCallFunction] = useState("");
  const [callArgsText, setCallArgsText] = useState("");
  const [callArgsError, setCallArgsError] = useState<string | null>(null);
  const argsDebounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(argsDebounce.current), []);
  /** Which run is the latest, so a slow one that a newer run has overtaken
   *  does not put its poses back over the newer run's. */
  const latestRun = useRef(0);
  const isCallMode = scenarioId === CALL_FUNCTION;
  const applied = project.animations ?? [];
  const counts = countRoles(project.pieces);
  const owned = project.script !== undefined;
  // The compiled file the unit's game shipped, when that is what animates it.
  // Text somebody owns beats the file they came in with, so a unit that has
  // taken a script over is past this even if it still carries the bytecode.
  const compiled = owned ? undefined : project.compiledScript;
  /** Whether this unit animates from a script of its own rather than presets. */
  const playsOwnScript = owned || compiled !== undefined;
  // Only the generated script is read for marks. An owned or compiled one is
  // the user's, and its call-ins are not something presets can be blamed for.
  /**
   * The applied preset playing alone, or null when everything is. A preview
   * only: the project is never edited, and a run narrows a copy of it. Held in
   * a ref as well, because a run starts in the same tick that chooses it, and
   * a ref is the one place that answer is already settled.
   */
  const [soloId, setSoloId] = useState<string | null>(null);
  const solo =
    !playsOwnScript && soloId && applied.some((a) => a.presetId === soloId)
      ? soloId
      : null;
  const soloRef = useRef<string | null>(solo);
  soloRef.current = solo;
  /** The copy of a module picked for each preset in its panel, by preset id.
   *  Absent means all copies, the shared settings. */
  const [picked, setPicked] = useState<Record<string, string>>({});
  const copyOf = (preset: AnimPreset): string | null => {
    const id = picked[preset.id];
    return id !== undefined && presetInstanceIds(project, preset).includes(id)
      ? id
      : null;
  };
  /** The copy the solo run plays: the one picked for the soloed preset. */
  const soloCopy = () => {
    const preset = solo ? presetById(solo) : undefined;
    return preset ? copyOf(preset) : null;
  };
  const soloCopyRef = useRef<string | null>(null);
  soloCopyRef.current = soloCopy();
  /** The script a run plays now: the soloed preset's alone, or all of them. */
  const scriptNow = useCallback(
    () =>
      unitScript(
        soloRef.current
          ? soloProject(project, soloRef.current, soloCopyRef.current)
          : project,
      ),
    [project],
  );
  const marks = useMemo(() => {
    const result = new Map<string, string>();
    if (playsOwnScript) return result;
    const script = unitScript(project);
    for (const option of SCENARIOS) {
      const reason = scenarioMark(option, script);
      if (reason) result.set(option.id, reason);
    }
    return result;
  }, [project, playsOwnScript]);

  const stop = useCallback(() => {
    soloRef.current = null;
    setSoloId(null);
    onPlayingChange(false);
    onScriptTimeline(null);
    onScriptRun(null);
    setTimeline(null);
    setFailure(null);
    setStandInNotes([]);
    onStandIn(NO_STAND_IN);
    onScriptPausedChange(false);
    onScriptFrameChange(0);
  }, [
    onPlayingChange,
    onScriptTimeline,
    onScriptRun,
    onStandIn,
    onScriptPausedChange,
    onScriptFrameChange,
  ]);

  /**
   * Run `events` through whichever runtime this unit's script belongs to,
   * seeded with `withValues`, and report what came back.
   *
   * The one place either runtime is called from: a scenario, a scrub of a
   * unit value, and a call to one of the script's own functions are all just
   * a different `events` list over the same run.
   */
  const runEvents = useCallback(
    async (
      events: ScriptEvent[],
      withValues: Record<number, number>,
      resume?: Resume,
    ) => {
      const thisRun = ++latestRun.current;
      setRunning(true);
      setFailure(null);
      try {
        // Every run carries the scene. A scenario with a stand-in has already
        // been given it by `start`. Anything else, an idle run or a call to one
        // of the script's own functions, is the unit alone.
        const told = onGround(events, groundId);
        const sent = told.some((event) => event.world)
          ? told
          : withWorld(told, null, {
              radius: 0,
              self: size,
              attachPiece: () => null,
              ground: scriptGround.current,
            });
        const pieces = project.pieces.map((piece) => piece.name);
        // Two runtimes, one timeline. The compiled one runs the bytecode the
        // game shipped and reports the same poses the Lua one does.
        const result = compiled
          ? await animCobRun({
              bytes: compiled.bytes,
              pieces,
              events: sent,
              frames: PREVIEW_FRAMES,
              rest: pieceRest(project),
              values: withValues,
            })
          : await legoRunScript({
              // What the unit's script is: its own text, or the one its presets
              // generate, so the preview runs what an export would write.
              script: scriptNow(),
              unitName: project.unitName,
              pieces,
              events: sent,
              frames: PREVIEW_FRAMES,
              // A script may read its own definition, and without it those
              // scripts throw at load rather than losing a branch (#1936).
              unitDef: project.gameUnitDef ?? null,
              // A game may keep half its animation in a shared library, and
              // without it the script stops on the line that calls into it
              // (#1944).
              includes: project.gameScriptIncludes ?? null,
              // A script may ask where one of its pieces is, and neither
              // runtime reads models, so the shape travels with the run (#1948).
              rest: pieceRest(project),
              values: withValues,
            });
        if (thisRun !== latestRun.current) return;
        setTimeline(result);
        // A run that produced nothing has only its reason to show. One that
        // failed part way through is still worth watching up to that point.
        onScriptTimeline(result.frames.length > 0 ? result : null);
        // The Script tab wants the run regardless, since a script that fails
        // before its first frame is exactly the run its own error matters for.
        onScriptRun(result);
        onPlayingChange(result.frames.length > 0);
        // A run that replaces a playing one holds the pause and the frame, as
        // far as the new run reaches.
        const keep = resume && resume.frame < result.frames.length;
        onScriptPausedChange(keep ? resume.paused : false);
        onScriptFrameChange(keep ? resume.frame : 0);
      } catch (error) {
        if (thisRun !== latestRun.current) return;
        setTimeline(null);
        onScriptTimeline(null);
        onScriptRun(null);
        onPlayingChange(false);
        setFailure(error instanceof Error ? error.message : String(error));
      } finally {
        if (thisRun === latestRun.current) setRunning(false);
      }
    },
    [
      // The whole project, because where its pieces sit is read off it too.
      project,
      scriptNow,
      compiled,
      size,
      groundId,
      onPlayingChange,
      onScriptTimeline,
      onScriptRun,
      onScriptPausedChange,
      onScriptFrameChange,
    ],
  );

  /**
   * Run a scenario, first working out where its stand-in goes and what that
   * makes its aiming call-ins' arguments.
   *
   * A scenario with neither is run exactly as it always was, with no probe:
   * most of them want neither and a probe is a second trip into the runtime.
   */
  const start = useCallback(
    async (
      scenarioId: string,
      withValues: Record<number, number> = values,
      resume?: Resume,
    ) => {
      const scenario = scenarioById(scenarioId);
      if (!scenario) return;

      // A scenario that drives and also aims is worked out as a drive first,
      // then as a firing scenario from where the unit is on each frame.
      let driven: Driven | null = null;
      if (scenario.drive) {
        const source = driveMotion(project);
        const settings = driveRef.current;
        const points = pathPoints(settings.path, source.motion, settings.own);
        const ground = scriptGround.current;
        const run = driveAlong(points, source.motion, {
          start: at(0.5),
          frames: PREVIEW_FRAMES,
          ground: ground?.shape ?? null,
          // A ground with no up is a unit that stays upright on it.
          tilts: ground !== null && ground.up !== null,
          minScriptChangeHeading: settings.everyTurn
            ? 1
            : ENGINE_MIN_SCRIPT_CHANGE_HEADING,
        });
        // A compiled script is never sent `ChangeHeading`: the engine's
        // `CCobInstance::ChangeHeading` does nothing (`CobInstance.h:171`).
        const moving = compiled
          ? run.events.filter((event) => event.callin !== "ChangeHeading")
          : run.events;
        // One event a frame that only says where the unit is, because what
        // a script reads about its heading and speed changes every frame.
        const poses: ScriptEvent[] = run.frames.map((_, frame) => ({
          frame,
          ambient: true,
        }));
        const placement: DrivePlacement = {
          frames: run.frames,
          path: points,
          ...(settings.path === "own"
            ? { onPick: (point: [number, number]) => pickRef.current(point) }
            : {}),
        };
        if (scenario.movingTarget) {
          driven = { run, source, placement, moving, poses };
        } else {
          setStandInNotes([]);
          const events = [...CREATED, ...moving, ...poses].sort(
            (a, b) => a.frame - b.frame,
          );
          onStandIn({
            ...NO_STAND_IN,
            // The unit really moves, so what it leaves behind stays put on its
            // own rather than being carried back past it.
            motion: null,
            drive: placement,
          });
          const scene = withWorld(events, null, {
            radius: 0,
            self: size,
            attachPiece: () => null,
            ground,
            drive: { frames: run.frames, maxSpeed: source.motion.speed },
          });
          return runEvents(scene, withValues, resume);
        }
      }

      if (!scenario.standIn && !scenario.events.some((e) => e.aimAtStandIn)) {
        setStandInNotes([]);
        onStandIn({
          ...NO_STAND_IN,
          motion: motionOf(scenario.events, withValues),
        });
        return runEvents(scenario.events, withValues, resume);
      }

      const pieces = project.pieces.map((piece) => piece.name);
      const probeOnce = (callins: string[]) =>
        compiled
          ? animCobProbe({ bytes: compiled.bytes, pieces, callins })
          : legoProbeScript({
              script: scriptNow(),
              unitName: project.unitName,
              pieces,
              callins,
              unitDef: project.gameUnitDef ?? null,
              includes: project.gameScriptIncludes ?? null,
              rest: pieceRest(project),
            });

      // Both runtimes answer the same question: which piece a call-in like
      // `AimFromWeapon1` names. `anim_cob_probe` asks the bytecode the same
      // way `legoProbeScript` asks the Lua, so a compiled unit's stand-in
      // sits on its aim-from piece rather than the unit's origin.
      const probes = await probeOnce(STAND_IN_PROBES);

      const named = new Map<string, string>();
      for (const probe of probes?.probes ?? []) {
        const first = probe.pieces[0];
        if (first) named.set(probe.callin, first);
      }

      // How many weapons this scenario should drive, from the unit's own
      // definition when there is one, else the script's own numbered weapon
      // functions, which the probe above already asked for regardless of
      // what it was told to name a piece for.
      const weapons = weaponCount(
        project.gameUnitDef ?? null,
        probes?.functions ?? [],
      );
      if (weapons > 1) {
        const more = await probeOnce(
          Array.from(
            { length: weapons - 1 },
            (_, index) => `AimFromWeapon${index + 2}`,
          ),
        );
        for (const probe of more?.probes ?? []) {
          const first = probe.pieces[0];
          if (first) named.set(probe.callin, first);
        }
      }

      const rest = pieceWorldRest(project, pack, raw);
      const radius = standInRadius(bounds, scenario.standIn?.size);
      // A target that moves goes as fast as the script is told its unit does,
      // times the game maker's choice, and no nearer than touching the unit.
      const scale: TargetScale = {
        radius,
        // A drive answers `CURRENT_SPEED` itself, so the unit's pace is its
        // top speed in elmos a frame.
        unitSpeed: driven
          ? driven.source.motion.speed
          : (withValues[CURRENT_SPEED] ?? COB_SCALE) / COB_SCALE,
        nearest: (Math.max(bounds.sizeX, bounds.sizeZ) / 2 + radius) / radius,
      };
      const track = scenario.movingTarget
        ? targetTrack(targetRef.current, scale)
        : scenario.standIn
          ? trackBesideUnit(scenario.standIn, bounds, radius)
          : null;
      const { events: aimed, notes } = resolveScenario(
        {
          ...scenario,
          events: expandForWeapons(
            scenario.events,
            weapons,
            FIRE_INTERVAL_FRAMES,
          ),
          standIn: track ?? undefined,
        },
        {
          radius,
          mid: aimPoint(project, bounds),
          pieceRest: rest,
          probed: (callin) => named.get(callin) ?? null,
          ground: scriptGround.current?.shape ?? null,
          up: scriptGround.current?.up ?? null,
          drive: driven?.run.frames ?? null,
          reaches: unitReaches(
            project,
            (fires) => {
              const picked = pickedWeapon(
                fires,
                weaponSource.gameName ?? "",
                weaponSource.weaponDefs,
                weaponSource.projects,
              );
              return picked && "def" in picked ? picked.def : null;
            },
            weaponSource.weaponDefs ?? {},
            (number, mountedOn) =>
              named.get(`AimFromWeapon${number}`) ?? mountedOn,
          ),
        },
      );
      const events = driven
        ? [...aimed, ...driven.moving, ...driven.poses].sort(
            (a, b) => a.frame - b.frame,
          )
        : aimed;

      setStandInNotes([...notes, ...attachNotes(scenario, named)]);
      onStandIn({
        track,
        attachPieces: named,
        nano: scenario.nano ?? null,
        aims: aimsOf(events, driven?.run.frames),
        // A drive really moves the unit, so what it leaves behind stays put.
        motion: driven ? null : motionOf(events, withValues),
        ...(driven ? { drive: driven.placement } : {}),
        ...(scenario.movingTarget
          ? {
              onDrag: (at: [number, number], frame: number) =>
                retargetRef.current(
                  {
                    ...targetRef.current,
                    anchor: anchorFor(
                      targetRef.current,
                      [at[0] / radius, at[1] / radius],
                      frame,
                      scale,
                    ),
                  },
                  frame,
                ),
            }
          : {}),
      });
      const scene = withWorld(events, track, {
        radius,
        self: size,
        attachPiece: (from) => {
          const piece = named.get(from);
          return piece ? (rest.get(piece) ?? null) : null;
        },
        ground: scriptGround.current,
        ...(driven
          ? {
              drive: {
                frames: driven.run.frames,
                maxSpeed: driven.source.motion.speed,
              },
            }
          : {}),
      });
      return runEvents(scene, withValues, resume);
    },
    [
      runEvents,
      scriptNow,
      values,
      project,
      compiled,
      bounds,
      pack,
      raw,
      size,
      onStandIn,
      weaponSource.gameName,
      weaponSource.weaponDefs,
      weaponSource.projects,
    ],
  );

  /** Fire one of the script's own functions, the way `CREATED` then a scenario's
   *  own call-ins do, `at(0.5)` seconds in for the same reason those wait: a
   *  `Create` that sleeps is still setting the unit up on frame zero. */
  const fireCall = useCallback(
    (
      name: string,
      argsText: string,
      withValues: Record<number, number> = values,
      resume?: Resume,
    ) => {
      if (!name) return;
      const args = parseArgList(argsText);
      if (args === null) {
        setCallArgsError(
          "Numbers, comma separated. Call-ins that aim take radians, as the engine hands them.",
        );
        return;
      }
      setCallArgsError(null);
      void runEvents(
        [...CREATED, { frame: at(0.5), callin: name, args }],
        withValues,
        resume,
      );
    },
    [runEvents, values],
  );

  /** A unit value changed, by hand or by reset: keep it, and run again with it. */
  const changeValue = useCallback(
    (id: number, raw: number | undefined) => {
      const next = { ...values };
      if (raw === undefined) delete next[id];
      else next[id] = raw;
      setValues(next);
      if (isCallMode) fireCall(callFunction, callArgsText, next);
      // Through `start` rather than straight to the runtime, so a scenario
      // that aims at its stand-in is resolved again with the new value rather
      // than fired with no arguments at all.
      else void start(scenarioId, next);
    },
    [
      values,
      isCallMode,
      fireCall,
      callFunction,
      callArgsText,
      start,
      scenarioId,
    ],
  );

  const onArgsTextChange = useCallback(
    (text: string) => {
      setCallArgsText(text);
      clearTimeout(argsDebounce.current);
      argsDebounce.current = setTimeout(
        () => fireCall(callFunction, text),
        SETTLE_MS,
      );
    },
    [fireCall, callFunction],
  );

  /** Stepping only makes sense on a held frame, so it pauses first. */
  const step = useCallback(
    (delta: number) => {
      if (!timeline) return;
      onScriptPausedChange(true);
      onScriptFrameChange(clampFrame(timeline, scriptFrame + delta));
    },
    [timeline, scriptFrame, onScriptPausedChange, onScriptFrameChange],
  );

  // A script edited while it is playing leaves the poses on screen describing
  // the script before the edit. A script the game maker owns stops playback
  // rather than lie about it. A preset unit's script is generated, so editing
  // its presets, a slider or a piece's role changes it too, and there the
  // panel runs the new script once the edits settle. Held in refs because the
  // callbacks are rebuilt on every render.
  const stopRef = useRef(stop);
  stopRef.current = stop;
  const rerunRef = useRef<(frame?: number) => void>(() => {});
  rerunRef.current = (frame = scriptFrame) => {
    const resume = { paused: scriptPaused, frame };
    if (isCallMode) fireCall(callFunction, callArgsText, values, resume);
    else void start(scenarioId, values, resume);
  };
  // Whether there is a run on screen, or a failure, for a change to replace.
  const hasRun = timeline !== null || failure !== null || playing;
  const hasRunRef = useRef(hasRun);
  hasRunRef.current = hasRun;
  const currentScript = useMemo(
    () =>
      unitScript(
        solo ? soloProject(project, solo, soloCopyRef.current) : project,
      ),
    [project, solo],
  );
  const lastScript = useRef(currentScript);
  const rerunTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (lastScript.current === currentScript) return;
    lastScript.current = currentScript;
    if (playsOwnScript || applied.length === 0) {
      clearTimeout(rerunTimer.current);
      stopRef.current();
      return;
    }
    if (!hasRunRef.current) return;
    clearTimeout(rerunTimer.current);
    rerunTimer.current = setTimeout(() => rerunRef.current(), SETTLE_MS);
  }, [currentScript, playsOwnScript, applied.length]);
  useEffect(() => () => clearTimeout(rerunTimer.current), []);

  /**
   * A new motion for the target, run straight away when something is on
   * screen for it to replace. A drag says which frame it let go on, so the
   * run picks up there with the target where it was put.
   */
  const retargetRef = useRef<(next: TargetMotion, frame?: number) => void>(
    () => {},
  );
  retargetRef.current = (next, frame) => {
    targetRef.current = next;
    setTarget(next);
    clearTimeout(targetDebounce.current);
    if (hasRunRef.current) rerunRef.current(frame);
  };
  /** A new path or setting for the drive, run from the start, because a
   *  different path is a different drive rather than the same one later. */
  function changeDrive(next: typeof drive) {
    driveRef.current = next;
    setDrive(next);
    if (hasRunRef.current) rerunRef.current(0);
  }
  /** A click on the ground while the game maker makes their own path. */
  const pickRef = useRef<(point: [number, number]) => void>(() => {});
  pickRef.current = (point) =>
    changeDrive({
      ...driveRef.current,
      own: [...driveRef.current.own, point],
    });

  /** The speed slider moves in a burst, so it waits for the burst to settle
   *  the way the call arguments do. */
  function changeTargetSpeed(speed: number) {
    const next = { ...targetRef.current, speed };
    targetRef.current = next;
    setTarget(next);
    clearTimeout(targetDebounce.current);
    if (!hasRunRef.current) return;
    targetDebounce.current = setTimeout(() => rerunRef.current(), SETTLE_MS);
  }

  // A run on screen was told about the ground it ran on, so a different ground
  // runs it again, the way an edited preset does, rather than leave a script
  // that read the ground answering for one the viewport no longer draws.
  const lastGround = useRef(groundKey);
  useEffect(() => {
    if (lastGround.current === groundKey) return;
    lastGround.current = groundKey;
    if (!hasRunRef.current) return;
    clearTimeout(rerunTimer.current);
    rerunTimer.current = setTimeout(() => rerunRef.current(), SETTLE_MS);
  }, [groundKey]);

  /** Play one applied preset alone, in the scenario that shows it off. */
  function playSolo(presetId: string, copy?: string | null) {
    const scenarioFor = soloScenario(presetId);
    if (!scenarioFor) return;
    soloRef.current = presetId;
    if (copy !== undefined) soloCopyRef.current = copy;
    setSoloId(presetId);
    setScenarioId(scenarioFor);
    // The script is about to change because of this click, which has started
    // the run itself, so the rerun on a changed script must not start another.
    lastScript.current = scriptNow();
    clearTimeout(rerunTimer.current);
    void start(scenarioFor);
  }

  /** Back to every preset together, in the scenario already chosen. */
  function playAll() {
    soloRef.current = null;
    setSoloId(null);
    lastScript.current = scriptNow();
    clearTimeout(rerunTimer.current);
    if (isCallMode) fireCall(callFunction, callArgsText);
    else void start(scenarioId);
  }

  function apply(presetId: string) {
    onChange([...applied, { presetId, params: {} }]);
  }

  function remove(presetId: string) {
    onChange(applied.filter((entry) => entry.presetId !== presetId));
  }

  function setParam(
    presetId: string,
    param: string,
    next: number,
    copy: string | null,
  ) {
    onChange(
      applied.map((entry) => {
        if (entry.presetId !== presetId) return entry;
        return copy !== null
          ? withInstanceParam(entry, copy, param, next)
          : { ...entry, params: { ...entry.params, [param]: next } };
      }),
    );
  }

  function pickCopy(preset: AnimPreset, copy: string | null) {
    setPicked((now) => {
      const { [preset.id]: _old, ...rest } = now;
      return copy === null ? rest : { ...rest, [preset.id]: copy };
    });
    // A solo run of this preset follows the pick.
    if (solo === preset.id) playSolo(preset.id, copy);
  }

  {
    const scenario = scenarioById(scenarioId);
    const stopped = timeline?.error ?? null;

    const header = (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-3 py-2">
        <Button
          size="sm"
          variant={playing && !scriptPaused ? "default" : "outline"}
          disabled={
            reduceMotion ||
            running ||
            (isCallMode && !callFunction) ||
            (!playsOwnScript && applied.length === 0)
          }
          onClick={() =>
            solo
              ? playAll()
              : playing
                ? onScriptPausedChange(!scriptPaused)
                : isCallMode
                  ? fireCall(callFunction, callArgsText)
                  : void start(scenarioId)
          }
        >
          {playing && !scriptPaused ? <Pause size={14} /> : <Play size={14} />}
          {running
            ? "Running"
            : solo
              ? "Play all"
              : !playing
                ? "Play"
                : scriptPaused
                  ? "Resume"
                  : "Pause"}
        </Button>
        {playing ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={stop}
            title="Stop and return to the built pose"
          >
            <Square size={14} />
          </Button>
        ) : null}
        <span className="min-w-32 flex-1 text-xs text-muted-foreground">
          {reduceMotion
            ? "Playback is off while your system asks for reduced motion."
            : !playsOwnScript && applied.length === 0
              ? "Apply one below."
              : `${PREVIEW_SECONDS} seconds, looped`}
        </span>
      </div>
    );

    const scrubber = playable(timeline) ? (
      <div className="flex flex-col gap-1 border-b border-border px-3 py-2">
        <div className="flex items-start gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={scriptFrame <= 0}
            onClick={() => step(-1)}
            title="Step back one frame"
          >
            <StepBack size={14} />
          </Button>
          <div className="flex flex-1 flex-col gap-1">
            <Slider
              min={0}
              max={Math.max((timeline?.frames.length ?? 1) - 1, 0)}
              step={1}
              value={[scriptFrame]}
              onValueChange={([next]) => {
                onScriptPausedChange(true);
                onScriptFrameChange(next);
              }}
              aria-label="Scrub the script preview"
              // Match the h-8 step buttons so the row can go items-start:
              // with marks underneath, the column is taller than the
              // buttons, and items-center would otherwise centre the
              // buttons 14px below the thumb.
              className="h-8"
            />
            {timeline?.events.some(isMarked) ? (
              <ScrubberMarks
                events={timeline.events}
                frameCount={timeline.frames.length}
                onSeek={(frame) => {
                  onScriptPausedChange(true);
                  onScriptFrameChange(frame);
                }}
              />
            ) : null}
          </div>
          <Button
            size="sm"
            variant="ghost"
            disabled={scriptFrame >= (timeline?.frames.length ?? 1) - 1}
            onClick={() => step(1)}
            title="Step forward one frame"
          >
            <StepForward size={14} />
          </Button>
        </div>
        <span className="text-right text-xs tabular-nums text-muted-foreground">
          {scriptFrame + 1}/{timeline?.frames.length}
        </span>
      </div>
    ) : null;

    const problems = (
      <>
        {failure ? (
          <div className="flex flex-col gap-1 text-xs text-destructive">
            {playsOwnScript ? (
              <p>The script could not be run: {failure}</p>
            ) : (
              <>
                <p>The animation could not be run: {failure}</p>
                <p>
                  coilbox writes this script from the presets and the roles on
                  your pieces, so it should always run. Check the presets you
                  have applied and the roles you have given, and if they look
                  right, report this as a bug in coilbox.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="self-start"
                  onClick={onShowScript}
                >
                  <FileCode size={14} /> Open the Script tab
                </Button>
              </>
            )}
          </div>
        ) : null}

        {stopped ? (
          <div className="flex flex-col gap-1 rounded-md border border-destructive/50 px-2 py-2">
            <span className="text-xs font-medium text-destructive">
              The script stopped
            </span>
            <p className="text-xs text-destructive">{stopped}</p>
            <p className="text-xs text-muted-foreground">
              {timeline && timeline.frames.length > 0
                ? `Playing the ${(timeline.frames.length / timeline.fps).toFixed(1)} seconds it managed first.`
                : "It got no further than that, so there is nothing to play."}
            </p>
          </div>
        ) : null}
      </>
    );

    const body = (
      <>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">What happens to the unit</span>
          <Select
            value={scenarioId}
            onValueChange={(next) => {
              setScenarioId(next);
              if (next === CALL_FUNCTION) {
                // A function to call has to come from somewhere, and the
                // idle scenario is the cheapest run that learns it.
                if (!timeline || timeline.functions.length === 0) {
                  void runEvents(scenarioById("idle")?.events ?? [], values);
                }
                return;
              }
              if (playing || timeline) void start(next);
            }}
          >
            <SelectTrigger
              size="sm"
              className="w-full"
              aria-label="What happens to the unit"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SCENARIOS.map((option) => (
                <SelectItem
                  key={option.id}
                  value={option.id}
                  trailing={
                    marks.has(option.id) ? (
                      <span className="text-xs text-muted-foreground">
                        Nothing to do
                      </span>
                    ) : undefined
                  }
                >
                  {option.label}
                </SelectItem>
              ))}
              <SelectItem value={CALL_FUNCTION}>Call a function</SelectItem>
            </SelectContent>
          </Select>
          {isCallMode ? (
            <>
              <Select
                value={callFunction}
                onValueChange={(name) => {
                  setCallFunction(name);
                  fireCall(name, callArgsText);
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full"
                  aria-label="Function to call"
                >
                  <SelectValue placeholder="Choose a function" />
                </SelectTrigger>
                <SelectContent>
                  {(timeline?.functions ?? []).map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={callArgsText}
                aria-label="Arguments"
                placeholder="0.8, 0.15"
                onChange={(e) => onArgsTextChange(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Numbers, comma separated. Call-ins that aim take radians, as the
                engine hands them.
              </p>
              {callArgsError ? (
                <p className="text-xs text-destructive">{callArgsError}</p>
              ) : null}
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {scenario?.description}
              </p>
              {marks.has(scenarioId) ? (
                <p className="text-xs text-muted-foreground">
                  {marks.get(scenarioId)}
                </p>
              ) : null}
              {scenario?.movingTarget ? (
                <div className="flex flex-col gap-1.5">
                  <OptionSelect
                    size="sm"
                    ariaLabel="How the target moves"
                    value={target.path}
                    options={TARGET_PATHS}
                    onValueChange={(path) =>
                      retargetRef.current({
                        ...targetRef.current,
                        path: path as TargetPath,
                      })
                    }
                  />
                  <div className="flex items-center justify-between text-xs">
                    <span>Target speed</span>
                    <span className="text-muted-foreground">
                      {target.speed === 0
                        ? "Still"
                        : `${target.speed}× the unit's`}
                    </span>
                  </div>
                  <Slider
                    min={0}
                    max={4}
                    step={0.25}
                    value={[target.speed]}
                    onValueChange={([next]) => changeTargetSpeed(next)}
                    aria-label="Target speed"
                  />
                </div>
              ) : null}
              {scenario?.drive ? (
                <div className="flex flex-col gap-1.5">
                  <OptionSelect
                    size="sm"
                    ariaLabel="Path to drive"
                    value={drive.path}
                    options={DRIVE_PATHS}
                    onValueChange={(path) =>
                      changeDrive({
                        ...driveRef.current,
                        path: path as DrivePath,
                      })
                    }
                  />
                  {drive.path === "own" ? (
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {drive.own.length === 0
                          ? "Click the ground to add points."
                          : `${drive.own.length} ${drive.own.length === 1 ? "point" : "points"}`}
                      </span>
                      {drive.own.length > 0 ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-5 px-1.5 text-xs"
                          onClick={() =>
                            changeDrive({ ...driveRef.current, own: [] })
                          }
                        >
                          Clear
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    {driveSourceText(driveMotion(project))}
                  </p>
                  {compiled ? null : (
                    <OptionSelect
                      size="sm"
                      ariaLabel="When ChangeHeading is sent"
                      value={drive.everyTurn ? "every" : "engine"}
                      options={CHANGE_HEADING_OPTIONS}
                      onValueChange={(value) =>
                        changeDrive({
                          ...driveRef.current,
                          everyTurn: value === "every",
                        })
                      }
                    />
                  )}
                </div>
              ) : null}
            </>
          )}
        </div>

        {timeline && timeline.asked.length > 0 ? (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium">Unit values</span>
            <p className="text-xs text-muted-foreground">
              What the script reads about its unit. Change one and the preview
              runs again with it.
            </p>
            {timeline.asked
              .filter(
                (asked) => !(scenario?.drive && DRIVEN_VALUES.has(asked.id)),
              )
              .map((asked) => {
                const control = controlFor(asked.id, asked.name);
                const changed = values[asked.id] !== undefined;
                const raw = values[asked.id] ?? asked.default ?? 0;
                return (
                  <div key={asked.id} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-xs">
                      <span>{control.label}</span>
                      <div className="flex items-center gap-2">
                        {control.kind === "slider" ? (
                          <span className="text-muted-foreground">
                            {control.toDisplay(raw)}
                            {control.suffix}
                          </span>
                        ) : null}
                        {changed ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-5 px-1.5 text-xs"
                            onClick={() => changeValue(asked.id, undefined)}
                          >
                            Reset
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    {control.kind === "switch" ? (
                      <Switch
                        checked={raw !== 0}
                        onCheckedChange={(on) =>
                          changeValue(asked.id, on ? 1 : 0)
                        }
                        aria-label={control.label}
                      />
                    ) : null}
                    {control.kind === "slider" ? (
                      <Slider
                        min={control.min}
                        max={control.max}
                        step={control.step}
                        value={[control.toDisplay(raw)]}
                        onValueChange={([next]) =>
                          changeValue(asked.id, control.toRaw(next))
                        }
                        aria-label={control.label}
                      />
                    ) : null}
                    {control.kind === "select" ? (
                      <Select
                        value={String(raw)}
                        onValueChange={(next) =>
                          changeValue(asked.id, Number(next))
                        }
                      >
                        <SelectTrigger
                          size="sm"
                          className="w-full"
                          aria-label={control.label}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {control.options.map((option) => (
                            <SelectItem
                              key={option.value}
                              value={String(option.value)}
                            >
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : null}
                    {control.kind === "number" ? (
                      <Input
                        type="number"
                        value={raw}
                        aria-label={control.label}
                        onChange={(e) => {
                          const next = Number(e.target.value);
                          if (!Number.isNaN(next)) changeValue(asked.id, next);
                        }}
                      />
                    ) : null}
                  </div>
                );
              })}
          </div>
        ) : null}

        {playsOwnScript ? problems : null}

        {timeline?.warnings.map((warning) => (
          <p key={warning} className="text-xs text-muted-foreground">
            {warning}
          </p>
        ))}

        {standInNotes.map((note) => (
          <p key={note} className="text-xs text-muted-foreground">
            {note}
          </p>
        ))}

        {effectsNote &&
        timeline?.events.some(
          (event) =>
            event.kind === "flare" ||
            event.kind === "shot" ||
            event.kind === "sfx",
        ) ? (
          <p className="text-xs text-muted-foreground">{effectsNote}</p>
        ) : null}

        {compiled ? (
          <p className="text-xs text-muted-foreground">
            This unit's game animates it with{" "}
            <code className="break-all">{compiled.member}</code>, which is
            compiled rather than Lua. Coilbox runs it, so what you see is what
            the game plays. It cannot be edited here and an export does not
            write it.
          </p>
        ) : playsOwnScript ? (
          <p className="text-xs text-muted-foreground">
            This unit has its own script, so the presets no longer write it.
            Edit it on the Script tab.
          </p>
        ) : null}
      </>
    );

    if (playsOwnScript) {
      return (
        <div className="flex min-h-0 flex-1 flex-col">
          {header}
          {scrubber}
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3">
            {body}
          </div>
        </div>
      );
    }

    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {header}
        {scrubber}

        <div className="min-h-0 flex-1 overflow-y-auto">
          <Collapsible defaultOpen className="border-b border-border/60">
            <CollapsibleTrigger className="group flex w-full items-center gap-1 px-3 py-2 text-left text-sm font-medium">
              <ChevronRight
                size={14}
                className="transition-transform group-data-[state=open]:rotate-90"
              />
              Preview
            </CollapsibleTrigger>
            <CollapsibleContent className="flex flex-col gap-3 px-3 pb-3">
              {body}
            </CollapsibleContent>
          </Collapsible>
          {failure || timeline?.error ? (
            <div className="flex flex-col gap-3 border-b border-border/60 px-3 py-2">
              {problems}
            </div>
          ) : null}
          {/* Above the presets, because it is what makes them mean anything: a
            unit with a build arm and no builder keys animates a job it can
            never be given. Only for a unit that has one, since the roles are
            what say this unit builds. */}
          {isBuilder(project) ? (
            <div className="border-b border-border/60 px-3 py-2">
              <p className="text-sm font-medium">What it builds with</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                This unit has a build arm, so its definition is written as a
                builder. All three go together: the engine reads a builder with
                no work rate as not a builder at all.
              </p>
              <BuilderReport project={project} />

              {BUILDER_FIELDS.map((field) => (
                <div key={field.id} className="mt-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5">
                      {field.label}
                      <ProjectWorkshopMarks
                        project={project}
                        paths={[field.id]}
                      />
                    </span>
                    <span className="text-muted-foreground">
                      {project.builder?.[field.id] ?? DEFAULT_BUILDER[field.id]}
                      {field.suffix}
                    </span>
                  </div>
                  <Slider
                    className="mt-1"
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    value={[
                      project.builder?.[field.id] ?? DEFAULT_BUILDER[field.id],
                    ]}
                    onValueChange={([next]) =>
                      onBuilderChange({ ...project.builder, [field.id]: next })
                    }
                    aria-label={field.label}
                  />
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {field.note}
                  </p>
                </div>
              ))}

              {movesInGame(project.movement) ? null : (
                <div className="mt-3 flex items-center justify-between gap-3">
                  <Label
                    htmlFor="builder-factory"
                    className="text-xs font-medium"
                  >
                    Factory
                  </Label>
                  <Switch
                    id="builder-factory"
                    checked={project.builder?.factory ?? false}
                    onCheckedChange={(on) =>
                      onBuilderChange({ ...project.builder, factory: on })
                    }
                  />
                </div>
              )}

              <div className="mt-3 flex items-center justify-between gap-3">
                <Label htmlFor="builder-assist" className="text-xs font-medium">
                  Can help another unit's build
                </Label>
                <Switch
                  id="builder-assist"
                  checked={
                    project.builder?.canAssist ?? DEFAULT_BUILDER.canAssist
                  }
                  onCheckedChange={(on) =>
                    onBuilderChange({ ...project.builder, canAssist: on })
                  }
                />
              </div>
            </div>
          ) : null}

          <MovementSection
            project={project}
            bounds={bounds}
            onMovementChange={onMovementChange}
          />

          <WorthSection
            project={project}
            pack={pack}
            onWorthChange={onWorthChange}
          />

          {onWeaponChange ? (
            <WeaponsSection project={project} onWeaponChange={onWeaponChange} />
          ) : null}

          <StatsSection
            project={project}
            pack={pack}
            bounds={bounds}
            reference={referenceUnit ?? null}
          />

          <GameFitSection project={project} bounds={bounds} />

          {PRESETS.map((preset) => {
            const entry = applied.find((a) => a.presetId === preset.id);
            const missing = unmetRequirements(preset, counts);
            const copies = entry ? presetCopies(project, preset) : 1;
            const copyIds = entry ? presetInstanceIds(project, preset) : [];
            const copy = copyOf(preset);

            return (
              <div
                key={preset.id}
                className="border-b border-border/60 px-3 py-2"
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {preset.label}
                      {copies > 1 && preset.copies
                        ? `, ${copies} ${preset.copies.noun}`
                        : ""}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {preset.description}
                    </p>
                  </div>
                  {entry && !playsOwnScript ? (
                    <Button
                      size="sm"
                      variant={
                        solo === preset.id && playing ? "default" : "outline"
                      }
                      disabled={reduceMotion || running}
                      aria-pressed={solo === preset.id && playing}
                      aria-label={`Preview ${preset.label} on its own`}
                      title="Play this preset on its own, without changing the unit"
                      onClick={() => playSolo(preset.id)}
                    >
                      <Play size={14} />
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant={entry ? "outline" : "default"}
                    disabled={!entry && missing.length > 0}
                    onClick={() =>
                      entry ? remove(preset.id) : apply(preset.id)
                    }
                  >
                    {entry ? "Remove" : "Apply"}
                  </Button>
                </div>

                {!entry && missing.length > 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Needs a piece set as{" "}
                    {missing.map((role) => roleLabel(role)).join(", ")}.
                  </p>
                ) : null}

                {entry && SOLO_MOVES_NOTHING[preset.id] ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {SOLO_MOVES_NOTHING[preset.id]}
                  </p>
                ) : null}

                {entry && copyIds.length > 1 ? (
                  <div className="mt-2 flex items-center gap-2">
                    <OptionSelect
                      size="sm"
                      ariaLabel={`${preset.label}: copy`}
                      value={copy === null ? ALL_COPIES : COPY_PREFIX + copy}
                      options={[
                        { value: ALL_COPIES, label: "All copies" },
                        ...copyIds.map((id, index) => ({
                          value: COPY_PREFIX + id,
                          label: entry.instances?.[id]
                            ? `Copy ${index + 1}, own settings`
                            : `Copy ${index + 1}`,
                        })),
                      ]}
                      onValueChange={(next) =>
                        pickCopy(
                          preset,
                          next === ALL_COPIES
                            ? null
                            : next.slice(COPY_PREFIX.length),
                        )
                      }
                    />
                    {copy !== null && entry.instances?.[copy] ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 shrink-0 px-2 text-xs"
                        onClick={() =>
                          onChange(
                            applied.map((a) =>
                              a.presetId === preset.id
                                ? withoutInstanceSettings(a, copy)
                                : a,
                            ),
                          )
                        }
                      >
                        Use shared
                      </Button>
                    ) : null}
                  </div>
                ) : null}

                {entry && overridesFit(project, entry, copy) ? (
                  <div className="mt-2 flex justify-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() =>
                        onChange(
                          applied.map((a) =>
                            a.presetId === preset.id
                              ? withoutFitOverrides(a, copy)
                              : a,
                          ),
                        )
                      }
                    >
                      Fit to body
                    </Button>
                  </div>
                ) : null}

                {entry
                  ? preset.params.map((param) => {
                      // A walk fitted to the unit shows the numbers it is
                      // written with, not the slider's default.
                      const shown =
                        shownParams(project, entry, copy)[param.id] ??
                        paramFor(entry, copy, param.id);
                      return (
                        <div key={param.id} className="mt-2">
                          <div className="flex items-center justify-between text-xs">
                            <span>{param.label}</span>
                            <span className="text-muted-foreground">
                              {Number(shown.toFixed(2))}
                              {PARAM_SUFFIX[param.unit]}
                            </span>
                          </div>
                          <Slider
                            className="mt-1"
                            min={param.min}
                            max={param.max}
                            step={param.step}
                            value={[shown]}
                            onValueChange={([next]) =>
                              setParam(preset.id, param.id, next, copy)
                            }
                            aria-label={`${preset.label}: ${param.label}`}
                          />
                        </div>
                      );
                    })
                  : null}
              </div>
            );
          })}

          {applied.some((entry) => !presetById(entry.presetId)) ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              This unit also has an animation this build does not know. It is
              left alone rather than dropped.
            </p>
          ) : null}
        </div>
      </div>
    );
  }
}
