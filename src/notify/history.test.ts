import { beforeEach, describe, expect, it } from "vitest";
import {
  capEntries,
  clearHistory,
  HISTORY_CAP,
  markRead,
  type NotifyHistoryEntry,
  readHistory,
  recordNotification,
} from "./history";

function entry(id: string): NotifyHistoryEntry {
  return { id, title: id, level: "info", at: 0 };
}

describe("capEntries", () => {
  it("prepends newest first", () => {
    const result = capEntries([entry("a")], entry("b"));
    expect(result.map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("caps to the given limit, dropping the oldest", () => {
    const seed = Array.from({ length: 3 }, (_, i) => entry(`old${i}`));
    const result = capEntries(seed, entry("new"), 3);
    expect(result.map((e) => e.id)).toEqual(["new", "old0", "old1"]);
    expect(result).toHaveLength(3);
  });
});

describe("history store", () => {
  beforeEach(() => clearHistory());

  it("records a notification, newest first, and counts it unread", () => {
    recordNotification({ title: "First" });
    recordNotification({ title: "Second", level: "error", to: "/downloads" });
    const { entries, unread } = readHistory();
    expect(entries.map((e) => e.title)).toEqual(["Second", "First"]);
    expect(entries[0]).toMatchObject({ level: "error", to: "/downloads" });
    expect(entries[1].level).toBe("info");
    expect(unread).toBe(2);
  });

  it("caps stored history at HISTORY_CAP", () => {
    for (let i = 0; i < HISTORY_CAP + 10; i++) {
      recordNotification({ title: `n${i}` });
    }
    const { entries } = readHistory();
    expect(entries).toHaveLength(HISTORY_CAP);
    expect(entries[0].title).toBe(`n${HISTORY_CAP + 9}`);
  });

  it("markRead resets the unread count without dropping entries", () => {
    recordNotification({ title: "a" });
    recordNotification({ title: "b" });
    markRead();
    const { entries, unread } = readHistory();
    expect(unread).toBe(0);
    expect(entries).toHaveLength(2);
  });

  it("clearHistory empties entries and unread", () => {
    recordNotification({ title: "a" });
    clearHistory();
    expect(readHistory()).toEqual({ entries: [], unread: 0 });
  });
});
