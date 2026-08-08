import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { twMerge } from "tailwind-merge";
import { afterEach, describe, expect, it, vi } from "vitest";

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
 * What the zone's three hooks answer, swapped per case. The hooks themselves
 * read the download queue, the content roots and a unitsync scan, none of which
 * exist in node. Everything else in the module is the real thing.
 */
const hooks = vi.hoisted(() => ({
  featured: { map: null, loading: false, source: "curated" } as {
    map: unknown;
    loading: boolean;
    source: string;
  },
  install: {} as Record<string, unknown>,
  art: undefined as string | undefined,
}));

vi.mock("./featuredMap", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./featuredMap")>();
  return {
    ...actual,
    useFeaturedMap: () => hooks.featured,
    useFeaturedMapInstall: () => hooks.install,
    useFeaturedMapArt: () => hooks.art,
  };
});

import type { SuggestedMap, SuggestedMapList } from "../content/branding";
import type { EnqueueInput } from "../downloads/DownloadQueueProvider";
import { ART_CARD_CLASS } from "./cardShell";
import * as featured from "./featuredMap";
import FeaturedMapZone from "./zones/FeaturedMap";

const {
  battleFeaturedMap,
  featuredMapFor,
  featuredMapPool,
  featuredMapState,
  pickFeaturedMap,
  springNameOf,
  utcDayIndex,
} = featured;

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

describe("the curated pool", () => {
  it("takes the standalone suggestions and every pack's maps", () => {
    const pool = featuredMapPool(
      [map("a")],
      [pack("p", [map("b")]), pack("q", [map("c")])],
    );
    expect(pool.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("counts a map in both places once, so it is not twice as likely", () => {
    // The catalog's starter pack repeats `suggested.maps` verbatim today.
    const pool = featuredMapPool([map("a")], [pack("p", [map("a"), map("b")])]);
    expect(pool.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("dedupes on the spring name, not the catalog id", () => {
    const one = { ...map("editorial-id", "Shared Map v1") };
    const two = { ...map("legacy-id", "shared map V1") };
    expect(featuredMapPool([one, two], [])).toHaveLength(1);
  });

  it("drops maps nothing can install, so the card never has a dead button", () => {
    // `rapid` is not a map-download kind, so `suggestedMapToInput` returns null
    // for it and the card would render an Unavailable button.
    const rapid: SuggestedMap = {
      id: "r",
      title: "r",
      download: { kind: "rapid", tag: "map:latest" },
    };
    expect(featuredMapPool([rapid, map("a")], []).map((m) => m.id)).toEqual([
      "a",
    ]);
  });

  it("keeps a direct mirror download, which is installable", () => {
    const mirror: SuggestedMap = {
      id: "u",
      title: "u",
      filename: "u.sd7",
      download: {
        kind: "url",
        url: "https://example.test/u.sd7",
        filename: "u.sd7",
      },
    };
    expect(featuredMapPool([mirror], [])).toHaveLength(1);
  });
});

describe("the daily rotation", () => {
  const pool = ["a", "b", "c", "d", "e"].map((id) => map(id));
  const at = (iso: string) => pickFeaturedMap(pool, new Date(iso))?.id;

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
      (_, i) => pickFeaturedMap(pool, new Date(start + i * 86_400_000))?.id,
    );
    expect([...seen].sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("keeps cycling past the end of the pool", () => {
    const start = Date.parse("2026-08-07T09:00:00Z");
    expect(pickFeaturedMap(pool, new Date(start))?.id).toBe(
      pickFeaturedMap(pool, new Date(start + 5 * 86_400_000))?.id,
    );
  });

  it("has nothing to feature when nothing is curated", () => {
    expect(pickFeaturedMap([], new Date())).toBeNull();
  });

  it("does not fall off the pool before 1970", () => {
    // JavaScript's `%` keeps the sign of a negative day index.
    expect(pickFeaturedMap(pool, new Date("1965-01-01T00:00:00Z"))).not.toBe(
      undefined,
    );
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
      expect(pickFeaturedMap(pool, new Date(EARLY))?.id).toBe(
        pickFeaturedMap(pool, new Date(LATE))?.id,
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

describe("what the card may offer", () => {
  const INPUT: EnqueueInput = {
    kind: "map",
    label: "Fallendell",
    args: { springName: "Fallendell_V4" },
  };
  const base = {
    input: INPUT,
    filename: "fallendell_v4.sd7",
    springName: "Fallendell_V4",
    installed: new Set<string>(),
    scanned: new Set<string>(),
    queueStatus: null,
  };

  it("offers the install when the user has neither the file nor the map", () => {
    expect(featuredMapState(base)).toBe("available");
  });

  it("reads the file on disk as installed", () => {
    expect(
      featuredMapState({ ...base, installed: new Set(["fallendell_v4.sd7"]) }),
    ).toBe("installed");
  });

  it("reads a scanned map name as installed, whatever it is filed under", () => {
    // A map fetched by hand sits under a filename the catalog never predicted.
    expect(
      featuredMapState({
        ...base,
        filename: "something_else_entirely.sd7",
        scanned: new Set(["fallendell_v4"]),
      }),
    ).toBe("installed");
  });

  it("says so while the download is queued or running", () => {
    expect(featuredMapState({ ...base, queueStatus: "queued" })).toBe("queued");
    expect(featuredMapState({ ...base, queueStatus: "active" })).toBe("active");
  });

  it("treats a finished download as installed before the disk is re-read", () => {
    expect(featuredMapState({ ...base, queueStatus: "done" })).toBe(
      "installed",
    );
  });

  it("distinguishes a failure from a fresh offer, so it can say Retry", () => {
    // The map packs fold this into "available". One card carrying one map
    // cannot, because the failure would then be invisible.
    expect(featuredMapState({ ...base, queueStatus: "error" })).toBe("failed");
  });

  it("goes back to offering the install after a cancel", () => {
    expect(featuredMapState({ ...base, queueStatus: "canceled" })).toBe(
      "available",
    );
  });

  it("is unavailable when nothing can be queued for it", () => {
    // A direct mirror download with no write root to put the file in.
    expect(featuredMapState({ ...base, input: null })).toBe("unavailable");
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
  } as unknown as featured.FeaturedLobbySnapshot["battles"][string];
}

/** A live lobby holding the given rooms. */
function lobby(
  ...rooms: ReturnType<typeof room>[]
): featured.FeaturedLobbySnapshot {
  return {
    battles: Object.fromEntries(rooms.map((r, i) => [String(i), r])),
  };
}

const DAY = new Date("2026-08-07T09:00:00Z");

describe("preferring a map an open battle is using", () => {
  it("falls back to the rotation when no lobby connection is live", () => {
    // `mirror.state` is null until something else connects, so this is the
    // logged-out, offline and never-opened-multiplayer case.
    expect(battleFeaturedMap(POOL, null)).toBeNull();
    const answer = featuredMapFor(POOL, null, DAY);
    expect(answer.source).toBe("curated");
    expect(answer.map).toBe(pickFeaturedMap(POOL, DAY));
  });

  it("prefers a map people are on when a connection is live", () => {
    const answer = featuredMapFor(POOL, lobby(room("SpeedMetal", ["a"])), DAY);
    expect(answer.map?.id).toBe("SpeedMetal");
    expect(answer.source).toBe("battle");
    // Worth having only if it actually differs from what the day would give.
    expect(answer.map).not.toBe(pickFeaturedMap(POOL, DAY));
  });

  it("falls back when a live connection has no rooms at all", () => {
    expect(featuredMapFor(POOL, lobby(), DAY).source).toBe("curated");
  });

  it("falls back when the only room is on a map it cannot offer", () => {
    // Nothing in the pool has a verified download for this, and inventing one
    // would feature a map that may not be downloadable anywhere.
    expect(
      battleFeaturedMap(POOL, lobby(room("Some Random Map v9"))),
    ).toBeNull();
  });

  it("will not follow a version the curated entry is not", () => {
    // Offering Supreme Isthmus v2.1 because a room is on v2.2 would feature a
    // map that still would not let the player into that room.
    const pool = [map("Isthmus", "Supreme Isthmus v2.1")];
    expect(
      battleFeaturedMap(pool, lobby(room("Supreme Isthmus v2.2"))),
    ).toBeNull();
  });

  it("matches the spring name whatever case the server sends it in", () => {
    expect(battleFeaturedMap(POOL, lobby(room("fallendell_v4")))?.id).toBe(
      "Fallendell",
    );
  });

  it("ignores an autohost sitting alone in an empty room", () => {
    // The host is always counted, so a room of one is a bot waiting rather than
    // people playing, and the card would be claiming something untrue.
    expect(battleFeaturedMap(POOL, lobby(room("SpeedMetal", [])))).toBeNull();
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
    expect(battleFeaturedMap(POOL, busy)?.id).toBe("DeltaSiege");
  });

  it("adds up the people across every room on the same map", () => {
    const spread = lobby(
      room("SpeedMetal", ["a", "b", "c"]),
      room("SpeedMetal", ["a", "b", "c"]),
      room("DeltaSiegeDry", ["a", "b", "c", "d", "e"]),
    );
    // 8 on SpeedMetal against 6 on DeltaSiege.
    expect(battleFeaturedMap(POOL, spread)?.id).toBe("SpeedMetal");
  });

  it("breaks a tie by pool order rather than by what the server sent first", () => {
    const tied = [room("DeltaSiegeDry", ["a"]), room("SpeedMetal", ["a"])];
    const forwards = battleFeaturedMap(POOL, lobby(...tied))?.id;
    const backwards = battleFeaturedMap(
      POOL,
      lobby(...[...tied].reverse()),
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
    expect(battleFeaturedMap(POOL, mixed)?.id).toBe("DeltaSiege");
  });

  it("has nothing to prefer when nothing is curated", () => {
    expect(battleFeaturedMap([], lobby(room("SpeedMetal", ["a"])))).toBeNull();
  });
});

describe("the rotation, with the lobby out of the picture", () => {
  // The guarantee #995 shipped, restated: a player with no lobby connection must
  // get byte-identical answers to the ones they got before #996 existed.
  it("is untouched over a full cycle when no connection is live", () => {
    const start = Date.parse("2026-08-07T09:00:00Z");
    for (let i = 0; i < POOL.length * 3; i++) {
      const day = new Date(start + i * 86_400_000);
      const answer = featuredMapFor(POOL, null, day);
      expect(answer.map).toBe(pickFeaturedMap(POOL, day));
      expect(answer.source).toBe("curated");
    }
  });

  it("is untouched when a live connection has nothing worth featuring", () => {
    // Connected, but every room is empty or on an uncurated map.
    const quiet = lobby(
      room("SpeedMetal", []),
      room("Some Random Map v9", ["a"]),
    );
    expect(featuredMapFor(POOL, quiet, DAY).map).toBe(
      pickFeaturedMap(POOL, DAY),
    );
  });
});

describe("the zone cannot reach for a connection", () => {
  // The whole gate is "a connection happens to be live". Reading the mirror is a
  // plain `useContext`, but nothing stops a later edit from calling `connect` or
  // opening the login popover from this module, which would make the welcome
  // screen demand an account. This asserts on the source so that edit fails here.
  const source = readFileSync(
    new URL("./featuredMap.ts", import.meta.url),
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

type Install = ReturnType<typeof featured.useFeaturedMapInstall>;

/** Render the zone with its three hooks answered directly. */
function render(args: {
  map?: SuggestedMap | null;
  loading?: boolean;
  art?: string;
  source?: featured.FeaturedSource;
  install?: Partial<Install>;
}): string {
  hooks.featured = {
    map: args.map === undefined ? map("Fallendell", "Fallendell_V4") : args.map,
    loading: args.loading ?? false,
    source: args.source ?? "curated",
  };
  hooks.install = {
    state: "available",
    error: null,
    canDownload: true,
    download: () => {},
    ...args.install,
  };
  hooks.art = args.art;
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(FeaturedMapZone)),
  );
}

describe("the featured map card", () => {
  it("holds the card's footprint while the catalog is still loading", () => {
    const html = render({ loading: true });
    expect(html).toContain("Featured map");
    expect(html).toContain("animate-pulse");
    expect(html).not.toContain("Install");
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
    const html = render({ install: { canDownload: false } });
    expect(html).toContain("Downloads settings");
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
      install: { state: "installed", canDownload: false },
    });
    expect(html).not.toContain("Downloads settings");
  });
});
