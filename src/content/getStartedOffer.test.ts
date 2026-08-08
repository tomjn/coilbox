import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { SuggestedMap } from "./branding";

// The module exports its hook alongside the pure function, so loading it pulls
// in picoframe's frame and plugin SDK and the Tauri bindings. Nothing here calls
// the hook, so stubbing the leaves is enough (same approach as
// getStartedCandidates.test.ts).
vi.mock("@picoframe/frame", () => ({ useSetting: () => [{}, () => {}] }));
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));
vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {},
  invoke: async () => ({}),
}));

const { getStartedOffer } = await import("./getStartedOffer");

const map = (id: string): SuggestedMap => ({
  id,
  title: id,
  download: { kind: "map", springName: id },
});

const lists = { games: [], maps: [map("a")] };

const args = {
  setupLoading: false,
  complete: true,
  candidates: lists,
  answered: true,
};

describe("what the get-started card is offering", () => {
  it("is the lists once there are lists", () => {
    expect(getStartedOffer(args)).toBe(lists);
  });

  it("is unknown while the setup status is still being read", () => {
    // Null means unknown here and never "nothing". The home page acts on
    // "onboarding is offering nothing" by taking the top of the page.
    expect(getStartedOffer({ ...args, setupLoading: true })).toBeNull();
  });

  it("is nothing before setup is complete, without waiting for an inventory", () => {
    // The card draws nothing before there is a content folder and an engine, and
    // it never gets as far as reading an inventory, so a reader waiting on one
    // would wait forever. That is the state issue #1109 was raised for.
    expect(
      getStartedOffer({
        ...args,
        complete: false,
        candidates: null,
        answered: false,
      }),
    ).toEqual({ games: [], maps: [] });
  });

  it("is unknown while an inventory is still coming", () => {
    expect(
      getStartedOffer({ ...args, candidates: null, answered: false }),
    ).toBeNull();
  });

  it("is nothing once both inventories answered without producing a list", () => {
    // A scan that errored answers. There is no snapshot to take and there will
    // not be one, so the card draws nothing.
    expect(getStartedOffer({ ...args, candidates: null })).toEqual({
      games: [],
      maps: [],
    });
  });

  it("gives the same object every time it says nothing", () => {
    // The home page holds this answer for the day, so a new object each render
    // would be a new answer each render.
    expect(getStartedOffer({ ...args, complete: false })).toBe(
      getStartedOffer({ ...args, candidates: null }),
    );
  });
});

/**
 * Where the offer is collected, asserted over the whole source tree.
 *
 * The collector holds a per-visit snapshot, so a second caller is a second
 * answer rather than a second read (issue #1111). Everything else reads the one
 * answer through `GetStartedOfferContext`, which throws where there is none, so
 * a reader cannot quietly resolve its own. What that leaves unguarded is a new
 * caller of the collector itself, which no other test would notice.
 */
describe("who collects the get-started offer", () => {
  const src = fileURLToPath(new URL("..", import.meta.url));
  const collectors = readdirSync(src, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."))
    .filter((f) => f !== "content/getStartedOffer.ts")
    .filter((f) =>
      readFileSync(join(src, f), "utf8").includes("useCollectGetStartedOffer"),
    )
    .sort();

  it("is the home route and the onboarding widget, and nowhere else", () => {
    // One per page: the `/` route holds it for both arms of the home page, and
    // the widget body holds it on a distribution's own page, which is not under
    // that route.
    expect(collectors).toEqual([
      "content/pages/components/SetupCard.tsx",
      "home/HomeRoute.tsx",
    ]);
  });
});
