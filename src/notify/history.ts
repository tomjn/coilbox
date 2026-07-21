import { useSyncExternalStore } from "react";
import type { NotifyLevel } from "./notify";

/**
 * A recorded notification. `notify()` records one of these every time it fires,
 * so the topbar bell can show recently-missed notifications after their toasts
 * have vanished.
 */
export interface NotifyHistoryEntry {
  id: string;
  title: string;
  body?: string;
  level: NotifyLevel;
  /** Optional in-app route opened when the entry is clicked. */
  to?: string;
  /** When it was recorded (epoch ms). */
  at: number;
}

interface HistoryState {
  /** Newest first. */
  entries: NotifyHistoryEntry[];
  /** Recorded-but-not-yet-seen count, for the bell badge. Not persisted. */
  unread: number;
}

/** Keep only the most recent N so history can't grow unbounded. */
export const HISTORY_CAP = 50;
const STORAGE_KEY = "coilbox.notify.history";

/**
 * Pure: prepend `entry` (newest first) and cap to `cap`. Split out so the record
 * / cap behaviour is unit-testable without React or storage.
 */
export function capEntries(
  entries: NotifyHistoryEntry[],
  entry: NotifyHistoryEntry,
  cap = HISTORY_CAP,
): NotifyHistoryEntry[] {
  return [entry, ...entries].slice(0, cap);
}

/** Load persisted entries. Guarded for private mode / quota / bad JSON. */
function load(): NotifyHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is NotifyHistoryEntry =>
        e &&
        typeof e.id === "string" &&
        typeof e.title === "string" &&
        typeof e.at === "number",
    );
  } catch {
    return [];
  }
}

function persist(entries: NotifyHistoryEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage unavailable — session-only history is an acceptable fallback.
  }
}

let state: HistoryState = { entries: load(), unread: 0 };
const listeners = new Set<() => void>();

function setState(next: HistoryState): void {
  state = next;
  for (const l of listeners) l();
}

let seq = 0;
function nextId(): string {
  seq += 1;
  return `${Date.now()}-${seq}`;
}

/** The shape `notify()` hands us — a subset of `NotifyInput`. */
export interface RecordInput {
  title: string;
  body?: string;
  level?: NotifyLevel;
  to?: string;
}

/** Record a notification into history. Called once from `notify()`. */
export function recordNotification(input: RecordInput): void {
  const entry: NotifyHistoryEntry = {
    id: nextId(),
    title: input.title,
    body: input.body,
    level: input.level ?? "info",
    to: input.to,
    at: Date.now(),
  };
  const entries = capEntries(state.entries, entry);
  persist(entries);
  setState({ entries, unread: state.unread + 1 });
}

/** Empty the history and reset the unread count. */
export function clearHistory(): void {
  persist([]);
  setState({ entries: [], unread: 0 });
}

/** Reset the unread badge — the panel was opened, so nothing is "new" now. */
export function markRead(): void {
  if (state.unread === 0) return;
  setState({ entries: state.entries, unread: 0 });
}

/** Current snapshot (stable reference between mutations). */
export function readHistory(): HistoryState {
  return state;
}

/** Subscribe a component to the history store. */
export function useNotifyHistory(): HistoryState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    readHistory,
    readHistory,
  );
}
