/**
 * Tracing a project's edits to what they compiled into (issue #2653).
 *
 * `compile.ts`/`barPack.ts` answer "what did this project compile to". This
 * answers the other direction: given a unit and a field, which mutator file
 * or numbered BAR slot carries it, so that a large project and a broken
 * game can be joined back to the one line that needs changing rather than
 * left as a table of outputs somebody has to search. `ledger.rs` is the
 * whole trace. This file only wraps the command and groups its flat answer
 * by output as well as by unit, for the view that starts from what is in
 * front of you rather than from the unit list (see `ChangeLedgerSection`'s
 * own comment for why both views exist).
 */
import { defineCommand } from "@picoframe/plugin-sdk";
import { useEffect, useRef, useState } from "react";
import type { ModProject } from "./project";

/** Where a change landed in BAR's numbered tweak export. */
export interface BarSlotRef {
  kind: "tweakdefs" | "tweakunits";
  /** As `!bset` names it: bare for the first of its kind, numbered from the
   *  second. */
  label: string;
}

/** Why a change did not land in a numbered BAR slot. */
export type BarSlotMiss = "oversized" | "unplaced" | "unresolved";

/** One traced change against one unit. */
export interface LedgerChange {
  description: string;
  /** The dotted field path this change set, for a field edit. Absent for a
   *  whole-unit change and for a build menu operation. */
  fieldPath: string | null;
  /** The mutator archive file(s) that carry this change. */
  files: string[];
  barSlot: BarSlotRef | null;
  barMiss: BarSlotMiss | null;
  /** Why no output carries this change at all. */
  uncompiledReason: string | null;
}

/** One unit's row in the ledger. */
export interface UnitLedger {
  unit: string;
  changes: LedgerChange[];
}

/** The whole trace. */
export interface ChangeLedger {
  units: UnitLedger[];
  notes: string[];
}

export const workshopChangeLedger = defineCommand<
  { project: ModProject },
  ChangeLedger
>("coilbox-workshop", "workshop_change_ledger");

/** What the caller has: the ledger, or the reason there is none yet. Mirrors
 *  `PreflightState`. */
export interface ChangeLedgerState {
  ledger: ChangeLedger | null;
  loading: boolean;
  error: string | null;
}

const IDLE: ChangeLedgerState = { ledger: null, loading: false, error: null };

/**
 * Trace a project's edits while something is looking at the result.
 *
 * Gated on `enabled` (the drawer being open), unlike `usePreflightReport`'s
 * always-on read: the ledger backs a drilldown a user opens on purpose
 * rather than the toolbar's own tick, so there is no reason to pack and
 * base64-encode a project's chunks on every keystroke nobody is reading the
 * result of.
 */
export function useChangeLedger(
  project: ModProject | undefined,
  enabled: boolean,
): ChangeLedgerState {
  const [state, setState] = useState<ChangeLedgerState>(IDLE);
  const latest = useRef(project);
  latest.current = project;
  const key = project ? `${project.id}:${project.updatedAt}` : "";

  useEffect(() => {
    const current = latest.current;
    if (!enabled || !key || !current) {
      setState(IDLE);
      return;
    }
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    workshopChangeLedger({ project: current })
      .then((ledger) => {
        if (!cancelled) setState({ ledger, loading: false, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setState({
            ledger: null,
            loading: false,
            error: e instanceof Error ? e.message : String(e),
          });
      });
    return () => {
      cancelled = true;
    };
  }, [key, enabled]);

  return state;
}

/** One row in the "by output" view: one file or one BAR slot, and every
 *  (unit, change) pair that lands in it. */
export interface OutputRow {
  key: string;
  label: string;
  entries: { unit: string; change: LedgerChange }[];
}

/**
 * The same ledger, grouped by what carries each change rather than by which
 * unit made it.
 *
 * The issue's stated shape is by unit, and that is what a modder tuning one
 * unit's numbers wants. But the thing in your hand when something is wrong
 * in the game is a file or a lobby slot, not a unit list, so this pivot is
 * the other direction the same data answers: pick "units/supercom.lua" and
 * read every change that went into it, across every unit that has one.
 * Built here rather than as a second Rust command, since it is a pure
 * regrouping of what `ChangeLedger` already carries.
 */
export function ledgerByOutput(ledger: ChangeLedger): OutputRow[] {
  const rows = new Map<string, OutputRow>();
  const rowFor = (keyName: string, label: string): OutputRow => {
    let row = rows.get(keyName);
    if (!row) {
      row = { key: keyName, label, entries: [] };
      rows.set(keyName, row);
    }
    return row;
  };

  for (const unitLedger of ledger.units) {
    for (const change of unitLedger.changes) {
      for (const file of change.files) {
        rowFor(`file:${file}`, file).entries.push({
          unit: unitLedger.unit,
          change,
        });
      }
      if (change.barSlot) {
        const slotKey = `bar:${change.barSlot.kind}:${change.barSlot.label}`;
        rowFor(slotKey, `!bset ${change.barSlot.label}`).entries.push({
          unit: unitLedger.unit,
          change,
        });
      }
    }
  }

  return [...rows.values()].sort((a, b) => a.label.localeCompare(b.label));
}
