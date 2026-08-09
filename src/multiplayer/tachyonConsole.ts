/**
 * Reading one console entry on a Tachyon connection.
 *
 * The console log holds one string per frame, carrying the direction as the same
 * `>>` and `<<` prefix the TASServer view shows (see `mirrorReducer`). A Tachyon
 * frame is JSON, so the drawer wants the envelope fields a reader scans for, plus
 * the frame laid out over several lines rather than one long one.
 *
 * The decisions live here rather than in the component because the frontend suite
 * runs with no renderer (issue #1252), so this is the part that can be tested.
 */

import type { LobbyProtocol } from "../lobby-servers/config";

/**
 * Which of the two log views a connection calls for.
 *
 * `lines` is the wire log the drawer has always shown, and it stays exactly that
 * for a TASServer connection. `frames` is the JSON view. A connection whose
 * protocol we cannot read is a TASServer one, which is what `protocolForKey`
 * already decides, so this never has to guess.
 */
export function consoleView(protocol: LobbyProtocol): "frames" | "lines" {
  return protocol === "tachyon" ? "frames" : "lines";
}

/**
 * How much of one frame the drawer lays out.
 *
 * A lobby list on a busy server runs to tens of thousands of characters, and
 * laying that out puts a line on screen for every field in it. Past this the frame
 * is cut short, which keeps the drawer usable and still shows the start of the
 * payload, which is the part a reader is looking at.
 */
export const MAX_FRAME_CHARS = 20000;

/** One line of the console log, read as a Tachyon frame. */
export interface TachyonConsoleEntry {
  /** `out` for a frame we sent, `in` for one we received. */
  direction: "in" | "out";
  /** `request`, `response` or `event`. Null when the entry is not a JSON frame. */
  type: string | null;
  /** The command the frame belongs to, such as `lobby/join`. */
  commandId: string | null;
  /** `success` or `failed`, which only a response carries. */
  status: string | null;
  /** Why a failed response failed, in the machine-readable form. */
  reason: string | null;
  /** The free text a server may add alongside `reason`, for a human. */
  details: string | null;
  /**
   * The frame over several lines, or the entry as it stands when it is not JSON.
   * Cut short at `MAX_FRAME_CHARS`.
   */
  body: string;
  /** Whether `body` was cut short. */
  truncated: boolean;
  /**
   * Whether the entry parsed as JSON. The connection task also writes plain notes
   * to the console, such as a TASServer line it could not carry, and those are
   * shown as they stand rather than as a frame.
   */
  json: boolean;
}

/** The direction prefixes `mirrorReducer` puts on every console line. */
const SENT = ">> ";
const RECEIVED = "<< ";

/** A field of the envelope, when the frame carries it as a string. */
function textField(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Hold a body to `MAX_FRAME_CHARS`, saying whether anything was dropped. */
function cut(body: string): { body: string; truncated: boolean } {
  if (body.length <= MAX_FRAME_CHARS) return { body, truncated: false };
  return { body: body.slice(0, MAX_FRAME_CHARS), truncated: true };
}

/**
 * Read one console line as a Tachyon frame.
 *
 * Never throws. Anything that is not JSON, which covers a note from the
 * connection task and a frame the server truncated, comes back as the text it is
 * with `json` false, because a debug console that hid what it could not parse
 * would hide the thing being debugged.
 */
export function parseTachyonEntry(line: string): TachyonConsoleEntry {
  const direction = line.startsWith(SENT) ? "out" : "in";
  const text =
    line.startsWith(SENT) || line.startsWith(RECEIVED) ? line.slice(3) : line;

  let frame: unknown;
  try {
    frame = JSON.parse(text);
  } catch {
    return {
      direction,
      type: null,
      commandId: null,
      status: null,
      reason: null,
      details: null,
      ...cut(text),
      json: false,
    };
  }

  // A frame that parsed but is not an object, such as a bare number, has no
  // envelope. It still gets shown, with every field empty.
  const fields =
    typeof frame === "object" && frame !== null && !Array.isArray(frame)
      ? (frame as Record<string, unknown>)
      : {};

  return {
    direction,
    type: textField(fields.type),
    commandId: textField(fields.commandId),
    status: textField(fields.status),
    reason: textField(fields.reason),
    details: textField(fields.details),
    ...cut(JSON.stringify(frame, null, 2)),
    json: true,
  };
}
