/**
 * Checking a project's compiled output before it ever leaves the app
 * (issue #1276).
 *
 * A malformed tweak blob does not fail loudly in a lobby. It produces a game
 * that starts and behaves as though the tweak were not there, or does not
 * start at all, with the cause buried in an infolog. `crates/tauri-plugin-coilbox-workshop/src/preflight.rs`
 * is the check coilbox runs instead: Lua syntax through `coilbox-springlua`,
 * plus the cheap static checks documented there.
 *
 * Three lists rather than one, kept apart on the wire as well as on screen. A
 * warning that stops an export is a warning people learn to route around, so
 * a blocker (would reach the game broken) is never rendered next to a review
 * item (worth a look, but the compiler already chose to proceed past it) as
 * though they meant the same thing.
 */
import { defineCommand } from "@picoframe/plugin-sdk";
import { useEffect, useRef, useState } from "react";
import type { ModProject } from "./project";

/** What a preflight run found, kept in the same three lists Rust returns. */
export interface PreflightReport {
  /** Would reach the game broken. Export should wait until these clear. */
  blockers: string[];
  /** Worth a look, but the compiler already chose to proceed past these. */
  review: string[];
  /** What was checked and came back clean. */
  passes: string[];
}

export const workshopPreflight = defineCommand<
  { project: ModProject },
  PreflightReport
>("coilbox-workshop", "workshop_preflight");

/** What the caller has: the report, or the reason there is none yet. */
export interface PreflightState {
  report: PreflightReport | null;
  loading: boolean;
  /** What went wrong, which in practice means the command itself failed. */
  error: string | null;
}

/**
 * Nothing checked and nothing being checked. One shared value rather than a
 * fresh object, matching `IDLE` in `compile.ts` and for the same reason: a
 * button whose drawer is shut settles on the same object React already has.
 */
const IDLE: PreflightState = { report: null, loading: false, error: null };

/**
 * Run preflight when something is looking at the result.
 *
 * `enabled` is the drawer being open, the same gate `useCompiledProject`
 * uses: the check recompiles the project itself, so there is no reason to
 * pay for it while nobody is looking at the outcome. Keyed on `updatedAt`
 * rather than on the project object for the same reason too.
 */
export function usePreflightReport(
  project: ModProject | undefined,
  enabled: boolean,
): PreflightState {
  const [state, setState] = useState<PreflightState>(IDLE);
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
    workshopPreflight({ project: current })
      .then((report) => {
        if (!cancelled) setState({ report, loading: false, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setState({
            report: null,
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
