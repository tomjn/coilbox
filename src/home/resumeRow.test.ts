import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LobbyAccount, LobbyServer } from "../lobby-servers/config";
import { resolveHome } from "./config";
import type { ResumeCandidate } from "./continue";

/**
 * The continue hero and the resume rail as the browser gets them: one row, built
 * by the layout out of two zones that know nothing about each other.
 *
 * `stackedLayout.test.ts` covers which wrapper each zone lands in, with every
 * zone stubbed. This file renders the two real zones into real markup, because
 * the claims worth proving here are about what the DOM ends up being:
 *
 * - the row's children are the two zones and nothing else, so `empty:hidden`
 *   has something to match when both stand down
 * - the row is *exactly* empty on a fresh install, tags touching, which is what
 *   makes the block and its top margin disappear rather than leave a gap
 * - either zone alone still fills the row, including the rail without the hero
 *
 * Vitest runs in node with no DOM, and the published dists of `@picoframe/frame`
 * and its plugin SDK use extensionless relative imports the node resolver will
 * not load, so those leaves are stubbed (same approach as `resumeRail.test.ts`).
 * The zones either side of the row are stubbed to nothing so the page markup is
 * short enough to assert whole.
 */
vi.mock("@picoframe/frame", () => ({
  Slot: () => null,
  useSetting: () => [{}, () => {}],
  buttonVariants: () => "button",
  cn: (...parts: unknown[]) => parts.filter(Boolean).join(" "),
}));
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));
vi.mock("./zones/Onboarding", () => ({ default: () => null }));
vi.mock("./zones/Greeting", () => ({ default: () => null }));
vi.mock("./zones/ToolCards", () => ({ default: () => null }));
vi.mock("./zones/SuggestedMap", () => ({ default: () => null }));
vi.mock("./HomeMarkup", () => ({ default: () => null }));
// No backdrop, so the page is the column and what the layout put in it. What the
// backdrop resolves to is `background.test.ts`'s subject.
vi.mock("./background", () => ({
  resolveHomeBackground: () => ({ kind: "none" }),
  backdropStyle: () => null,
}));

const resume =
  vi.fn<() => { candidates: ResumeCandidate[]; loading: boolean }>();
vi.mock("./continue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./continue")>()),
  useResume: () => resume(),
}));

const lobby = vi.fn<() => { connected: boolean; busy: boolean }>();
vi.mock("../multiplayer/store", () => ({ useMultiplayer: () => lobby() }));

const accounts = vi.fn<() => LobbyAccount[]>();
vi.mock("../lobby-servers/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lobby-servers/config")>()),
  useLobbyAccounts: () => [{ accounts: accounts() }, () => {}],
  useLastLogin: () => [null, () => {}],
  useCustomServers: () => [{ servers: [] }, () => {}],
  allServers: () => [BAR],
}));

import StackedLayout from "./StackedLayout";

const BAR: LobbyServer = {
  id: "bar",
  name: "Beyond All Reason",
  host: "server4.beyondallreason.info",
  port: 8200,
  tls: false,
  allowSelfSigned: false,
};

const SAVED: LobbyAccount = { id: "a1", serverId: "bar", username: "AF_" };

function candidate(
  kind: ResumeCandidate["kind"],
  title: string,
): ResumeCandidate {
  return {
    id: `${kind}:${title}`,
    kind,
    title,
    detail: `${title} detail`,
    to: `/${kind}/${title}`,
    touchedAt: Date.parse("2026-08-01T12:00:00Z"),
  };
}

const HERO = candidate("skirmish", "Last setup");
const WARPATH = candidate("warpath", "Kestrel");
const CONQUEST = candidate("conquest", "Orion Reach");

/** The row's class, repeated here so a change to it has to be deliberate. */
const ROW =
  'class="mt-6 flex flex-col gap-3 empty:hidden sm:flex-row sm:flex-wrap sm:items-start"';

/**
 * The two zones on a page of their own, as the markup a browser would get.
 *
 * Just the pair, so the whole page can be asserted character for character and
 * the empty case is a claim about this row rather than about the four other
 * zones' wrappers. They are adjacent in the stock order too, which
 * `stackedLayout.test.ts` covers.
 */
function page(): string {
  const { entries } = resolveHome({
    zones: [{ zone: "continue" }, { zone: "resume" }],
  });
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(StackedLayout, { entries, background: undefined }),
    ),
  );
}

/** The visible text of the page, tags stripped. */
function text(): string {
  return page()
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

beforeEach(() => {
  resume.mockReturnValue({ candidates: [], loading: false });
  lobby.mockReturnValue({ connected: true, busy: false });
  accounts.mockReturnValue([]);
});

describe("the resume row", () => {
  it("puts the hero and the rail inside one row, in that order", () => {
    resume.mockReturnValue({
      candidates: [HERO, WARPATH, CONQUEST],
      loading: false,
    });
    const html = page();
    const row = html.indexOf(ROW);
    const hero = html.indexOf('aria-labelledby="home-continue-title"');
    const rail = html.indexOf('aria-label="More to pick up"');
    expect(row).toBeGreaterThan(-1);
    expect(row).toBeLessThan(hero);
    expect(hero).toBeLessThan(rail);
  });

  it("puts nothing between the row and the two zones", () => {
    // A wrapper each would keep the row from ever being `:empty`, which is the
    // whole mechanism the fresh-install case rests on.
    resume.mockReturnValue({ candidates: [HERO, WARPATH], loading: false });
    expect(page()).toContain(`<div ${ROW}><section`);
  });

  it("gives the hero the width the layout chose", () => {
    resume.mockReturnValue({ candidates: [HERO], loading: false });
    expect(page()).toContain("min-w-0 sm:max-w-2xl");
  });

  it("leaves the hero no room to push its action away from its text", () => {
    // The gap the action used to sit in was whatever the rail left over, so the
    // page with one thing to resume showed the widest one (#1059). A card with no
    // grow and no `justify-between` has neither the room nor the instruction.
    resume.mockReturnValue({ candidates: [HERO], loading: false });
    const html = page();
    expect(html).not.toContain("justify-between");
    expect(html).not.toContain("flex-[1_1_32rem]");
  });

  it("shows the hero and the runners-up together", () => {
    resume.mockReturnValue({
      candidates: [HERO, WARPATH, CONQUEST],
      loading: false,
    });
    expect(text()).toBe(
      "Skirmish setup Last setup Last setup detail Open setup " +
        "Warpath run Kestrel Kestrel detail Resume run " +
        "Conquest Orion Reach Orion Reach detail Resume conquest",
    );
  });
});

describe("the resume row with one half missing", () => {
  it("holds the hero alone when there is only one thing to resume", () => {
    resume.mockReturnValue({ candidates: [HERO], loading: false });
    const html = page();
    expect(html).toContain('aria-labelledby="home-continue-title"');
    expect(html).not.toContain('aria-label="More to pick up"');
    expect(html).toContain(ROW);
  });

  it("holds the rail alone when the only card is a saved login", () => {
    // Reachable: the hero takes `candidates[0]` and there is none, but the rail
    // offers a login the collector knows nothing about. A logged-out install
    // with an account saved and nothing played is exactly this page.
    lobby.mockReturnValue({ connected: false, busy: false });
    accounts.mockReturnValue([SAVED]);
    const html = page();
    expect(html).not.toContain('aria-labelledby="home-continue-title"');
    expect(html).toContain('aria-label="More to pick up"');
    expect(text()).toBe("Multiplayer AF_ Beyond All Reason Log in");
  });
});

describe("the resume row with nothing to show", () => {
  /** The whole page when neither zone drew anything: an empty row and nothing else. */
  const BARE = `<div class="relative min-h-full"><div class="relative p-8"><div ${ROW}></div></div></div>`;

  it("leaves the row with no children at all on a fresh install", () => {
    // Tags touching, so `:empty` matches and the row takes its own top margin
    // with it. Anything between them, even a wrapper, would leave a 1.5rem gap
    // above the tool cards on a page that has nothing to resume.
    expect(page()).toBe(BARE);
  });

  it("leaves the row empty while the sources are still loading", () => {
    // Both zones wait on the same flag, so the row fills in one go rather than
    // the rail appearing under a settled hero.
    resume.mockReturnValue({
      candidates: [HERO, WARPATH],
      loading: true,
    });
    expect(page()).toBe(BARE);
  });

  it("leaves the row empty when logged out with no login saved", () => {
    lobby.mockReturnValue({ connected: false, busy: false });
    expect(page()).toBe(BARE);
  });
});
