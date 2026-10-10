import { contentReplayAnalysisEvents } from "./bindings";
import type { LogEvent } from "./replayAnalysisEvents";

/**
 * One read of an analysis's events for the whole page (#1160).
 *
 * The recorded events table reads every kind when it is opened, and the map's
 * layers read the kinds they draw. Both ask here, so a kind that has been read
 * is not read again, and a map layer asked after the table was opened is
 * answered from the table's read. An analysis is named by its game id and the
 * time it was run, so a newer run is a new read.
 */

interface Entry {
  all?: Promise<LogEvent[]>;
  kinds: Map<string, Promise<LogEvent[]>>;
}

const entries = new Map<string, Entry>();

function entryFor(gameId: string, analysedAtMs: number): Entry {
  const key = `${gameId}\n${analysedAtMs}`;
  let entry = entries.get(key);
  if (!entry) {
    // Only the analysis being looked at is kept. A match's events can be large,
    // and the page asks for one replay at a time.
    entries.clear();
    entry = { kinds: new Map() };
    entries.set(key, entry);
  }
  return entry;
}

/**
 * The events of an analysis, of `kinds` or of every kind when `kinds` is null.
 * A read that fails is forgotten, so asking again tries again.
 */
export function readReplayEvents(
  gameId: string,
  analysedAtMs: number,
  kinds: readonly string[] | null,
): Promise<LogEvent[]> {
  const entry = entryFor(gameId, analysedAtMs);
  const ask = (wanted?: string[]) =>
    contentReplayAnalysisEvents(
      wanted ? { gameId, kinds: wanted } : { gameId },
    ).then((res) => res.events as LogEvent[]);

  if (kinds === null) {
    if (!entry.all) {
      const read = ask();
      entry.all = read;
      read.catch(() => {
        if (entry.all === read) entry.all = undefined;
      });
    }
    return entry.all;
  }

  const wanted = new Set(kinds);
  if (entry.all) {
    return entry.all.then((events) => events.filter((e) => wanted.has(e.kind)));
  }
  const missing = kinds.filter((k) => !entry.kinds.has(k));
  if (missing.length > 0) {
    const read = ask(missing);
    for (const kind of missing) {
      const own = read.then((events) => events.filter((e) => e.kind === kind));
      entry.kinds.set(kind, own);
      own.catch(() => {
        if (entry.kinds.get(kind) === own) entry.kinds.delete(kind);
      });
    }
  }
  return Promise.all(kinds.map((k) => entry.kinds.get(k) ?? [])).then(
    (parts) => parts.flat() as LogEvent[],
  );
}

/** For tests: forget every read. */
export function resetReplayEventReadsForTests(): void {
  entries.clear();
}
