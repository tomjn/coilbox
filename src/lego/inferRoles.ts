/**
 * Work out what a game unit's pieces are for, by asking its own script.
 *
 * A unit imported from a game arrives as geometry with names on it. The names
 * are a modeller's, so `arm_flare` on one game is `muzzle` on the next, and
 * nothing in a model says which piece is the turret. The script does, because
 * it is the thing that turns the turret.
 *
 * Two kinds of answer, kept apart everywhere because they differ in kind.
 *
 * Stated: the script returns the piece. `QueryNanoPiece` answering `nano2` is
 * the script naming that piece's job. Nothing is inferred and nothing is
 * guessed, so these are worth trusting as far as the script is worth trusting.
 *
 * Observed: the script moves the piece and we read the motion. A piece that
 * turns on y when the unit is told to aim is a turret in every game anyone has
 * shipped, but it is still a reading of behaviour rather than a declaration,
 * and it can be wrong on a unit built oddly.
 *
 * Nothing here writes to a document. It reports what it found with the call-in
 * it came from, and the user decides. That is deliberate: a role set wrongly
 * animates a unit inside out, and a wrong role is worse than none.
 */

import { legoProbeScript, legoRunScript } from "./bindings";
import type { LegoProject } from "./model";
import { pieceRest } from "./pieceRest";
import { CREATED, PREVIEW_FRAMES, type ScriptEvent } from "./scriptPlayback";

/** Where a proposal came from, which is also how far to trust it. */
export type RoleEvidence = "stated" | "observed";

export interface RoleProposal {
  pieceName: string;
  role: string;
  evidence: RoleEvidence;
  /** The call-in it came from, shown to the user as the reason. */
  callin: string;
}

export interface RoleFindings {
  proposals: RoleProposal[];
  /** What the runs wanted to say: a call-in the script does not define, a call
   *  the sandbox does not model. Not failures, and worth showing. */
  notes: string[];
  /** Set when the script could not be run at all, in which case there are no
   *  proposals to weigh. */
  error: string | null;
}

/**
 * The call-ins that answer with a piece, and the role that answer means.
 *
 * All three take no arguments, and none of them is thread-wrapped in the unit
 * script framework, so all three have to answer immediately. That is what makes
 * them safe to call directly rather than drive over frames.
 */
const STATED: { callin: string; role: string }[] = [
  { callin: "QueryNanoPiece", role: "buildarm.nano" },
  { callin: "AimFromWeapon1", role: "aim" },
  { callin: "QueryWeapon1", role: "flare" },
];

/**
 * How far a piece has to move before the motion counts as deliberate.
 *
 * Radians for a turn, elmos for a slide. Well above the dust a script's own
 * arithmetic leaves behind and well below anything a script means by moving
 * something.
 */
const MOVED_ROTATION = 0.02;

/** Frames to run each observation for. Long enough for a turn at a sane speed
 *  to be visible, short enough that four of them are not a wait. */
const OBSERVE_FRAMES = 45;

/**
 * What to drive, and what each piece's motion means when it happens.
 *
 * Read as: fire these events, then any piece whose rotation about `axis`
 * changed is doing `role`. The order inside one entry matters where two roles
 * share a driver, since a piece is proposed for the first role it matches:
 * `AimWeapon1` turns the turret on y and the barrel on x, and a piece doing
 * both is the turret.
 */
const OBSERVED: {
  callin: string;
  args: number[];
  /** Axis index into the pose's rotation triple: 0 is x, 1 is y, 2 is z. */
  roles: { axis: 0 | 1 | 2; role: string }[];
}[] = [
  {
    callin: "AimWeapon1",
    // Radians, and both well past `MOVED_ROTATION` so a turret that tracks at
    // any sane speed has visibly moved inside the window.
    args: [0.9, 0.35],
    roles: [
      { axis: 1, role: "turret" },
      { axis: 0, role: "barrel" },
    ],
  },
  {
    callin: "StartBuilding",
    args: [0.9, 0.35],
    roles: [
      { axis: 1, role: "buildarm.base" },
      { axis: 0, role: "buildarm.arm" },
    ],
  },
  {
    callin: "StartMoving",
    args: [],
    // A wheel is the one thing that turns about its own axle on being told to
    // move. Legs turn too, and are deliberately not here: which of six moving
    // pieces is the front left shin is not something motion can say, and the
    // walk presets animate a unit inside out if it is guessed wrong.
    roles: [{ axis: 0, role: "wheel" }],
  },
];

/**
 * Ask a script what its pieces are for.
 *
 * One probe call for everything stated, then one run per observation. The runs
 * are separate because a unit told to aim and to move at once is a unit whose
 * motion cannot be attributed to either.
 */
export async function inferRoles(
  project: LegoProject,
  script: string,
): Promise<RoleFindings> {
  const pieces = project.pieces.map((piece) => piece.name);
  const proposals: RoleProposal[] = [];
  const notes: string[] = [];

  const probes = await legoProbeScript({
    script,
    unitName: project.unitName,
    pieces,
    callins: STATED.map((entry) => entry.callin),
    unitDef: project.gameUnitDef ?? null,
    includes: project.gameScriptIncludes ?? null,
    rest: pieceRest(project),
  });
  if (probes.error) return { proposals: [], notes: [], error: probes.error };

  for (const { callin, role } of STATED) {
    const probe = probes.probes.find((entry) => entry.callin === callin);
    if (!probe) continue;
    // A note about a call-in the script simply does not have is not worth
    // repeating back: most units have most of these missing.
    if (probe.note && probe.pieces.length > 0) notes.push(probe.note);
    for (const pieceName of new Set(probe.pieces)) {
      proposals.push({ pieceName, role, evidence: "stated", callin });
    }
  }

  for (const driver of OBSERVED) {
    // The same opening every scenario uses, because a unit that has not been
    // told what it is standing on animates nothing and there is nothing to
    // read off it (#1940).
    const events: ScriptEvent[] = [
      ...CREATED,
      { frame: 1, callin: driver.callin, args: driver.args },
    ];
    const timeline = await legoRunScript({
      script,
      unitName: project.unitName,
      pieces,
      events,
      frames: Math.min(OBSERVE_FRAMES, PREVIEW_FRAMES),
      unitDef: project.gameUnitDef ?? null,
      includes: project.gameScriptIncludes ?? null,
      rest: pieceRest(project),
    });
    notes.push(...timeline.warnings);
    // A run that broke still says something with the frames it managed, so its
    // motion is read rather than thrown away. The reason goes in the notes.
    if (timeline.error) notes.push(timeline.error);

    for (const { pieceName, axis } of turnedPieces(timeline)) {
      const match = driver.roles.find((entry) => entry.axis === axis);
      if (!match) continue;
      proposals.push({
        pieceName,
        role: match.role,
        evidence: "observed",
        callin: driver.callin,
      });
    }
  }

  return {
    proposals: dedupe(proposals),
    notes: [...new Set(notes)],
    error: null,
  };
}

/**
 * Which pieces turned, and about which axis, between the first frame and the
 * last one a run produced.
 *
 * First against last rather than frame by frame: a turn started on frame one
 * and still running on frame forty has moved, and sampling the difference is
 * both cheaper and less sensitive to where in the motion the window closes. A
 * piece that turned and came back is missed, which no driver here asks for.
 *
 * A piece is reported once per axis, so a turret that turns on y and a barrel
 * that turns on x each match their own role, and a piece doing both is offered
 * for whichever role its driver lists first.
 */
function turnedPieces(timeline: {
  pieces: string[];
  frames: number[][];
}): { pieceName: string; axis: 0 | 1 | 2 }[] {
  const first = timeline.frames[0];
  const last = timeline.frames.at(-1);
  if (!first || !last || first === last) return [];

  const out: { pieceName: string; axis: 0 | 1 | 2 }[] = [];
  timeline.pieces.forEach((pieceName, index) => {
    for (const axis of [0, 1, 2] as const) {
      // Six numbers per piece: three offsets then three rotations.
      const at = index * 6 + 3 + axis;
      if (Math.abs((last[at] ?? 0) - (first[at] ?? 0)) >= MOVED_ROTATION) {
        out.push({ pieceName, axis });
      }
    }
  });
  return out;
}

/**
 * One proposal per piece, keeping the strongest.
 *
 * A piece can match more than one thing: a build arm that also turns when told
 * to aim, a nano point on the nozzle. Stated beats observed, because the script
 * saying what a piece is for beats us watching it move, and among two of the
 * same kind the first driver wins, which is the order `OBSERVED` lists them in.
 */
function dedupe(proposals: RoleProposal[]): RoleProposal[] {
  const best = new Map<string, RoleProposal>();
  for (const proposal of proposals) {
    const held = best.get(proposal.pieceName);
    if (!held) {
      best.set(proposal.pieceName, proposal);
      continue;
    }
    if (held.evidence === "observed" && proposal.evidence === "stated") {
      best.set(proposal.pieceName, proposal);
    }
  }
  return [...best.values()];
}
