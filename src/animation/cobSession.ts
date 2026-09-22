import { useSyncExternalStore } from "react";
import type { LintDiagnostic } from "./bindings";

/**
 * What the COB tools page has on screen, kept at module scope so it survives
 * the route unmounting when the user goes elsewhere and comes back. Otherwise
 * they have to find and open the file again, having changed nothing.
 *
 * Not persisted to settings, unlike the drafts other pages keep: these are
 * three renderings of one file, each of them re-derivable in a command, and
 * the hex dump of a large script runs to hundreds of kilobytes. Mirrors the
 * session store behind the archive Lua REPL.
 */
export interface CobSession {
  /** The file the user opened, `.bos` or `.cob`. */
  path: string;
  kind: "bos" | "cob" | null;
  /** What "Reveal in folder" points at: a compile's output, or the file. */
  revealTarget: string;
  /** Source: read from disk for a `.bos`, rebuilt for a `.cob`. */
  bos: string;
  /** The compiled file as a hex dump. */
  hex: string;
  /** The instructions in it. */
  listing: string;
  /** Which tab is showing. */
  view: "bos" | "cob" | "opcodes";
  warnings: string[];
  diagnostics: LintDiagnostic[];
  lintError: string | null;
}

export const EMPTY_COB_SESSION: CobSession = {
  path: "",
  kind: null,
  revealTarget: "",
  bos: "",
  hex: "",
  listing: "",
  view: "bos",
  warnings: [],
  diagnostics: [],
  lintError: null,
};

let session: CobSession = EMPTY_COB_SESSION;
const listeners = new Set<() => void>();

/** Change part of the session, leaving the rest alone. */
export function updateCobSession(patch: Partial<CobSession>) {
  session = { ...session, ...patch };
  for (const listener of listeners) listener();
}

/** The session as it is now, and re-renders whenever any of it changes. */
export function useCobSession(): CobSession {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => session,
  );
}
