/**
 * Which fields of a unit the edit-in-place route can write, asked at edit
 * time (issue #2633).
 *
 * `workshop_check_in_place` runs the patcher as a dry run over the unit's own
 * file and writes nothing. The unit page asks it for every field it shows, so
 * a field the route cannot carry is marked before the user edits it rather
 * than refused at the write.
 *
 * Answers are cached for the session, per game folder, per checksum and per
 * unit, then per field. Whether a field can be patched depends on the file,
 * not on the value being written, so an edit to a field never asks again and
 * switching the page to the "all" view only asks about the fields it adds. The
 * checksum is unitsync's read of the game, which moves when a unit file does,
 * so an in-place write, an undo, or a hand edit that the page re-reads asks
 * afresh rather than trusting what the old file said.
 */
import { useEffect, useState } from "react";
import {
  type FieldCheck,
  type FieldProbe,
  workshopCheckInPlace,
} from "./inPlace";

const answers = new Map<string, Map<string, FieldCheck>>();
const asking = new Map<string, Set<string>>();
/** Every mounted hook, told when any answer lands. An answer asked for by one
 *  render can land after the page has moved on to the next, so it is not
 *  the effect that asked which has to hear about it. */
const listeners = new Set<() => void>();

function cacheKey(gameDir: string, checksum: string, unit: string): string {
  return `${gameDir}\n${checksum}\n${unit}`;
}

/** Forget every answer. For tests. */
export function clearInPlaceChecks() {
  answers.clear();
  asking.clear();
}

export interface InPlaceChecks {
  /** Each answered field's check, by the field's path. */
  checks: Record<string, FieldCheck>;
  /** Why the last ask failed, if it did. */
  error: string | null;
}

const NONE: InPlaceChecks = { checks: {}, error: null };

/**
 * Ask about `probes` of `unit` in the game at `gameDir`. Pass `gameDir`
 * undefined when the route does not apply, and nothing is asked.
 *
 * `checksum` must be the read the probes' values came from. Undefined while
 * the game is still being read, which also asks nothing: a read that has not
 * landed could be of a file that is about to change.
 */
export function useInPlaceChecks(
  gameDir: string | undefined,
  checksum: string | undefined,
  unit: string,
  probes: FieldProbe[],
): InPlaceChecks {
  const key =
    gameDir && checksum && unit ? cacheKey(gameDir, checksum, unit) : null;
  const [, setAnswered] = useState(0);
  const [error, setError] = useState<{ key: string; message: string } | null>(
    null,
  );

  useEffect(() => {
    const heard = () => setAnswered((n) => n + 1);
    listeners.add(heard);
    return () => {
      listeners.delete(heard);
    };
  }, []);

  useEffect(() => {
    if (!key || !gameDir) return;
    const known = answers.get(key) ?? new Map<string, FieldCheck>();
    answers.set(key, known);
    const inFlight = asking.get(key) ?? new Set<string>();
    asking.set(key, inFlight);
    const missing = probes.filter(
      (p) => !known.has(p.field) && !inFlight.has(p.field),
    );
    if (missing.length === 0) return;
    for (const p of missing) inFlight.add(p.field);
    workshopCheckInPlace({ gameDir, unit, fields: missing })
      .then((result) => {
        for (const check of result.fields) known.set(check.field, check);
        setError(null);
      })
      .catch((e: unknown) => {
        setError({ key, message: e instanceof Error ? e.message : String(e) });
      })
      .finally(() => {
        for (const p of missing) inFlight.delete(p.field);
        for (const heard of listeners) heard();
      });
  }, [key, gameDir, unit, probes]);

  if (!key) return NONE;
  const known = answers.get(key);
  const checks: Record<string, FieldCheck> = {};
  for (const p of probes) {
    const check = known?.get(p.field);
    if (check) checks[p.field] = check;
  }
  return {
    checks,
    error: error?.key === key ? error.message : null,
  };
}
