/**
 * What the Timeline tab draws for one action: a row for each piece it moves,
 * and under it a row for each channel with a track, each with the frames it has
 * keys on.
 *
 * Positions on the tab's ruler are the frames of the baked preview
 * (`bakeAction`), which is the action's own frame plus the frames a blend in
 * takes before the first key. With no blend in the two are the same.
 */

import { t } from "@lingui/core/macro";
import {
  actionClashes,
  actionTracks,
  FPS,
  planAction,
  sharedOutcome,
} from "./actions";
import type { LegoAction, LegoPiece, LegoProject } from "./model";

/** A key on the ruler: where it is and the value it holds, in radians for a
 *  turn and elmos for a move. */
export interface TimelineKey {
  frame: number;
  value: number;
}

/** One piece's turn or move on one axis, as a track. */
export interface TimelineChannel {
  kind: "turn" | "move";
  axis: 0 | 1 | 2;
  /** "Turn x", the way the rows and the key buttons call it. */
  label: string;
  keys: TimelineKey[];
}

export interface TimelineRow {
  piece: LegoPiece;
  /** The frames any channel of the piece has a key on, ascending. */
  frames: number[];
  channels: TimelineChannel[];
  /** Where a looping action's channels arrive back at their first keys after
   *  the end of the lap. Empty for an action that does not loop. */
  wraps: number[];
  /** What else moves the piece and who wins, or null when nothing does. */
  clash: string | null;
}

export interface TimelineView {
  rows: TimelineRow[];
  /** The last position on the ruler: one second past the last key, or past
   *  where the last channel wraps back to its first key. */
  end: number;
  /** The position of the last key, which is where a lap ends. */
  lastKey: number;
  /** Frames in one lap, or 0 when the action does not loop. */
  lap: number;
}

/** A second of frames past the last key, so a key can go later. */
const RULER_SLACK = FPS;

/** What a channel is called, like "Turn x". */
export function channelLabel(kind: "turn" | "move", axis: 0 | 1 | 2): string {
  if (kind === "turn") {
    return [t`Turn x`, t`Turn y`, t`Turn z`][axis];
  }
  return [t`Move x`, t`Move y`, t`Move z`][axis];
}

/** What a key on a piece's row is called, for its button. Frames count from
 *  0, the action's first instant, as the readout does. */
export function pieceKeyName(row: TimelineRow, frame: number): string {
  const piece = row.piece.name;
  return t`Keys of ${piece} on frame ${frame}`;
}

/** What a key on a channel's row is called: the channel and piece, the frame,
 *  and the value in degrees for a turn or elmos for a move. */
export function channelKeyName(
  row: TimelineRow,
  channel: TimelineChannel,
  key: TimelineKey,
): string {
  const piece = row.piece.name;
  const label = channel.label;
  const frame = key.frame;
  if (channel.kind === "turn") {
    const degrees = Math.round(((key.value * 180) / Math.PI) * 10) / 10;
    return t`${label} of ${piece}, frame ${frame}, ${degrees} degrees`;
  }
  const elmos = Math.round(key.value * 100) / 100;
  return t`${label} of ${piece}, frame ${frame}, ${elmos} elmos`;
}

/** The action's tracks as the plan will play them: its own, or its pose keys
 *  lowered, for the pieces the unit still has. */
function liveTracks(action: LegoAction, project: LegoProject) {
  const own = project.pieces.map((piece) => piece.id);
  return (action.tracks ?? actionTracks(action, project)).filter(
    (track) => own.includes(track.piece) && track.keys.length > 0,
  );
}

/**
 * The rows of the timeline for an action. Pose key actions show through
 * `actionTracks`, so every action appears without being changed.
 */
export function timelineView(
  action: LegoAction,
  project: LegoProject,
): TimelineView {
  const tracks = liveTracks(action, project);
  if (tracks.length === 0) {
    return { rows: [], end: RULER_SLACK, lastKey: 0, lap: 0 };
  }

  const length = Math.max(
    ...tracks.flatMap((track) => track.keys.map((key) => key.frame)),
  );
  const plan = planAction(action, project);
  // A blend in goes before the first key, and everything after it moves later.
  const shift = plan ? plan.leadFrames - length : 0;
  const looping = plan?.looping ?? false;
  const lastKey = length + shift;

  const clashes = actionClashes(project).filter(
    (clash) => clash.action.id === action.id,
  );

  const rows: TimelineRow[] = [];
  for (const piece of project.pieces) {
    const own = tracks.filter((track) => track.piece === piece.id);
    if (own.length === 0) continue;
    const channels: TimelineChannel[] = own.map((track) => ({
      kind: track.kind,
      axis: track.axis,
      label: channelLabel(track.kind, track.axis),
      keys: track.keys.map((key) => ({
        frame: key.frame + shift,
        value: key.value,
      })),
    }));
    const frames = [
      ...new Set(channels.flatMap((c) => c.keys.map((key) => key.frame))),
    ].sort((a, b) => a - b);
    const wraps = looping
      ? [...new Set(channels.map((c) => lastKey + c.keys[0].frame - shift))]
      : [];
    const names = [
      ...new Set(
        clashes
          .filter((clash) => clash.piece.id === piece.id)
          .map((clash) => clash.with),
      ),
    ];
    const list = names.join(", ");
    rows.push({
      piece,
      frames,
      channels,
      wraps: wraps.sort((a, b) => a - b),
      clash:
        names.length > 0
          ? `${t`Also moved by ${list}.`} ${sharedOutcome(project)}`
          : null,
    });
  }

  const wrapEnd = Math.max(0, ...rows.flatMap((row) => row.wraps));
  return {
    rows,
    end: Math.max(lastKey + RULER_SLACK, wrapEnd),
    lastKey,
    lap: looping ? length : 0,
  };
}

/**
 * Where the playhead is on the ruler for a frame of the baked preview. A
 * looping action's preview goes on for one lap past the ruler, and a frame
 * there is shown one lap earlier, where the motion is the same.
 */
export function rulerFrame(view: TimelineView, frame: number): number {
  if (view.lap <= 0) return Math.min(frame, view.end);
  let at = frame;
  while (at > view.end) at -= view.lap;
  return Math.max(at, 0);
}

/** How many keys an action shows: its distinct key frames when it has tracks,
 *  or its pose keys. */
export function actionKeyCount(action: LegoAction): number {
  if (!action.tracks) return action.keys.length;
  return new Set(
    action.tracks.flatMap((track) => track.keys.map((key) => key.frame)),
  ).size;
}
