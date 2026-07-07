import { useSyncExternalStore } from "react";
import { type LuaReplResult, unitsyncLuaReplExec } from "../../bindings";

/**
 * Session store for the archive Lua REPL. There is no live VM behind unitsync's
 * parser — every eval builds a fresh `lua_State` — so we fake persistence by
 * *replaying*: we keep the ordered list of previously-successful inputs and hand
 * the whole list (plus the new input) to the worker on each Run. Globals persist
 * across chunks within that replay; failed inputs never join the list.
 *
 * State lives at module scope (keyed per target+archive) rather than in a
 * component, so the transcript survives the drawer closing and the drawer <->
 * full-page "pop out" navigation. Mirrors the `scanCache` keying in `config.ts`.
 */

/** One entry in the transcript: an input and everything the eval produced. */
export interface ReplCell {
  input: string;
  /** The final chunk's `print` output, newline-joined. */
  prints?: string;
  /** The pretty-printed returned value (set on success). */
  result?: string;
  /** A compile/runtime error, or a "session replay diverged…" message. */
  error?: string;
  /** 1-based index of a replayed chunk that failed (set with such an error). */
  divergedAt?: number;
  /** Non-fatal unitsync diagnostics for this eval. */
  diagnostics: string[];
}

interface ReplSession {
  /** Previously-successful inputs, replayed on every eval. */
  chunks: string[];
  /** The visible transcript (one cell per eval, including failures). */
  cells: ReplCell[];
  running: boolean;
}

/** Shared, never-mutated empty session so `getSnapshot` is side-effect free. */
const EMPTY: ReplSession = { chunks: [], cells: [], running: false };

const sessions = new Map<string, ReplSession>();
const listeners = new Map<string, Set<() => void>>();

export function sessionKey(
  dataDir: string,
  enginePath: string,
  archive: string,
): string {
  return `${dataDir}::${enginePath}::${archive}`;
}

function notify(key: string) {
  const ls = listeners.get(key);
  if (ls) for (const l of ls) l();
}

function setSession(key: string, next: ReplSession) {
  sessions.set(key, next);
  notify(key);
}

/** Current snapshot for a session key (the shared empty session if unseen). */
export function readSession(key: string): ReplSession {
  return sessions.get(key) ?? EMPTY;
}

/** Subscribe a component to one session; re-renders on any change to it. */
export function useReplSession(key: string): ReplSession {
  return useSyncExternalStore(
    (cb) => {
      let ls = listeners.get(key);
      if (!ls) {
        ls = new Set();
        listeners.set(key, ls);
      }
      ls.add(cb);
      return () => ls.delete(cb);
    },
    () => readSession(key),
  );
}

/**
 * Run `input` against the session: replay the accumulated chunks plus `input` in
 * one worker call, append a transcript cell, and — only when the eval had no
 * error — add `input` to the replayed chunks. A concurrent Run is ignored.
 */
export async function evalChunk(
  target: { enginePath: string; dataDir: string; archive: string },
  input: string,
): Promise<void> {
  const key = sessionKey(target.dataDir, target.enginePath, target.archive);
  const prev = sessions.get(key) ?? EMPTY;
  if (prev.running) return;

  const chunks = [...prev.chunks, input];
  setSession(key, { ...prev, running: true });

  let res: LuaReplResult;
  try {
    res = await unitsyncLuaReplExec({ ...target, chunks });
  } catch (e) {
    res = { error: e instanceof Error ? e.message : String(e), errors: [] };
  }

  const cur = sessions.get(key) ?? EMPTY;
  const cell: ReplCell = {
    input,
    prints: res.prints,
    result: res.result,
    error: res.error,
    divergedAt: res.divergedAt,
    diagnostics: res.errors ?? [],
  };
  setSession(key, {
    // The input joins the replay only if it succeeded (no error of any kind).
    chunks: res.error ? cur.chunks : [...cur.chunks, input],
    cells: [...cur.cells, cell],
    running: false,
  });

  pushHistory(target.archive, input);
}

/** Clear a session's replay chunks and transcript. */
export function resetSession(key: string) {
  setSession(key, { chunks: [], cells: [], running: false });
}

/* --- input history (persisted per archive) -------------------------------- */

const HISTORY_CAP = 50;
const historyKey = (archive: string) => `coilbox.luaRepl.history.${archive}`;

/** Load an archive's input history (oldest first). Guarded for private mode. */
export function loadHistory(archive: string): string[] {
  try {
    const raw = localStorage.getItem(historyKey(archive));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((v) => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

/** Append `input` to the archive's history (dedup consecutive, capped). */
export function pushHistory(archive: string, input: string) {
  const trimmed = input.trim();
  if (!trimmed) return;
  try {
    const hist = loadHistory(archive);
    if (hist[hist.length - 1] === input) return;
    const next = [...hist, input].slice(-HISTORY_CAP);
    localStorage.setItem(historyKey(archive), JSON.stringify(next));
  } catch {
    // localStorage unavailable (private mode / quota) — history simply isn't kept.
  }
}
