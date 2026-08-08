import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { twMerge } from "tailwind-merge";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * picoframe's `outline`/`sm` button, transcribed from
 * `@picoframe/frame/dist/components/button.js`. The stand-in below merges it
 * with the caller's `className` through the real `tailwind-merge`, so a test can
 * assert which of two competing background utilities actually survives.
 */
const PICOFRAME_OUTLINE_SM =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-8 rounded-md px-3 text-xs";

// The module exports its hooks alongside the pure functions, so loading it pulls
// in picoframe's frame and plugin SDK and the Tauri command bindings, whose
// published dists use extensionless relative imports Vitest's node resolver
// won't load from node_modules. Nothing here calls a real hook, so stubbing the
// leaves is enough (same approach as continue.test.ts and toolCards.test.ts).
vi.mock("@picoframe/frame", () => ({
  useSetting: () => [{}, () => {}],
  cn: (...parts: unknown[]) => twMerge(parts.filter(Boolean).join(" ")),
  Button: ({
    children,
    className,
    variant: _variant,
    size: _size,
    ...props
  }: {
    children?: unknown;
    className?: string;
    variant?: string;
    size?: string;
  } & Record<string, unknown>) =>
    createElement(
      "button",
      {
        type: "button",
        className: twMerge(`${PICOFRAME_OUTLINE_SM} ${className ?? ""}`),
        ...props,
      },
      children as never,
    ),
}));
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));
vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {},
  invoke: async () => ({}),
}));
// Reading the lobby pulls in `multiplayer/store`, whose cue modules touch
// `window` at import time. Same stubs as continue.test.ts, which reads it too.
vi.mock("../multiplayer/ringEffect", () => ({ triggerRing: () => {} }));
vi.mock("../multiplayer/ingameCue", () => ({ triggerIngameCue: () => {} }));
vi.mock("../multiplayer/chat/mentionCue", () => ({
  triggerMentionCue: () => {},
}));

/**
 * What the zone's two hooks answer, swapped per case. The hooks themselves read
 * the download queue, the content roots and a unitsync scan, none of which exist
 * in node. Everything else in the module is the real thing, including the
 * context the page's answer arrives through: `render` provides it the way
 * `CoilboxHome` does, so the card is exercised as the page mounts it rather than
 * against a stubbed hook (issue #1077).
 */
const hooks = vi.hoisted(() => ({
  install: {} as Record<string, unknown>,
  art: undefined as string | undefined,
}));

vi.mock("./suggestedMap", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./suggestedMap")>();
  return {
    ...actual,
    useSuggestedMapInstall: () => hooks.install,
    useSuggestedMapArt: () => hooks.art,
  };
});

import type { SuggestedMap, SuggestedMapList } from "../content/branding";
import type { EnqueueInput } from "../downloads/DownloadQueueProvider";
import { ART_BAND_CLASS, ART_CARD_CLASS } from "./cardShell";
import * as suggested from "./suggestedMap";
import SuggestedMapZone, { SuggestedMapCard } from "./zones/SuggestedMap";

const {
  battleSuggestedMap,
  msToNextUtcDay,
  subscribeUtcDay,
  suggestedMapCandidates,
  suggestedMapClaim,
  suggestedMapFor,
  suggestedMapInstalled,
  suggestedMapPlacement,
  suggestedMapPool,
  suggestedMapState,
  noMapsInstalled,
  pickSuggestedMap,
  holdSuggestion,
  springNameOf,
  utcDayIndex,
  utcDayNow,
} = suggested;

/** A curated map downloaded by spring name, the common catalog shape. */
function map(id: string, springName = id): SuggestedMap {
  return {
    id,
    title: id,
    filename: `${id}.sd7`,
    download: { kind: "map", springName },
  };
}

function pack(id: string, maps: SuggestedMap[]): SuggestedMapList {
  return { id, title: id, maps };
}

/** The same map, with the catalog thumbnail the card would paint. */
function pictured(id: string, springName = id): SuggestedMap {
  return { ...map(id, springName), thumb: [`https://example.test/${id}.jpg`] };
}

/** A player who has nothing, having actually looked. */
const NOTHING: suggested.MapInventory = {
  files: new Set(),
  names: new Set(),
  known: true,
};

/** A player who has these maps, by catalog file name. Lowercased, as the listing is. */
function has(...filenames: string[]): suggested.MapInventory {
  return {
    files: new Set(filenames.map((f) => f.toLowerCase())),
    names: new Set(),
    known: true,
  };
}

describe("the curated pool", () => {
  it("takes the standalone suggestions and every pack's maps", () => {
    const pool = suggestedMapPool(
      [pictured("a")],
      [pack("p", [pictured("b")]), pack("q", [pictured("c")])],
    );
    expect(pool.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("counts a map in both places once, so it is not twice as likely", () => {
    // The catalog's starter pack repeats `suggested.maps` verbatim today.
    const pool = suggestedMapPool(
      [pictured("a")],
      [pack("p", [pictured("a"), pictured("b")])],
    );
    expect(pool.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("dedupes on the spring name, not the catalog id", () => {
    const one = pictured("editorial-id", "Shared Map v1");
    const two = pictured("legacy-id", "shared map V1");
    expect(suggestedMapPool([one, two], [])).toHaveLength(1);
  });

  it("drops maps nothing can install, so the card never has a dead button", () => {
    // `rapid` is not a map-download kind, so `suggestedMapToInput` returns null
    // for it and the card would render an Unavailable button.
    const rapid: SuggestedMap = {
      id: "r",
      title: "r",
      thumb: ["https://example.test/r.jpg"],
      download: { kind: "rapid", tag: "map:latest" },
    };
    expect(
      suggestedMapPool([rapid, pictured("a")], []).map((m) => m.id),
    ).toEqual(["a"]);
  });

  it("keeps a direct mirror download, which is installable", () => {
    const mirror: SuggestedMap = {
      id: "u",
      title: "u",
      filename: "u.sd7",
      thumb: ["https://example.test/u.jpg"],
      download: {
        kind: "url",
        url: "https://example.test/u.sd7",
        filename: "u.sd7",
      },
    };
    expect(suggestedMapPool([mirror], [])).toHaveLength(1);
  });

  it("passes over a map the catalog cannot picture", () => {
    // Issue #1070. A card with no picture beside three that have one reads as a
    // card that failed, and the next map in the rotation is a real map with a
    // real picture, so nothing is lost by moving on.
    const pool = suggestedMapPool(
      [pictured("a"), map("b"), pictured("c")],
      [pack("p", [map("d"), pictured("e")])],
    );
    expect(pool.map((m) => m.id)).toEqual(["a", "c", "e"]);
  });

  it("treats an empty thumb list as no picture at all", () => {
    const empty: SuggestedMap = { ...map("a"), thumb: [] };
    expect(
      suggestedMapPool([empty, pictured("b")], []).map((m) => m.id),
    ).toEqual(["b"]);
  });

  it("empties when no map can be pictured, which is the same as having them all", () => {
    // The pool used to fall back to the unpictured maps so a distribution
    // curating maps without thumbnails kept a card with a glyph on it. Since
    // #1102 an empty offer is an ordinary state of this card, so both ways of
    // emptying it take the one path that removes the card.
    expect(suggestedMapPool([map("a")], [pack("p", [map("b")])])).toEqual([]);
    expect(pickSuggestedMap([], new Date(0), NOTHING)).toBeNull();
  });

  it("counts the maps it passed over, so a test can hold the catalog to them", () => {
    const candidates = suggestedMapCandidates([pictured("a"), map("b")], []);
    expect(candidates.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("is the same pool whatever the player has, since the walk does the skipping", () => {
    const maps = [pictured("a"), pictured("b")];
    expect(suggestedMapPool(maps, []).map((m) => m.id)).toEqual(["a", "b"]);
  });
});

describe("the maps the player already has", () => {
  it("matches the catalog file name against the download folder", () => {
    expect(suggestedMapInstalled(map("a"), has("a.sd7"))).toBe(true);
    expect(suggestedMapInstalled(map("a"), has("b.sd7"))).toBe(false);
  });

  it("matches the spring name against what the engine can see", () => {
    // The file listing cannot answer for a map pr-downloader named itself.
    const inventory = {
      files: new Set<string>(),
      names: new Set(["fallendell_v4"]),
      known: true,
    };
    expect(suggestedMapInstalled(map("f", "Fallendell_V4"), inventory)).toBe(
      true,
    );
  });

  it("matches the title too, for a mirror download with no spring name", () => {
    const mirror: SuggestedMap = {
      id: "u",
      title: "Comet Catcher",
      download: { kind: "url", url: "u", filename: "u.sd7" },
    };
    const inventory = {
      files: new Set<string>(),
      names: new Set(["comet catcher"]),
      known: true,
    };
    expect(suggestedMapInstalled(mirror, inventory)).toBe(true);
  });

  it("will not say the player has nothing until it has looked", () => {
    expect(noMapsInstalled({ ...NOTHING, known: false })).toBe(false);
    expect(noMapsInstalled(NOTHING)).toBe(true);
    expect(noMapsInstalled(has("a.sd7"))).toBe(false);
    expect(
      noMapsInstalled({ files: new Set(), names: new Set(["x"]), known: true }),
    ).toBe(false);
  });
});

describe("the catalog this ships with", () => {
  // The real file, not a fixture. Nothing stops an editor adding a map to a pack
  // without a thumbnail, and until #1070 nothing would have said so: the card
  // just came up without a picture on that map's day and no test failed in
  // between. The rotation now passes such a map over, so the failure mode became
  // a map that is never suggested, which is just as quiet. This is the guard.
  const catalog = JSON.parse(
    readFileSync(new URL("../../catalog.json", import.meta.url), "utf8"),
  ) as {
    suggested?: { maps?: SuggestedMap[]; mapLists?: SuggestedMapList[] };
  };
  const candidates = suggestedMapCandidates(
    catalog.suggested?.maps ?? [],
    catalog.suggested?.mapLists ?? [],
  );
  const thumbless = candidates.filter((m) => !m.thumb?.length);

  /**
   * Curated maps with no thumbnail, by catalog id, each with the issue that
   * settles it. An entry here is one the rotation never reaches, so the list is
   * a statement that we know and it is tracked, not a licence.
   */
  const NO_THUMBNAIL: Record<string, string> = {
    // springfiles serves this spring name with a joke map, so there is no
    // picture of Folsom Dam to point at until the entry is repointed or dropped.
    "classic-folsom-dam": "https://github.com/tomjn/coilbox/issues/1067",
  };

  it("has a rotation at all", () => {
    expect(
      suggestedMapPool(
        catalog.suggested?.maps ?? [],
        catalog.suggested?.mapLists ?? [],
      ).length,
    ).toBeGreaterThan(0);
  });

  it("gives every curated map a thumbnail, or an issue that will", () => {
    for (const m of thumbless) {
      expect(NO_THUMBNAIL, `${m.id} has no thumb and no issue`).toHaveProperty(
        m.id,
      );
    }
  });

  it("drops an exception once its map has a picture", () => {
    // The half that keeps the list from going stale: an entry that has since
    // been given a thumbnail, or removed from the catalog, fails here.
    for (const id of Object.keys(NO_THUMBNAIL)) {
      expect(
        thumbless.map((m) => m.id),
        `${id} no longer needs an exception`,
      ).toContain(id);
    }
  });

  it("never suggests a map it cannot picture", () => {
    const pool = suggestedMapPool(
      catalog.suggested?.maps ?? [],
      catalog.suggested?.mapLists ?? [],
    );
    for (const id of Object.keys(NO_THUMBNAIL)) {
      expect(pool.map((m) => m.id)).not.toContain(id);
    }
  });
});

describe("the map this card takes off the tool cards", () => {
  /** A settled answer for a card that is on the page. */
  const shown = (
    map: SuggestedMap | null,
    placement: suggested.SuggestedPlacement = "cards",
  ): suggested.SuggestedMapAnswer => ({
    map,
    loading: false,
    source: "curated",
    placement,
    inventory: NOTHING,
  });

  it("claims the map it is showing, so no tool card offers the same one", () => {
    expect(suggestedMapClaim(shown(map("a", "Fallendell_V4")))).toEqual([
      { kind: "map", mapName: "Fallendell_V4" },
    ]);
  });

  it("claims from the top row as readily as from the Downloads group", () => {
    expect(suggestedMapClaim(shown(map("a", "Fallendell_V4"), "row"))).toEqual([
      { kind: "map", mapName: "Fallendell_V4" },
    ]);
  });

  it("claims nothing when there is no card on the page", () => {
    // Whatever emptied the card: a profile that left the zone out, a player who
    // has every curated map, or a catalog with nothing to say. One question.
    expect(suggestedMapClaim(shown(map("a"), "absent"))).toEqual([]);
    expect(suggestedMapClaim(shown(null))).toEqual([]);
  });

  it("claims nothing for a mirror download, which has no spring name", () => {
    const mirror: SuggestedMap = {
      id: "u",
      title: "u",
      download: {
        kind: "url",
        url: "https://example.test/u.sd7",
        filename: "u.sd7",
      },
    };
    expect(suggestedMapClaim(shown(mirror))).toEqual([]);
  });
});

describe("the page settles the cards around the suggested map", () => {
  // The claim is a pure function and the wiring that carries it to the pick
  // layer is one call in `CoilboxHome`. Dropping that call would leave every
  // unit test green and put the duplicate picture straight back, so the call is
  // asserted on the source. See issue #1055.
  const source = readFileSync(
    new URL("./CoilboxHome.tsx", import.meta.url),
    "utf8",
  );

  it("hands the claim to the content picks from above the layout", () => {
    expect(source).toMatch(/useContentCardArt\(suggestedMapClaim\([^)]*\)\)/);
  });

  it("tells the answer which zones the page carries", () => {
    // The zone list decides both whether there is a card to claim for and
    // whether the card can be promoted past the onboarding zone (issue #1102).
    expect(source).toContain('zones.has("suggested")');
    expect(source).toContain('zones.has("onboarding")');
  });

  it("asks the get-started collector whether onboarding is offering maps", () => {
    // The other half of the promotion question, and the half that is state
    // rather than composition (issue #1109). One call, so dropping it would
    // leave every unit test green and put the coarser condition back.
    expect(source).toContain("useGetStartedOffer()");
    expect(source).toMatch(/onboardingMaps:.*offer\.maps\.length > 0/);
  });
});

describe("the daily rotation", () => {
  const pool = ["a", "b", "c", "d", "e"].map((id) => map(id));
  const at = (iso: string) =>
    pickSuggestedMap(pool, new Date(iso), NOTHING)?.id;

  it("gives the same map all day", () => {
    expect(at("2026-08-07T00:00:00Z")).toBe(at("2026-08-07T23:59:59Z"));
  });

  it("advances at UTC midnight", () => {
    expect(at("2026-08-08T00:00:00Z")).not.toBe(at("2026-08-07T23:59:59Z"));
  });

  it("features every curated map exactly once over a full cycle", () => {
    // Fairness, stated as a property: no map is favoured and none is skipped.
    const start = Date.parse("2026-08-07T09:00:00Z");
    const seen = Array.from(
      { length: pool.length },
      (_, i) =>
        pickSuggestedMap(pool, new Date(start + i * 86_400_000), NOTHING)?.id,
    );
    expect([...seen].sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("keeps cycling past the end of the pool", () => {
    const start = Date.parse("2026-08-07T09:00:00Z");
    expect(pickSuggestedMap(pool, new Date(start), NOTHING)?.id).toBe(
      pickSuggestedMap(pool, new Date(start + 5 * 86_400_000), NOTHING)?.id,
    );
  });

  it("has nothing to feature when nothing is curated", () => {
    expect(pickSuggestedMap([], new Date(), NOTHING)).toBeNull();
  });

  it("does not fall off the pool before 1970", () => {
    // JavaScript's `%` keeps the sign of a negative day index.
    expect(
      pickSuggestedMap(pool, new Date("1965-01-01T00:00:00Z"), NOTHING),
    ).not.toBe(undefined);
  });
});

describe("the rotation and the machine's timezone", () => {
  const pool = ["a", "b", "c", "d", "e"].map((id) => map(id));
  const original = process.env.TZ;
  afterEach(() => {
    process.env.TZ = original;
  });

  /** Two instants either side of local midnight but inside the same UTC day. */
  const EARLY = "2026-08-07T00:30:00Z";
  const LATE = "2026-08-07T23:30:00Z";

  for (const tz of ["UTC", "Pacific/Kiritimati", "Pacific/Niue"]) {
    it(`answers for the UTC day in ${tz}`, () => {
      process.env.TZ = tz;
      expect(pickSuggestedMap(pool, new Date(EARLY), NOTHING)?.id).toBe(
        pickSuggestedMap(pool, new Date(LATE), NOTHING)?.id,
      );
    });
  }

  it("is testing something: those instants do straddle a local midnight", () => {
    // Without this the loop above would pass for a local-date implementation
    // too, because the machine running it happened to sit near UTC.
    process.env.TZ = "Pacific/Kiritimati";
    expect(new Date(LATE).getDate()).not.toBe(new Date(EARLY).getDate());
    process.env.TZ = "UTC";
    expect(new Date(LATE).getDate()).toBe(new Date(EARLY).getDate());
  });

  it("counts whole UTC days from the epoch", () => {
    expect(utcDayIndex(new Date("1970-01-01T00:00:00Z"))).toBe(0);
    expect(utcDayIndex(new Date("1970-01-02T00:00:00Z"))).toBe(1);
    expect(utcDayIndex(new Date("1969-12-31T23:59:59Z"))).toBe(-1);
  });
});

describe("the rotation walking past a map the player has", () => {
  const pool = ["a", "b", "c", "d", "e"].map((id) => map(id));
  const DAY = new Date("2026-08-07T09:00:00Z");
  const today = pickSuggestedMap(pool, DAY, NOTHING)?.id as string;
  const order = pool.map((m) => m.id);
  const next = order[(order.indexOf(today) + 1) % order.length];

  it("offers the day's map when the player does not have it", () => {
    expect(pickSuggestedMap(pool, DAY, NOTHING)?.id).toBe(today);
  });

  it("offers the next one along when they do", () => {
    expect(pickSuggestedMap(pool, DAY, has(`${today}.sd7`))?.id).toBe(next);
  });

  it("leaves the page when they have every one of them", () => {
    const all = has(...order.map((id) => `${id}.sd7`));
    expect(pickSuggestedMap(pool, DAY, all)).toBeNull();
  });

  it("does not move because some other map was installed", () => {
    // The point of walking forward rather than picking out of a filtered list.
    // A filtered list is indexed by its own length, so installing anything at
    // all would renumber it and change the card to an unrelated map.
    const other = order.find((id) => id !== today) as string;
    expect(pickSuggestedMap(pool, DAY, has(`${other}.sd7`))?.id).toBe(today);
  });

  it("gives two players with the same maps the same answer", () => {
    const one = pickSuggestedMap(pool, DAY, has(`${today}.sd7`))?.id;
    const two = pickSuggestedMap(pool, DAY, has(`${today}.sd7`))?.id;
    expect(one).toBe(two);
  });
});

describe("the rotation turning over under an open window", () => {
  const DAY_MS = 86_400_000;
  const HOUR_MS = 3_600_000;
  const NOON = Date.parse("2026-08-07T12:00:00Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOON);
  });
  // Every case unsubscribes its own listeners, so no timer outlives the fake
  // clock. `getTimerCount` is asserted below, which is what would catch one.
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for the instant the day index changes", () => {
    expect(msToNextUtcDay(Date.parse("2026-08-07T23:00:00Z"))).toBe(HOUR_MS);
    expect(msToNextUtcDay(Date.parse("2026-08-07T00:00:00Z"))).toBe(DAY_MS);
  });

  it("waits a second rather than spinning when it fires a hair early", () => {
    expect(msToNextUtcDay(Date.parse("2026-08-08T00:00:00Z") - 1)).toBe(1_000);
  });

  it("turns over where it stands, without the page being revisited", () => {
    const seen: number[] = [];
    const stop = subscribeUtcDay(() => seen.push(utcDayNow()));
    const start = utcDayNow();
    vi.advanceTimersByTime(12 * HOUR_MS);
    stop();
    expect(seen).toEqual([start + 1]);
  });

  it("keeps stepping on every following midnight", () => {
    const seen: number[] = [];
    const stop = subscribeUtcDay(() => seen.push(utcDayNow()));
    const start = utcDayNow();
    vi.advanceTimersByTime(12 * HOUR_MS + 2 * DAY_MS);
    stop();
    expect(seen).toEqual([start + 1, start + 2, start + 3]);
  });

  it("hands every reader the same day from the one tick", () => {
    // The point of the store. The suggested map is resolved twice per render,
    // once for the claim and once for the card (issue #1077), and a timer each
    // would let them cross midnight in separate tasks.
    const seen: number[] = [];
    const first = subscribeUtcDay(() => seen.push(utcDayNow()));
    const second = subscribeUtcDay(() => seen.push(utcDayNow()));
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(12 * HOUR_MS);
    first();
    second();
    expect(seen).toEqual([utcDayNow(), utcDayNow()]);
  });

  it("runs no timer while nothing is reading it", () => {
    const first = subscribeUtcDay(() => {});
    const second = subscribeUtcDay(() => {});
    first();
    expect(vi.getTimerCount()).toBe(1);
    second();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("is right on its first frame after a day passed with nothing mounted", () => {
    const warm = subscribeUtcDay(() => {});
    const start = utcDayNow();
    warm();
    vi.setSystemTime(NOON + 2 * DAY_MS);
    const stop = subscribeUtcDay(() => {});
    expect(utcDayNow()).toBe(start + 2);
    stop();
  });
});

describe("what the card may offer", () => {
  const MAP: SuggestedMap = {
    id: "fallendell",
    title: "Fallendell",
    filename: "fallendell_v4.sd7",
    download: { kind: "map", springName: "Fallendell_V4" },
  };
  const INPUT: EnqueueInput = {
    kind: "map",
    label: "Fallendell",
    args: { springName: "Fallendell_V4" },
  };
  const base = {
    input: INPUT,
    map: MAP,
    inventory: NOTHING,
    queueStatus: null,
  };

  it("offers the install when the user has neither the file nor the map", () => {
    expect(suggestedMapState(base)).toBe("available");
  });

  it("reads the file on disk as installed", () => {
    expect(
      suggestedMapState({ ...base, inventory: has("fallendell_v4.sd7") }),
    ).toBe("installed");
  });

  it("reads a scanned map name as installed, whatever it is filed under", () => {
    // A map fetched by hand sits under a filename the catalog never predicted.
    expect(
      suggestedMapState({
        ...base,
        map: { ...MAP, filename: "something_else_entirely.sd7" },
        inventory: {
          files: new Set(),
          names: new Set(["fallendell_v4"]),
          known: true,
        },
      }),
    ).toBe("installed");
  });

  it("says so while the download is queued or running", () => {
    expect(suggestedMapState({ ...base, queueStatus: "queued" })).toBe(
      "queued",
    );
    expect(suggestedMapState({ ...base, queueStatus: "active" })).toBe(
      "active",
    );
  });

  it("treats a finished download as installed before the disk is re-read", () => {
    // The card's own download landing is the one way it can be looking at a map
    // the player has, and this is what turns the button into "Installed" in the
    // moment between the queue finishing and the listing being read again.
    expect(suggestedMapState({ ...base, queueStatus: "done" })).toBe(
      "installed",
    );
  });

  it("distinguishes a failure from a fresh offer, so it can say Retry", () => {
    // The map packs fold this into "available". One card carrying one map
    // cannot, because the failure would then be invisible.
    expect(suggestedMapState({ ...base, queueStatus: "error" })).toBe("failed");
  });

  it("goes back to offering the install after a cancel", () => {
    expect(suggestedMapState({ ...base, queueStatus: "canceled" })).toBe(
      "available",
    );
  });

  it("is unavailable when nothing can be queued for it", () => {
    // A direct mirror download with no write root to put the file in.
    expect(suggestedMapState({ ...base, input: null })).toBe("unavailable");
  });

  it("reads the spring name off a map download and nothing else", () => {
    expect(springNameOf(map("a", "A v1"))).toBe("A v1");
    expect(
      springNameOf({
        id: "u",
        title: "u",
        download: {
          kind: "url",
          url: "https://e.test/u.sd7",
          filename: "u.sd7",
        },
      }),
    ).toBeUndefined();
  });
});

describe("where the card goes", () => {
  const page = { zone: true, onboardingMaps: false };
  const settled = { page, loading: false, map: map("a"), noMaps: false };

  it("sits in the Downloads group when the player has maps", () => {
    expect(suggestedMapPlacement(settled)).toBe("cards");
  });

  it("takes the top row when the player has none at all", () => {
    // Getting a first map installed outranks resuming a run, because without a
    // map nothing can be played.
    expect(suggestedMapPlacement({ ...settled, noMaps: true })).toBe("row");
  });

  it("yields the top row while onboarding is offering maps", () => {
    // `GetStartedCard` lists several with a packs banner under them, which is
    // the better offer, so this card does not make a worse one beside it.
    expect(
      suggestedMapPlacement({
        ...settled,
        noMaps: true,
        page: { zone: true, onboardingMaps: true },
      }),
    ).toBe("cards");
  });

  it("takes the top row when onboarding is on the page and saying nothing", () => {
    // The state issue #1109 was raised for: the player dismissed "Set up
    // Coilbox" and has no engine, so the zone is listed and draws nothing. The
    // coarser question, whether the zone was listed, suppressed the promotion
    // against no competing offer at all.
    expect(
      suggestedMapPlacement({
        ...settled,
        noMaps: true,
        page: { zone: true, onboardingMaps: false },
      }),
    ).toBe("row");
  });

  it("leaves the page when there is nothing left to offer", () => {
    expect(suggestedMapPlacement({ ...settled, map: null })).toBe("absent");
    expect(suggestedMapPlacement({ ...settled, map: null, noMaps: true })).toBe(
      "absent",
    );
  });

  it("leaves the page when the profile did not list the zone", () => {
    expect(
      suggestedMapPlacement({
        ...settled,
        page: { zone: false, onboardingMaps: true },
      }),
    ).toBe("absent");
  });

  it("keeps its listed place while the answer is still loading", () => {
    // The placeholder holds the Downloads row's height (issue #1083), and a card
    // that appeared in one place and moved to another would be worse than a wait.
    expect(
      suggestedMapPlacement({ ...settled, loading: true, map: null }),
    ).toBe("cards");
  });

  it("does not promote on a question onboarding has not answered", () => {
    // The caller folds an unread offer into `loading`, so this is the second
    // lock rather than the first. A promotion taken here would be held for the
    // day by `holdSuggestion`, so guessing costs a whole session.
    expect(
      suggestedMapPlacement({
        ...settled,
        noMaps: true,
        page: { zone: true, onboardingMaps: null },
      }),
    ).toBe("cards");
  });
});

describe("holding the answer while the page is open", () => {
  const A = {
    map: map("a"),
    source: "curated" as const,
    placement: "cards" as const,
  };
  const B = {
    map: map("b"),
    source: "curated" as const,
    placement: "cards" as const,
  };
  const BATTLE = {
    map: map("b"),
    source: "battle" as const,
    placement: "cards" as const,
  };

  it("takes the first real answer of the day", () => {
    expect(holdSuggestion(null, 5, A)).toEqual({ day: 5, ...A });
  });

  it("keeps it when the answer changes under the page", () => {
    // Which is what a download landing does: the map the card is showing becomes
    // installed, and the rotation would otherwise walk on to the next one in the
    // same breath as the button said "Installed".
    expect(holdSuggestion({ day: 5, ...A }, 5, B)).toEqual({ day: 5, ...A });
  });

  it("keeps the placement too, so the card does not move once it has landed", () => {
    const promoted = { ...A, placement: "row" as const };
    expect(holdSuggestion({ day: 5, ...promoted }, 5, B).placement).toBe("row");
  });

  it("lets go at the day boundary", () => {
    expect(holdSuggestion({ day: 5, ...A }, 6, B)).toEqual({ day: 6, ...B });
  });

  it("upgrades once to a map people are playing", () => {
    // A lobby connection settles seconds after the page paints, so the first
    // answer of the day is always the rotation's.
    const held = holdSuggestion({ day: 5, ...A }, 5, BATTLE);
    expect(held).toEqual({ day: 5, ...BATTLE });
    expect(holdSuggestion(held, 5, { ...B, source: "battle" })).toBe(held);
  });
});

// --- preferring a map an open battle is using --------------------------------

/** The curated pool the lobby cases pick from, in pool order. */
const POOL = [
  map("Fallendell", "Fallendell_V4"),
  map("SpeedMetal", "SpeedMetal"),
  map("DeltaSiege", "DeltaSiegeDry"),
];

/** One lobby room. `players` are occupants besides the host, as the server sends. */
function room(mapName: string, players: string[] = ["a"]) {
  return {
    map: mapName,
    host: "Autohost",
    members: Object.fromEntries(players.map((p) => [p, {}])),
  } as unknown as suggested.SuggestedLobbySnapshot["battles"][string];
}

/** A live lobby holding the given rooms. */
function lobby(
  ...rooms: ReturnType<typeof room>[]
): suggested.SuggestedLobbySnapshot {
  return {
    battles: Object.fromEntries(rooms.map((r, i) => [String(i), r])),
  };
}

const DAY = new Date("2026-08-07T09:00:00Z");

describe("preferring a map an open battle is using", () => {
  it("falls back to the rotation when no lobby connection is live", () => {
    // `mirror.state` is null until something else connects, so this is the
    // logged-out, offline and never-opened-multiplayer case.
    expect(battleSuggestedMap(POOL, null, NOTHING)).toBeNull();
    const answer = suggestedMapFor(POOL, null, DAY, NOTHING);
    expect(answer.source).toBe("curated");
    expect(answer.map).toBe(pickSuggestedMap(POOL, DAY, NOTHING));
  });

  it("prefers a map people are on when a connection is live", () => {
    const answer = suggestedMapFor(
      POOL,
      lobby(room("SpeedMetal", ["a"])),
      DAY,
      NOTHING,
    );
    expect(answer.map?.id).toBe("SpeedMetal");
    expect(answer.source).toBe("battle");
    // Worth having only if it actually differs from what the day would give.
    expect(answer.map).not.toBe(pickSuggestedMap(POOL, DAY, NOTHING));
  });

  it("falls back when a live connection has no rooms at all", () => {
    expect(suggestedMapFor(POOL, lobby(), DAY, NOTHING).source).toBe("curated");
  });

  it("falls back when the only room is on a map it cannot offer", () => {
    // Nothing in the pool has a verified download for this, and inventing one
    // would feature a map that may not be downloadable anywhere.
    expect(
      battleSuggestedMap(POOL, lobby(room("Some Random Map v9")), NOTHING),
    ).toBeNull();
  });

  it("will not follow a version the curated entry is not", () => {
    // Offering Supreme Isthmus v2.1 because a room is on v2.2 would feature a
    // map that still would not let the player into that room.
    const pool = [map("Isthmus", "Supreme Isthmus v2.1")];
    expect(
      battleSuggestedMap(pool, lobby(room("Supreme Isthmus v2.2")), NOTHING),
    ).toBeNull();
  });

  it("matches the spring name whatever case the server sends it in", () => {
    expect(
      battleSuggestedMap(POOL, lobby(room("fallendell_v4")), NOTHING)?.id,
    ).toBe("Fallendell");
  });

  it("ignores an autohost sitting alone in an empty room", () => {
    // The host is always counted, so a room of one is a bot waiting rather than
    // people playing, and the card would be claiming something untrue.
    expect(
      battleSuggestedMap(POOL, lobby(room("SpeedMetal", [])), NOTHING),
    ).toBeNull();
  });

  it("picks the map with the most people, not the most rooms", () => {
    // Three idle pairs must not outrank one full team game.
    const busy = lobby(
      room("SpeedMetal", ["a"]),
      room("SpeedMetal", ["a"]),
      room("SpeedMetal", ["a"]),
      room(
        "DeltaSiegeDry",
        Array.from({ length: 15 }, (_, i) => `p${i}`),
      ),
    );
    expect(battleSuggestedMap(POOL, busy, NOTHING)?.id).toBe("DeltaSiege");
  });

  it("adds up the people across every room on the same map", () => {
    const spread = lobby(
      room("SpeedMetal", ["a", "b", "c"]),
      room("SpeedMetal", ["a", "b", "c"]),
      room("DeltaSiegeDry", ["a", "b", "c", "d", "e"]),
    );
    // 8 on SpeedMetal against 6 on DeltaSiege.
    expect(battleSuggestedMap(POOL, spread, NOTHING)?.id).toBe("SpeedMetal");
  });

  it("breaks a tie by pool order rather than by what the server sent first", () => {
    const tied = [room("DeltaSiegeDry", ["a"]), room("SpeedMetal", ["a"])];
    const forwards = battleSuggestedMap(POOL, lobby(...tied), NOTHING)?.id;
    const backwards = battleSuggestedMap(
      POOL,
      lobby(...[...tied].reverse()),
      NOTHING,
    )?.id;
    // Pool order is Fallendell, SpeedMetal, DeltaSiege, so SpeedMetal wins.
    expect(forwards).toBe("SpeedMetal");
    expect(backwards).toBe("SpeedMetal");
  });

  it("ignores a room whose map is uncurated while following one that is not", () => {
    const mixed = lobby(
      room(
        "Some Random Map v9",
        Array.from({ length: 20 }, (_, i) => `p${i}`),
      ),
      room("DeltaSiegeDry", ["a"]),
    );
    expect(battleSuggestedMap(POOL, mixed, NOTHING)?.id).toBe("DeltaSiege");
  });

  it("passes over a busy map the player already has", () => {
    // The card offers a download, so a map they have is no answer here either.
    // The busiest map they do not have still beats the rotation.
    const busy = lobby(
      room("SpeedMetal", ["a", "b", "c"]),
      room("DeltaSiegeDry", ["a"]),
    );
    expect(battleSuggestedMap(POOL, busy, has("SpeedMetal.sd7"))?.id).toBe(
      "DeltaSiege",
    );
  });

  it("has nothing to prefer when nothing is curated", () => {
    expect(
      battleSuggestedMap([], lobby(room("SpeedMetal", ["a"])), NOTHING),
    ).toBeNull();
  });
});

describe("the rotation, with the lobby out of the picture", () => {
  // The guarantee #995 shipped, restated: a player with no lobby connection must
  // get byte-identical answers to the ones they got before #996 existed.
  it("is untouched over a full cycle when no connection is live", () => {
    const start = Date.parse("2026-08-07T09:00:00Z");
    for (let i = 0; i < POOL.length * 3; i++) {
      const day = new Date(start + i * 86_400_000);
      const answer = suggestedMapFor(POOL, null, day, NOTHING);
      expect(answer.map).toBe(pickSuggestedMap(POOL, day, NOTHING));
      expect(answer.source).toBe("curated");
    }
  });

  it("is untouched when a live connection has nothing worth featuring", () => {
    // Connected, but every room is empty or on an uncurated map.
    const quiet = lobby(
      room("SpeedMetal", []),
      room("Some Random Map v9", ["a"]),
    );
    expect(suggestedMapFor(POOL, quiet, DAY, NOTHING).map).toBe(
      pickSuggestedMap(POOL, DAY, NOTHING),
    );
  });
});

describe("the zone cannot reach for a connection", () => {
  // The whole gate is "a connection happens to be live". Reading the mirror is a
  // plain `useContext`, but nothing stops a later edit from calling `connect` or
  // opening the login popover from this module, which would make the welcome
  // screen demand an account. This asserts on the source so that edit fails here.
  const source = readFileSync(
    new URL("./suggestedMap.ts", import.meta.url),
    "utf8",
  );

  it("takes only the passive reader from the lobby store", () => {
    const imported = /import \{([^}]*)\} from "\.\.\/multiplayer\/store"/.exec(
      source,
    );
    expect(imported?.[1].trim()).toBe("useMultiplayer");
  });

  it("never calls anything that connects, logs in or reads a credential", () => {
    for (const forbidden of [
      "openLoginPopover",
      "lsGetCredential",
      "mpConnect",
      "mpLogin",
      "autoConnect",
      "lobby-servers",
      "keychain",
    ]) {
      expect(source).not.toContain(forbidden);
    }
    // `connect(`, but not the `connected`/`connection` the comments talk about.
    expect(source).not.toMatch(/\bconnect\s*\(/);
  });
});

// --- the card ---------------------------------------------------------------

type Install = ReturnType<typeof suggested.useSuggestedMapInstall>;

/** The page's answer, as `CoilboxHome` publishes it. */
function answer(args: {
  map?: SuggestedMap | null;
  loading?: boolean;
  source?: suggested.SuggestedSource;
  placement?: suggested.SuggestedPlacement;
}): suggested.SuggestedMapAnswer {
  return {
    map: args.map === undefined ? map("Fallendell", "Fallendell_V4") : args.map,
    loading: args.loading ?? false,
    source: args.source ?? "curated",
    placement: args.placement ?? "cards",
    inventory: NOTHING,
  };
}

/** Render the zone under the page's answer, with its two hooks answered directly. */
function render(args: {
  map?: SuggestedMap | null;
  loading?: boolean;
  art?: string;
  source?: suggested.SuggestedSource;
  install?: Partial<Install>;
}): string {
  hooks.install = {
    state: "available",
    error: null,
    canDownload: true,
    noWriteRoot: false,
    download: () => {},
    ...args.install,
  };
  hooks.art = args.art;
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(
        suggested.SuggestedMapContext,
        { value: answer(args) },
        createElement(SuggestedMapZone),
      ),
    ),
  );
}

describe("the suggested map card", () => {
  it("holds the card's footprint while the catalog is still loading", () => {
    const html = render({ loading: true });
    expect(html).toContain("Suggested map");
    expect(html).toContain("animate-pulse");
    expect(html).not.toContain("Install");
  });

  it("reserves the card's height by being the card's parts, not a number", () => {
    // It was `min-h-40`, the height the card had while it stood alone at the
    // foot of the page. In the Downloads group it sets the row's height, so 15px
    // short moved the row and everything under it every time the catalog landed
    // (issue #1083). Built out of the same art window and band as the card, so
    // the two cannot drift apart again.
    const html = render({ loading: true });
    const settled = render({ art: "https://example.test/thumb.jpg" });
    expect(html).not.toContain("min-h-40");
    // The card's shell, the card's art window and the card's band, both sides.
    for (const part of [ART_CARD_CLASS, ART_BAND_CLASS, "min-h-28"]) {
      expect(html, part).toContain(part);
      expect(settled, part).toContain(part);
    }
  });

  it("renders nothing once the catalog is in and curates no maps", () => {
    // The catalog ships in the app bundle and the Rust side falls back to it, so
    // this is a stripped build rather than an offline player.
    expect(render({ map: null })).toBe("");
  });

  it("offers the install with the map's own picture behind it", () => {
    const html = render({ art: "coilbox://localhost/unitsyncthumb/abc.png" });
    expect(html).toContain("coilbox://localhost/unitsyncthumb/abc.png");
    expect(html).toContain("absolute inset-0 size-full object-cover");
    expect(html).toContain("Install");
    expect(html).toContain("Fallendell");
  });

  it("takes the shared card shell rather than its own copy of it", () => {
    // `cardShell.ts` owns why the text over a minimap clears AA in both colour
    // schemes, and measures it against a pure white and a pure black pixel. This
    // is the card claiming that guarantee.
    const html = render({ art: "https://example.test/thumb.jpg" });
    expect(html).toContain(ART_CARD_CLASS);
  });

  it("gives the install button the card's own tokens, not Tailwind's", () => {
    // picoframe's outline variant is `bg-background`, which Tailwind v4 resolves
    // at `:root`. While the card was a dark island that painted the button the
    // light page's white under the band's light text, so it read as blank. The
    // card takes the page's ramp now, so the two agree, and the raw token still
    // has to be what survives the merge: the button's colours come from the same
    // place as the band's rather than from a second source that could drift.
    const html = render({ art: "https://example.test/thumb.jpg" });
    expect(html).toContain("bg-[hsl(var(--background))]");
    expect(html).not.toMatch(/class="[^"]*\bbg-background\b/);
  });

  it("drops to the plain card when there is no picture of the map", () => {
    // A cold offline first run for a map the player does not have: no minimap to
    // render and no cached catalog thumbnail.
    const html = render({ art: undefined });
    expect(html).toContain("bg-card text-card-foreground");
    expect(html).not.toContain("<img");
    expect(html).toContain("lucide-map");
    expect(html).toContain("Install");
  });

  it("links to the map instead of selling it again once installed", () => {
    const html = render({
      art: "coilbox://localhost/unitsyncthumb/abc.png",
      install: { state: "installed" },
    });
    expect(html).toContain('href="/content/maps/Fallendell_V4"');
    expect(html).toContain("Installed");
    expect(html).not.toContain("<button");
  });

  it("says a download is running rather than leaving the button live", () => {
    const html = render({ install: { state: "active" } });
    expect(html).toContain("Downloading");
    expect(html).not.toContain("<button");
  });

  it("says a download is queued", () => {
    expect(render({ install: { state: "queued" } })).toContain("Queued");
  });

  it("shows why a download failed and offers it again", () => {
    const html = render({
      install: { state: "failed", error: "404 Not Found" },
    });
    expect(html).toContain("404 Not Found");
    expect(html).toContain("Retry");
  });

  it("explains the one thing the user must fix when there is no write root", () => {
    const html = render({
      install: { canDownload: false, noWriteRoot: true },
    });
    expect(html).toContain("Downloads settings");
    expect(html).toContain("disabled");
  });

  it("says nothing about a download folder it has not read yet", () => {
    // The folder takes a disk read, so `canDownload` is false on the first
    // render of every launch, configured or not. Keyed on that, the card told a
    // configured user to set a folder they had set, and stood 38px taller while
    // it did (issue #1099). The button stays disabled, because there is
    // genuinely nowhere to write to yet, but the card asserts nothing.
    const html = render({
      install: { canDownload: false, noWriteRoot: false },
    });
    expect(html).not.toContain("Downloads settings");
    expect(html).toContain("disabled");
  });

  it("says why the map is here when it came from a live battle", () => {
    // The only thing on screen that separates the two sources. Without it the
    // feature cannot be confirmed by looking at the card.
    const curated = {
      ...map("Fallendell", "Fallendell_V4"),
      blurb: "2-4 player",
    };
    expect(render({ map: curated, source: "curated" })).toContain("2-4 player");
    const html = render({ map: curated, source: "battle" });
    expect(html).toContain("Being played now");
    expect(html).not.toContain("2-4 player");
  });

  it("still shows a download failure over the reason the map is here", () => {
    const html = render({
      source: "battle",
      install: { state: "failed", error: "404 Not Found" },
    });
    expect(html).toContain("404 Not Found");
    expect(html).not.toContain("Being played now");
  });

  it("does not nag about a write root for a map already installed", () => {
    const html = render({
      install: { state: "installed", canDownload: false, noWriteRoot: true },
    });
    expect(html).not.toContain("Downloads settings");
  });
});

describe("the card in the Downloads group", () => {
  /** The card as the grid renders it, with no heading of its own. */
  function card(args: Parameters<typeof render>[0] = {}): string {
    hooks.install = {
      state: "available",
      error: null,
      canDownload: true,
      download: () => {},
      ...args.install,
    };
    hooks.art = args.art;
    return renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(
          suggested.SuggestedMapContext,
          { value: answer(args) },
          createElement(SuggestedMapCard, {}),
        ),
      ),
    );
  }

  it("drops the heading and the section the group already provides", () => {
    // A label inside a labelled group would read as a group within a group.
    const html = card();
    expect(html).not.toContain("Suggested map");
    expect(html).not.toContain("<section");
    expect(html).toContain("Fallendell");
  });

  it("keeps them when it is standing on its own", () => {
    const html = render({});
    expect(html).toContain("Suggested map");
    expect(html).toContain('aria-labelledby="suggested-map-heading"');
  });

  it("takes the tool card's width, so the row is four of one size", () => {
    // It was `max-w-[33rem]`, which was right at the foot of the page and wrong
    // beside three 16rem cards.
    expect(card()).toContain("sm:w-64");
    expect(card()).not.toContain("max-w-[33rem]");
  });

  it("takes the tool card's art window, so the row is one depth", () => {
    expect(card({ art: "https://example.test/thumb.jpg" })).toContain(
      "min-h-28",
    );
    // The no-art card too, or the icon card would be the short one in the row.
    expect(card({ art: undefined })).toContain("min-h-28");
  });

  it("holds a card-sized footprint while the catalog loads", () => {
    // Inside the group it is a gap in a row of cards, so it has to be the size
    // of one rather than the depth the wide card used to be.
    const html = card({ loading: true });
    expect(html).toContain("animate-pulse");
    expect(html).toContain("sm:w-64");
    expect(html).not.toContain("min-h-52");
  });

  it("still renders nothing when the catalog curates no maps", () => {
    expect(card({ map: null })).toBe("");
  });

  it("keeps the write-root line under the card, not beside it", () => {
    // In the group the card is a flex item, so a sibling paragraph would be a
    // fifth item in the row.
    const html = card({ install: { canDownload: false, noWriteRoot: true } });
    expect(html).toContain("Downloads settings");
    expect(html).toContain("flex w-full flex-col gap-2 sm:w-64");
  });
});

describe("the page's one answer", () => {
  const zoneSource = readFileSync(
    new URL("./zones/SuggestedMap.tsx", import.meta.url),
    "utf8",
  );

  it("refuses to draw a map the page did not decide", () => {
    // The claim against the tool cards and the card have to name one map. A
    // second resolution would agree today and could stop agreeing silently, so
    // the card cannot make one (issue #1077).
    expect(() =>
      renderToStaticMarkup(
        createElement(MemoryRouter, null, createElement(SuggestedMapCard, {})),
      ),
    ).toThrow(/SuggestedMapContext/);
  });

  it("leaves the zone no way to resolve a map of its own", () => {
    expect(zoneSource).not.toMatch(/useSuggestedMap\s*\(/);
    expect(zoneSource).toContain("useSuggestedMapAnswer");
  });

  it("hands the zone whatever the page decided, battle or rotation", () => {
    const html = render({
      map: pictured("Isthmus", "Supreme Isthmus v2.1"),
      source: "battle",
    });
    expect(html).toContain("Isthmus");
    expect(html).toContain("Being played now");
  });
});

describe("the picture the card settles on", () => {
  // One source now, the catalog's thumbnail, and the module has no memory. The
  // other source was the engine's own minimap, which only exists for a map the
  // player has, and the card no longer names one (issue #1102). Everything built
  // to keep the two from swapping under a reader went with it: the localStorage
  // snapshot of PR #1101 and the precedence chain it fed.
  const source = readFileSync(
    new URL("./suggestedMap.ts", import.meta.url),
    "utf8",
  );

  it("asks the engine for nothing, so no minimap is ever rendered", () => {
    // The 1024px render of issue #1100, which was closed without a fix because
    // this is the fix.
    expect(source).not.toContain("useUnitsyncMinimap");
    expect(source).not.toContain("localStorage");
  });

  it("leaves the card one picture, so it has nothing to swap to", () => {
    const html = render({ art: "https://example.test/thumb.jpg" });
    expect(html).toContain("https://example.test/thumb.jpg");
    expect(html).not.toContain("unitsyncthumb");
  });
});

describe("the card promoted to the top of the page", () => {
  /** The card as the resume row renders it. */
  function promoted(args: Parameters<typeof render>[0] = {}): string {
    hooks.install = {
      state: "available",
      error: null,
      canDownload: true,
      noWriteRoot: false,
      download: () => {},
      ...args.install,
    };
    hooks.art = args.art;
    return renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(
          suggested.SuggestedMapContext,
          { value: answer({ ...args, placement: "row" }) },
          createElement(SuggestedMapCard, { variant: "row" }),
        ),
      ),
    );
  }

  it("says what it is, since nothing above it does", () => {
    // The row has no heading of its own, and a visible one would split a row
    // that reads as one block. The rail labels itself the same way.
    const html = promoted();
    expect(html).toContain('aria-label="Suggested map"');
    expect(html).toContain("<section");
    expect(html).not.toContain("suggested-map-heading");
  });

  it("is one element with no wrapper, which is what the row needs", () => {
    // The row collapses on `empty:hidden`, so every child has to be a
    // participant that can render nothing. See `StackedLayout`.
    expect(promoted().startsWith("<section")).toBe(true);
    expect(promoted({ map: null })).toBe("");
  });

  it("keeps the same width it has in the Downloads group", () => {
    // One card standing where a rail card would, rather than a fourth width for
    // the page to explain.
    expect(promoted()).toContain("sm:w-64");
  });

  it("still offers the install it was promoted to offer", () => {
    const html = promoted();
    expect(html).toContain("Install");
    expect(html).toContain("Fallendell");
  });
});
