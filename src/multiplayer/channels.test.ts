import { describe, expect, it, vi } from "vitest";

// channels.ts imports `useSetting` from @picoframe/frame, whose published dist
// uses extensionless relative imports Vitest's node resolver won't load. These
// pure-helper tests never call the hook, so stubbing the leaf package is enough
// to let the module import (same pattern as store.test.ts).
vi.mock("@picoframe/frame", () => ({
  useSetting: () => [{}, () => {}],
}));

import {
  addChannel,
  type JoinedChannel,
  normalizeChannelList,
  removeChannel,
  type StoredChannel,
} from "./channels";

describe("normalizeChannelList", () => {
  it("coerces legacy bare-string entries to objects", () => {
    const raw: StoredChannel[] = ["main", "off-topic"];
    expect(normalizeChannelList(raw)).toEqual([
      { name: "main" },
      { name: "off-topic" },
    ]);
  });

  it("passes through object entries, preserving keys", () => {
    const raw: StoredChannel[] = [{ name: "secret", key: "hunter2" }];
    expect(normalizeChannelList(raw)).toEqual([
      { name: "secret", key: "hunter2" },
    ]);
  });

  it("handles a mixed legacy/new list", () => {
    const raw: StoredChannel[] = ["main", { name: "secret", key: "k" }];
    expect(normalizeChannelList(raw)).toEqual([
      { name: "main" },
      { name: "secret", key: "k" },
    ]);
  });

  it("returns an empty list for undefined", () => {
    expect(normalizeChannelList(undefined)).toEqual([]);
  });
});

describe("addChannel", () => {
  it("appends a new channel", () => {
    const list: JoinedChannel[] = [{ name: "main" }];
    expect(addChannel(list, "off-topic")).toEqual([
      { name: "main" },
      { name: "off-topic" },
    ]);
  });

  it("appends with a key when given one", () => {
    expect(addChannel([], "secret", "k")).toEqual([
      { name: "secret", key: "k" },
    ]);
  });

  it("is idempotent by name, updating the key of an existing entry", () => {
    const list: JoinedChannel[] = [{ name: "secret" }];
    expect(addChannel(list, "secret", "k")).toEqual([
      { name: "secret", key: "k" },
    ]);
  });

  it("does not duplicate an existing keyless channel", () => {
    const list: JoinedChannel[] = [{ name: "main" }];
    expect(addChannel(list, "main")).toEqual([{ name: "main" }]);
  });

  it("normalizes legacy entries it passes through", () => {
    const list = ["main"] as unknown as JoinedChannel[];
    expect(addChannel(list, "off-topic")).toEqual([
      { name: "main" },
      { name: "off-topic" },
    ]);
  });
});

describe("removeChannel", () => {
  it("removes a channel by name", () => {
    const list: JoinedChannel[] = [{ name: "main" }, { name: "off-topic" }];
    expect(removeChannel(list, "main")).toEqual([{ name: "off-topic" }]);
  });

  it("leaves the list unchanged when the name is absent", () => {
    const list: JoinedChannel[] = [{ name: "main" }];
    expect(removeChannel(list, "nope")).toEqual([{ name: "main" }]);
  });

  it("normalizes legacy entries it passes through", () => {
    const list = ["main", "off-topic"] as unknown as JoinedChannel[];
    expect(removeChannel(list, "main")).toEqual([{ name: "off-topic" }]);
  });
});
