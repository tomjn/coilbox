import { useSetting } from "@picoframe/frame";
import { useEffect, useRef } from "react";
import type { OaEvent } from "../play/bindings";

/**
 * The facts of Open Annihilation (OA) matches that have finished (issue #4948),
 * kept for a later history or ladder feature to read.
 *
 * Coilbox's other finished-match facts, the Player stats and Career pages, are
 * read from replays, and an OA match leaves none: its recordings are `.tad`
 * files coilbox does not read. So these live in a setting, `OA_MATCHES_KEY`,
 * which is the one place to read them back from: `useOaMatches` in a component,
 * or the setting itself anywhere else.
 *
 * `oaRun` records a match the moment OA's `game_over` line arrives, whatever
 * page is showing and even if the run is cancelled straight after. A setting can
 * only be written from a mounted component, so a record made while none is
 * attached waits here, and `useKeepOaMatches` (mounted for the whole session by
 * the multiplayer provider) writes it as soon as one is.
 *
 * The list is not trimmed. Each record is one match, and any limit would be a
 * guess at how much history a feature wants.
 */
export const OA_MATCHES_KEY = "multiplayer.oaMatches";

/** One player's line of a `game_over`'s `results`. */
export interface OaPlayerResult {
  slot: number | null;
  name: string | null;
  team: number | null;
  side: string | null;
  /** As OA sent it: `won`, `lost`, `drawn`, `left` or `watcher`, or anything it adds. */
  outcome: string | null;
  units: number | null;
  kills: number | null;
  losses: number | null;
  /** Any other field on the player's line, as OA sent it. */
  extra: Record<string, unknown>;
}

/** A finished OA match, as this client saw it end. */
export interface OaMatchRecord {
  /** Unique to the match on this machine. */
  id: string;
  /** When this client received the `game_over`, as an ISO 8601 time. */
  finishedAt: string;
  /** The battle the run was started for. */
  serverKey: string;
  battleId: number;
  /** The version OA's `hello` line gave, or null if it never said hello. */
  version: string | null;
  /** The match's `outcome`, `victory` or `defeat`, or null if the line lacked it. */
  outcome: string | null;
  /** The match's `winner`, or null if the line lacked it. */
  winner: number | string | null;
  /** The game's frame count at the end, or null if the line lacked it. */
  frame: number | null;
  /** One entry per player. */
  results: OaPlayerResult[];
  /** Any other field on the `game_over` line, as OA sent it. */
  extra: Record<string, unknown>;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Everything on `line` except the keys the record gives their own field. */
function without(
  line: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(line)) {
    if (!keys.includes(k)) rest[k] = v;
  }
  return rest;
}

/** One entry of `results`. Anything that is not an object is dropped. */
export function parseOaPlayerResult(raw: unknown): OaPlayerResult | null {
  if (!isObject(raw)) return null;
  return {
    slot: num(raw.slot),
    name: str(raw.name),
    team: num(raw.team),
    side: str(raw.side),
    outcome: str(raw.outcome),
    units: num(raw.units),
    kills: num(raw.kills),
    losses: num(raw.losses),
    extra: without(raw, [
      "slot",
      "name",
      "team",
      "side",
      "outcome",
      "units",
      "kills",
      "losses",
    ]),
  };
}

/**
 * Read a status line as a `game_over`, or null if it is not one. Nobody has seen
 * a real `game_over`, so every field is optional: a missing or wrong kind of
 * field becomes null and an unknown one is kept in `extra`.
 *
 * A `game_over` whose `results` was not a list reaches here as an `unknown`
 * event, because the backend could not make a `gameOver` of it. It still counts
 * as a finished match, with no results.
 */
export function oaGameOverLine(event: OaEvent): Record<string, unknown> | null {
  const line: Record<string, unknown> = { ...event };
  if (event.kind === "gameOver") return line;
  if (event.kind === "unknown" && event.event === "game_over") return line;
  return null;
}

/** The record for a `game_over` line, without the run's facts that complete it. */
export function parseOaMatch(
  line: Record<string, unknown>,
): Pick<OaMatchRecord, "outcome" | "winner" | "frame" | "results" | "extra"> {
  const winner = line.winner;
  return {
    outcome: str(line.outcome),
    winner:
      typeof winner === "number" || typeof winner === "string" ? winner : null,
    frame: num(line.frame),
    results: Array.isArray(line.results)
      ? line.results
          .map(parseOaPlayerResult)
          .filter((r): r is OaPlayerResult => r !== null)
      : [],
    extra: without(line, [
      "kind",
      "event",
      "results",
      "outcome",
      "winner",
      "frame",
    ]),
  };
}

interface Storage {
  read: () => OaMatchRecord[];
  write: (next: OaMatchRecord[]) => void;
}

let storage: Storage | null = null;
let waiting: OaMatchRecord[] = [];

/** Add a match to the stored list, or hold it until the list can be written. */
export function recordOaMatch(record: OaMatchRecord) {
  if (storage) storage.write([...storage.read(), record]);
  else waiting.push(record);
}

function attach(next: Storage): () => void {
  storage = next;
  if (waiting.length > 0) {
    const flush = waiting;
    waiting = [];
    next.write([...next.read(), ...flush]);
  }
  return () => {
    if (storage === next) storage = null;
  };
}

function asList(value: unknown): OaMatchRecord[] {
  return Array.isArray(value) ? (value as OaMatchRecord[]) : [];
}

/** Every finished OA match this client has recorded, oldest first. */
export function useOaMatches(): OaMatchRecord[] {
  const [stored] = useSetting<OaMatchRecord[]>(OA_MATCHES_KEY, []);
  return asList(stored);
}

/**
 * Write the matches `oaRun` records into the setting. Mount it once, above every
 * page, so a match that ends while the battle room is closed is still kept.
 */
export function useKeepOaMatches() {
  const [stored, setStored] = useSetting<OaMatchRecord[]>(OA_MATCHES_KEY, []);
  const current = useRef(asList(stored));
  current.current = asList(stored);
  useEffect(
    () =>
      attach({
        read: () => current.current,
        write: (next) => {
          current.current = next;
          setStored(next);
        },
      }),
    [setStored],
  );
}

/** Forget what is held and detach. For tests. */
export function resetOaMatches() {
  storage = null;
  waiting = [];
}
