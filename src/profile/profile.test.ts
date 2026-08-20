import { describe, expect, it, vi } from "vitest";

// profile.ts reaches @picoframe/plugin-sdk for defineCommand, whose published dist
// uses extensionless relative imports Vitest's node resolver won't load from
// node_modules. Stubbing the leaf is enough to let the module load, the same way
// lobby-servers/config.test.ts does. These tests only exercise planProfileTheme,
// which is pure.
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

import { type Profile, planProfileTheme } from "./profile";

const MODE_KEY = "picoframe.theme";
const ACCENT_KEY = "picoframe.accent";
const BEFORE_KEY = "coilbox.theme.beforeProfile";

type Store = Map<string, string>;

/**
 * One launch: read the theme keys, plan, apply. The whole point of the change is
 * what happens across a sequence of these, so the tests below run them in order
 * against a single store rather than asserting one plan at a time.
 */
function launch(store: Store, profile: Pick<Profile, "mode" | "accent">): void {
  const writes = planProfileTheme(
    {
      mode: store.get(MODE_KEY) ?? null,
      accent: store.get(ACCENT_KEY) ?? null,
      before: store.get(BEFORE_KEY) ?? null,
    },
    profile,
  );
  for (const { key, value } of writes) {
    if (value === null) store.delete(key);
    else store.set(key, value);
  }
}

/** What picoframe writes when a player picks a colour in Appearance. */
function playerPicks(store: Store, accent: string): void {
  store.set(ACCENT_KEY, JSON.stringify(accent));
}

/**
 * The put-aside text for a set of fields. The values are the raw stored strings,
 * which are themselves JSON, so writing them out by hand means two levels of
 * quoting for no gain.
 */
function putAside(fields: { mode?: string | null; accent?: string | null }) {
  return JSON.stringify(fields);
}

const VANILLA: Pick<Profile, "mode" | "accent"> = {};

describe("planProfileTheme", () => {
  it("writes nothing on a first ever launch with no profile", () => {
    const store: Store = new Map();
    launch(store, VANILLA);
    expect([...store.keys()]).toEqual([]);
  });

  it("leaves a player's own accent alone when no profile is loaded", () => {
    const store: Store = new Map();
    playerPicks(store, "green");
    launch(store, VANILLA);
    expect(store.get(ACCENT_KEY)).toBe('"green"');
    expect(store.has(BEFORE_KEY)).toBe(false);
  });

  it("forces the brand and puts the player's accent aside", () => {
    const store: Store = new Map();
    playerPicks(store, "green");
    launch(store, { accent: "orange" });
    expect(store.get(ACCENT_KEY)).toBe('"orange"');
    expect(store.get(BEFORE_KEY)).toBe(putAside({ accent: '"green"' }));
  });

  it("hands the accent back on the ordinary launch after a branded one", () => {
    // The reported symptom (issue #1118): run the distribution, then run the
    // ordinary install, and the distribution's colour is still there.
    const store: Store = new Map();
    playerPicks(store, "green");
    launch(store, { accent: "orange" });
    launch(store, VANILLA);
    expect(store.get(ACCENT_KEY)).toBe('"green"');
    expect(store.has(BEFORE_KEY)).toBe(false);
  });

  it("does not let a second brand record the first brand's colour", () => {
    const store: Store = new Map();
    playerPicks(store, "green");
    launch(store, { accent: "orange" });
    launch(store, { accent: "violet" });
    expect(store.get(ACCENT_KEY)).toBe('"violet"');
    launch(store, VANILLA);
    expect(store.get(ACCENT_KEY)).toBe('"green"');
  });

  it("does not let the same brand twice overwrite what it put aside", () => {
    const store: Store = new Map();
    playerPicks(store, "green");
    launch(store, { accent: "orange" });
    launch(store, { accent: "orange" });
    launch(store, VANILLA);
    expect(store.get(ACCENT_KEY)).toBe('"green"');
  });

  it("restores the pre-brand accent, not one picked inside the branded run", () => {
    // A colour picked in a branded run is that run's business. The distribution
    // itself puts its brand back on its own next launch, so the ordinary install
    // taking the pick as the player's new choice would contradict it.
    const store: Store = new Map();
    playerPicks(store, "green");
    launch(store, { accent: "orange" });
    playerPicks(store, "rose");
    launch(store, VANILLA);
    expect(store.get(ACCENT_KEY)).toBe('"green"');
  });

  it("puts the accent key back to unset when the player never picked one", () => {
    const store: Store = new Map();
    launch(store, { accent: "orange" });
    expect(store.get(BEFORE_KEY)).toBe(putAside({ accent: null }));
    launch(store, VANILLA);
    expect(store.has(ACCENT_KEY)).toBe(false);
    expect(store.has(BEFORE_KEY)).toBe(false);
  });

  it("leaves the accent alone for a profile that only forces the mode", () => {
    const store: Store = new Map();
    store.set(MODE_KEY, '"light"');
    playerPicks(store, "green");
    launch(store, { mode: "dark" });
    expect(store.get(MODE_KEY)).toBe('"dark"');
    expect(store.get(ACCENT_KEY)).toBe('"green"');
    expect(store.get(BEFORE_KEY)).toBe(putAside({ mode: '"light"' }));
    launch(store, VANILLA);
    expect(store.get(MODE_KEY)).toBe('"light"');
    expect(store.get(ACCENT_KEY)).toBe('"green"');
  });

  it("hands back only the field the next profile stops forcing", () => {
    const store: Store = new Map();
    store.set(MODE_KEY, '"light"');
    playerPicks(store, "green");
    launch(store, { mode: "dark", accent: "orange" });
    launch(store, { mode: "dark" });
    expect(store.get(MODE_KEY)).toBe('"dark"');
    expect(store.get(ACCENT_KEY)).toBe('"green"');
    expect(store.get(BEFORE_KEY)).toBe(putAside({ mode: '"light"' }));
  });

  it("treats an unreadable put-aside value as nothing put aside", () => {
    const store: Store = new Map();
    store.set(BEFORE_KEY, "{not json");
    playerPicks(store, "green");
    launch(store, VANILLA);
    expect(store.get(ACCENT_KEY)).toBe('"green"');
    expect(store.has(BEFORE_KEY)).toBe(false);
  });

  it("writes nothing when the brand is already the stored value", () => {
    const store: Store = new Map();
    playerPicks(store, "green");
    launch(store, { accent: "orange" });
    const settled = new Map(store);
    expect(
      planProfileTheme(
        {
          mode: null,
          accent: settled.get(ACCENT_KEY) ?? null,
          before: settled.get(BEFORE_KEY) ?? null,
        },
        { accent: "orange" },
      ),
    ).toEqual([]);
  });
});
