import type { ChatMsg } from "../bindings";

/**
 * Fold a run of join and leave notices into one line.
 *
 * A busy channel reports every arrival and departure as its own line, and a
 * player on a poor connection reports several, so the notices bury the chat
 * between them. Purely presentation: the stored messages are untouched, and a
 * notice with nothing beside it is drawn exactly as before.
 */

/** One row of the message list: a message, or a run of notices folded into one. */
export interface ChatRow {
  /** The message, or the first notice of a run. */
  m: ChatMsg;
  /** Every notice of a folded run, in order, or null for a single message. */
  run: ChatMsg[] | null;
}

const isPresence = (m: ChatMsg) => m.kind === "join" || m.kind === "leave";

const sameDay = (a: number, b: number) =>
  new Date(a).toDateString() === new Date(b).toDateString();

/**
 * Group adjacent join and leave notices. A run stops at midnight, so the day
 * divider still lands between the two days.
 */
export function foldNotices(msgs: ChatMsg[]): ChatRow[] {
  const rows: ChatRow[] = [];
  let run: ChatMsg[] = [];
  const flush = () => {
    if (run.length === 0) return;
    rows.push({ m: run[0], run: run.length > 1 ? run : null });
    run = [];
  };
  for (const m of msgs) {
    if (!isPresence(m)) {
      flush();
      rows.push({ m, run: null });
      continue;
    }
    const prev = run[run.length - 1];
    if (prev && !sameDay(prev.at, m.at)) flush();
    run.push(m);
  }
  flush();
  return rows;
}

/** What a run of notices came to, by what each person ended up doing. */
export interface NoticeSummary {
  joined: string[];
  /** Left and came back, so they were here before the run and are here after. */
  rejoined: string[];
  left: string[];
  /** Arrived and went again, so they are in neither place. */
  passedThrough: string[];
}

/**
 * Sort the people in a run by where they started and where they ended up. Each
 * person is named once, in the order they first appear.
 */
export function summariseNotices(run: ChatMsg[]): NoticeSummary {
  const first = new Map<string, ChatMsg["kind"]>();
  const last = new Map<string, ChatMsg["kind"]>();
  for (const m of run) {
    if (!first.has(m.from)) first.set(m.from, m.kind);
    last.set(m.from, m.kind);
  }
  const summary: NoticeSummary = {
    joined: [],
    rejoined: [],
    left: [],
    passedThrough: [],
  };
  for (const [name, began] of first) {
    const ended = last.get(name);
    if (began === "join") {
      (ended === "join" ? summary.joined : summary.passedThrough).push(name);
    } else {
      (ended === "join" ? summary.rejoined : summary.left).push(name);
    }
  }
  return summary;
}
