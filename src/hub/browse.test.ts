import { afterEach, describe, expect, it, vi } from "vitest";
import type { HubItem } from "./api";
import {
  describePinnedGame,
  loadBrowsePage,
  MAX_SCAN_PAGES,
  matchesPinnedGame,
} from "./browse";

const BASE = "https://hub.example";

/** A matcher of the shape `getGameMatcher()` returns. */
const splinter = (name: string) => /^splinter/i.test(name);

function item(id: string, game: string | null): HubItem {
  return {
    id,
    kind: "preset",
    mode: null,
    title: id,
    description: "",
    game_name: game,
    map_name: null,
    tags: [],
    author_name: "somebody",
    created_at: "2026-08-09T00:00:00Z",
  };
}

/**
 * Stub `fetch` with a gallery of `items`, paged the way the hub pages it. Records
 * the page numbers asked for.
 */
function stubGallery(items: HubItem[], pageSize = 4) {
  const asked: number[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const page = Number(new URL(url).searchParams.get("page") ?? "1");
      asked.push(page);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          format: "coilbox-hub-items",
          version: 1,
          page,
          page_size: pageSize,
          total: items.length,
          items: items.slice((page - 1) * pageSize, page * pageSize),
        }),
      } as unknown as Response;
    }),
  );
  return asked;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("matchesPinnedGame", () => {
  it("keeps everything when the distribution pinned nothing", () => {
    expect(matchesPinnedGame("Balanced Annihilation", null)).toBe(true);
    expect(matchesPinnedGame(null, null)).toBe(true);
  });

  it("keeps an item with no game of its own", () => {
    expect(matchesPinnedGame(null, splinter)).toBe(true);
    expect(matchesPinnedGame("   ", splinter)).toBe(true);
  });

  it("matches the versioned name the hub stores", () => {
    expect(matchesPinnedGame("SplinterFaction 0.1.78", splinter)).toBe(true);
    expect(matchesPinnedGame("Beyond All Reason 1.2", splinter)).toBe(false);
  });
});

describe("describePinnedGame", () => {
  it("names what the profile named", () => {
    expect(describePinnedGame({ names: ["Splinter Faction"] })).toBe(
      "Splinter Faction",
    );
    expect(describePinnedGame({ names: ["One", "Two"] })).toBe("One or Two");
  });

  it("has no name to show for a regex, or for no filter at all", () => {
    expect(describePinnedGame({ regex: "^Splinter" })).toBeNull();
    expect(describePinnedGame({ names: ["  "] })).toBeNull();
    expect(describePinnedGame(undefined)).toBeNull();
  });
});

describe("loadBrowsePage", () => {
  it("passes the server's own paging through when nothing is pinned", async () => {
    const asked = stubGallery(
      Array.from({ length: 9 }, (_, i) => item(`i${i}`, "Anything")),
    );
    const result = await loadBrowsePage(BASE, { page: 2 }, null);
    expect(asked).toEqual([2]);
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.items.map((i) => i.id)).toEqual([
      "i4",
      "i5",
      "i6",
      "i7",
    ]);
    expect(result.value).toMatchObject({
      total: 9,
      page: 2,
      lastPage: 3,
      truncated: null,
    });
  });

  it("counts and pages what the reader sees, not what the server holds", async () => {
    const gallery = [
      item("a", "SplinterFaction 0.1.78"),
      item("b", "Beyond All Reason 1.2"),
      item("c", null),
      item("d", "Beyond All Reason 1.2"),
      item("e", "Splinter Faction 0.1.79"),
      item("f", "Beyond All Reason 1.2"),
      item("g", "Beyond All Reason 1.2"),
      item("h", "SplinterFaction 0.1.78"),
      item("i", "Beyond All Reason 1.2"),
    ];
    const asked = stubGallery(gallery);
    const first = await loadBrowsePage(BASE, { page: 1 }, splinter);
    // Every page the server holds is read, so the count is of the whole set.
    expect(asked).toEqual([1, 2, 3]);
    if (!first.ok) throw new Error(first.reason);
    expect(first.value.items.map((i) => i.id)).toEqual(["a", "c", "e", "h"]);
    expect(first.value).toMatchObject({ total: 4, page: 1, lastPage: 1 });
  });

  it("pages the kept items itself", async () => {
    stubGallery(
      Array.from({ length: 12 }, (_, i) =>
        item(`i${i}`, i % 2 === 0 ? "Splinter Faction 1" : "Something Else"),
      ),
    );
    const result = await loadBrowsePage(BASE, { page: 2 }, splinter);
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.items.map((i) => i.id)).toEqual(["i8", "i10"]);
    expect(result.value).toMatchObject({ total: 6, page: 2, lastPage: 2 });
  });

  it("clamps a page the kept items no longer reach", async () => {
    stubGallery([item("a", "Splinter Faction 1"), item("b", "Other 1")]);
    const result = await loadBrowsePage(BASE, { page: 7 }, splinter);
    if (!result.ok) throw new Error(result.reason);
    expect(result.value).toMatchObject({ total: 1, page: 1, lastPage: 1 });
  });

  it("stops reading a huge hub and says how much it read", async () => {
    const size = 4;
    stubGallery(
      Array.from({ length: size * (MAX_SCAN_PAGES + 3) }, (_, i) =>
        item(`i${i}`, "Other 1"),
      ),
      size,
    );
    const result = await loadBrowsePage(BASE, {}, splinter);
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.truncated).toEqual({ scanned: size * MAX_SCAN_PAGES });
  });

  it("reports a failure on any page it needed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const page = Number(new URL(url).searchParams.get("page") ?? "1");
        if (page === 2) {
          return {
            ok: false,
            status: 500,
            json: async () => ({ error: "The hub could not answer." }),
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            format: "coilbox-hub-items",
            version: 1,
            page,
            page_size: 4,
            total: 8,
            items: [item("a", "Splinter Faction 1")],
          }),
        } as unknown as Response;
      }),
    );
    const result = await loadBrowsePage(BASE, {}, splinter);
    expect(result.ok).toBe(false);
  });
});
