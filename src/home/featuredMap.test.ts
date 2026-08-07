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

/**
 * What the zone's three hooks answer, swapped per case. The hooks themselves
 * read the download queue, the content roots and a unitsync scan, none of which
 * exist in node. Everything else in the module is the real thing.
 */
const hooks = vi.hoisted(() => ({
  featured: { map: null, loading: false } as {
    map: unknown;
    loading: boolean;
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
import * as featured from "./featuredMap";
import {
  FEATURED_ART_CLASSES,
  default as FeaturedMapZone,
} from "./zones/FeaturedMap";

const {
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

// --- the card ---------------------------------------------------------------

type Install = ReturnType<typeof featured.useFeaturedMapInstall>;

/** Render the zone with its three hooks answered directly. */
function render(args: {
  map?: SuggestedMap | null;
  loading?: boolean;
  art?: string;
  install?: Partial<Install>;
}): string {
  hooks.featured = {
    map: args.map === undefined ? map("Fallendell", "Fallendell_V4") : args.map,
    loading: args.loading ?? false,
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

  it("declares the art card a dark island so its text stays light", () => {
    const html = render({ art: "https://example.test/thumb.jpg" });
    expect(html).toContain("dark bg-[hsl(var(--background))]");
    expect(FEATURED_ART_CLASSES.band).toContain(
      "text-[hsl(var(--foreground))]",
    );
  });

  it("gives the install button the card's own scheme, not the page's", () => {
    // picoframe's outline variant is `bg-background`, which Tailwind v4 resolves
    // at `:root`. Left alone, the button inside the dark band would be painted
    // the light page's white and carry the band's light text, so it would read
    // as blank. The raw token has to be what survives the merge.
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

  it("does not nag about a write root for a map already installed", () => {
    const html = render({
      install: { state: "installed", canDownload: false },
    });
    expect(html).not.toContain("Downloads settings");
  });
});

/**
 * The legibility guarantee for the title and blurb over a minimap.
 *
 * Stronger than the tool cards' version, and it has to be. Theirs bounds the
 * procedural field's brightest pixel, because that is the only art they generate.
 * A minimap is a picture of whatever the map looks like, and the mapper may have
 * made a snowfield, so the worst case here is pure white and nothing weaker will
 * do.
 *
 * The alphas come out of the shipped class strings, so weakening the band in the
 * component re-runs the measurement instead of leaving it stale.
 */

type Rgb = [number, number, number];

/** CSS `hsl()` to sRGB channels, all 0 to 1 except the hue. */
function hsl(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * Math.min(Math.max(s, 0), 1);
  const sector = ((((h % 360) + 360) % 360) / 60) % 6;
  const x = c * (1 - Math.abs((sector % 2) - 1));
  const rgb: Rgb =
    sector < 1
      ? [c, x, 0]
      : sector < 2
        ? [x, c, 0]
        : sector < 3
          ? [0, c, x]
          : sector < 4
            ? [0, x, c]
            : sector < 5
              ? [x, 0, c]
              : [c, 0, x];
  const m = l - c / 2;
  return rgb.map((v) => v + m) as Rgb;
}

/** Straight-alpha composite of `layer` over `base`. */
function over(base: Rgb, layer: Rgb, alpha: number): Rgb {
  return base.map((c, i) => c * (1 - alpha) + layer[i] * alpha) as Rgb;
}

/** WCAG 2.2 relative luminance. */
function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) =>
    v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.2 contrast ratio between two colours. */
function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The alpha in a `hsl(var(--token)/N)` arbitrary value, or 1 if it has none. */
function tokenAlpha(className: string, token: string): number {
  const found = new RegExp(`hsl\\(var\\(--${token}\\)(?:/([0-9.]+))?\\)`).exec(
    className,
  );
  if (!found) throw new Error(`no --${token} in ${className}`);
  return found[1] ? Number(found[1]) : 1;
}

/** picoframe's `.dark` ramp, transcribed from `@picoframe/frame/src/theme.css`. */
const BASE_HUES = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
/** Neutral through the subtle tier to the vivid one, which tops out around 11. */
const BASE_SATS = [0, 1, 2.6, 6, 11];

describe("text over a minimap", () => {
  /** A snowfield, or a void map's blown-out sun. The worst art can do. */
  const art: Rgb = [1, 1, 1];
  const bandAlpha = tokenAlpha(FEATURED_ART_CLASSES.band, "background");
  const textAlpha = tokenAlpha(FEATURED_ART_CLASSES.band, "foreground");
  const dimAlpha = tokenAlpha(FEATURED_ART_CLASSES.dim, "foreground");

  it("dims the art under the band", () => {
    expect(bandAlpha).toBeGreaterThan(0);
    expect(bandAlpha).toBeLessThan(1);
  });

  it("fades in from nothing above the band, so no text sits on the fade", () => {
    expect(FEATURED_ART_CLASSES.fade).toContain("to-transparent");
    expect(FEATURED_ART_CLASSES.fade).toContain("bottom-full");
  });

  for (const hue of BASE_HUES) {
    for (const sat of BASE_SATS) {
      // The dark ramp's --background, which is what the band is painted in.
      const scrim = hsl(hue, (sat * 6) / 100, 0.07);
      const band = over(art, scrim, bandAlpha);
      // The dark ramp's --foreground is achromatic, so the base does not move it.
      const ink = over(band, hsl(0, 0, 0.95), textAlpha);
      const dim = over(band, hsl(0, 0, 0.95), dimAlpha);
      const label = `base hue ${hue} sat ${sat}`;

      it(`clears AA for the map name at ${label}`, () => {
        expect(contrast(ink, band)).toBeGreaterThanOrEqual(4.5);
      });

      it(`clears AA for the blurb at ${label}`, () => {
        expect(contrast(dim, band)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
