import { describe, expect, it, vi } from "vitest";

// channels.ts imports `useSetting` from @picoframe/frame and, transitively via
// profile.ts, `defineCommand` from @picoframe/plugin-sdk — both published dists use
// extensionless relative imports Vitest's node resolver won't load. These pure-helper
// tests never call the hook or a command, so stubbing the leaves is enough to let the
// module import (same pattern as store.test.ts).
vi.mock("@picoframe/frame", () => ({
  useSetting: () => [{}, () => {}],
}));
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

import {
  installSettingsStorage,
  memorySettingsStorage,
  readStoredSetting,
} from "../lib/storedSetting";
import {
  addChannel,
  defaultChannelsFrom,
  firstConnectChannels,
  forgetJoinedChannel,
  JOINED_CHANNELS_KEY,
  type JoinedChannel,
  type JoinedChannels,
  normalizeChannelList,
  rememberJoinedChannel,
  removeChannel,
  type StoredChannel,
  seedJoinedChannels,
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

describe("defaultChannelsFrom", () => {
  it("returns [] when there's no lobby block or no channels", () => {
    expect(defaultChannelsFrom(undefined)).toEqual([]);
    expect(defaultChannelsFrom({})).toEqual([]);
  });

  it("normalizes bare-string channels", () => {
    expect(defaultChannelsFrom({ channels: ["main", "help"] })).toEqual([
      { name: "main" },
      { name: "help" },
    ]);
  });

  it("passes object channels through, keeping keys", () => {
    expect(
      defaultChannelsFrom({ channels: [{ name: "secret", key: "k" }] }),
    ).toEqual([{ name: "secret", key: "k" }]);
  });

  it("trims names and drops blank entries", () => {
    expect(
      defaultChannelsFrom({ channels: ["  main  ", "", { name: "  " }] }),
    ).toEqual([{ name: "main" }]);
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

describe("rememberJoinedChannel", () => {
  const serverKey = "me@lobby.example:8200";

  /** A store, and the setter `useJoinedChannels` hands a caller back. */
  function bank() {
    const storage = memorySettingsStorage();
    installSettingsStorage(storage);
    return {
      write: (next: JoinedChannels) =>
        storage.set(JOINED_CHANNELS_KEY, JSON.stringify(next)),
      stored: () =>
        normalizeChannelList(
          readStoredSetting<JoinedChannels>(JOINED_CHANNELS_KEY, {})[serverKey],
        ),
    };
  }

  it("remembers every channel when several joins are confirmed in one batch", () => {
    // A first connect to a server with three channels on the autojoin list: the
    // JOIN echoes arrive together and each is persisted on confirm, with no
    // re-render in between (issue #1375).
    const { write, stored } = bank();
    rememberJoinedChannel(serverKey, "main", undefined, write);
    rememberJoinedChannel(serverKey, "off-topic", undefined, write);
    rememberJoinedChannel(serverKey, "secret", "k", write);
    expect(stored()).toEqual([
      { name: "main" },
      { name: "off-topic" },
      { name: "secret", key: "k" },
    ]);
  });

  it("forgets every channel dropped in one pass", () => {
    const { write, stored } = bank();
    for (const c of ["main", "off-topic", "help"])
      rememberJoinedChannel(serverKey, c, undefined, write);
    forgetJoinedChannel(serverKey, "main", write);
    forgetJoinedChannel(serverKey, "help", write);
    expect(stored()).toEqual([{ name: "off-topic" }]);
  });

  it("leaves another server's list alone", () => {
    const { write, stored } = bank();
    rememberJoinedChannel("other@lobby.example:8200", "main", undefined, write);
    rememberJoinedChannel(serverKey, "help", undefined, write);
    expect(stored()).toEqual([{ name: "help" }]);
    expect(
      readStoredSetting<JoinedChannels>(JOINED_CHANNELS_KEY, {})[
        "other@lobby.example:8200"
      ],
    ).toEqual([{ name: "main" }]);
  });
});

describe("firstConnectChannels", () => {
  it("seeds main for a TASServer login (uberserver, Teiserver) with no profile channels", () => {
    expect(firstConnectChannels("tasserver", [])).toEqual([{ name: "main" }]);
  });

  it("leaves Zero-K unchanged, since it force-joins its own defaults", () => {
    expect(firstConnectChannels("zerok", [])).toEqual([]);
  });

  it("leaves Tachyon unchanged, since it has no named channels", () => {
    expect(firstConnectChannels("tachyon", [])).toEqual([]);
  });

  it("lets the profile seed win over main on TASServer", () => {
    expect(firstConnectChannels("tasserver", [{ name: "welcome" }])).toEqual([
      { name: "welcome" },
    ]);
  });

  it("lets the profile seed win even on Zero-K or Tachyon", () => {
    expect(firstConnectChannels("zerok", [{ name: "welcome" }])).toEqual([
      { name: "welcome" },
    ]);
    expect(firstConnectChannels("tachyon", [{ name: "welcome" }])).toEqual([
      { name: "welcome" },
    ]);
  });
});

describe("seedJoinedChannels", () => {
  const serverKey = "me@lobby.example:8200";

  function bank() {
    const storage = memorySettingsStorage();
    installSettingsStorage(storage);
    return {
      write: (next: JoinedChannels) =>
        storage.set(JOINED_CHANNELS_KEY, JSON.stringify(next)),
      stored: () =>
        readStoredSetting<JoinedChannels>(JOINED_CHANNELS_KEY, {})[serverKey],
    };
  }

  it("seeds a first connect that has no stored list at all", () => {
    const { write, stored } = bank();
    seedJoinedChannels(serverKey, [{ name: "main" }], write);
    expect(stored()).toEqual([{ name: "main" }]);
  });

  it("leaves a stored empty list empty, so a leave stays gone on reconnect", () => {
    const { write, stored } = bank();
    // Simulate the login already having connected once and left every
    // channel: the stored list is `[]`, not undefined.
    write({ [serverKey]: [] });
    seedJoinedChannels(serverKey, [{ name: "main" }], write);
    expect(stored()).toEqual([]);
  });

  it("does not reseed once a channel is already stored", () => {
    const { write, stored } = bank();
    write({ [serverKey]: [{ name: "off-topic" }] });
    seedJoinedChannels(serverKey, [{ name: "main" }], write);
    expect(stored()).toEqual([{ name: "off-topic" }]);
  });

  it("leaves another server's list alone", () => {
    const { write, stored } = bank();
    seedJoinedChannels("other@lobby.example:8200", [{ name: "main" }], write);
    expect(stored()).toBeUndefined();
    expect(
      readStoredSetting<JoinedChannels>(JOINED_CHANNELS_KEY, {})[
        "other@lobby.example:8200"
      ],
    ).toEqual([{ name: "main" }]);
  });
});
