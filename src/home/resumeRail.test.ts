import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LobbyAccount, LobbyServer } from "../lobby-servers/config";
import type { ResumeCandidate } from "./continue";

// Vitest runs in node with no DOM, and the published dists of @picoframe/frame
// and its plugin SDK use extensionless relative imports the node resolver won't
// load, so the leaves are stubbed (same approach as continueZone.test.ts). The
// real `./continue` is loaded with only `useResume` replaced, so the cards are
// checked against the shipped per-kind copy rather than a second copy of it
// written here.
vi.mock("@picoframe/frame", () => ({ useSetting: () => [{}, () => {}] }));
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

const resume =
  vi.fn<() => { candidates: ResumeCandidate[]; loading: boolean }>();
vi.mock("./continue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./continue")>()),
  useResume: () => resume(),
}));

const lobby = vi.fn<() => { connected: boolean; busy: boolean }>();
vi.mock("../multiplayer/store", () => ({ useMultiplayer: () => lobby() }));

// The saved-login list and the server catalog are settings, so the hooks are
// replaced and the pure helpers around them (`sortAccountsByRecency`) are real.
const accounts = vi.fn<() => LobbyAccount[]>();
const servers = vi.fn<() => LobbyServer[]>();
vi.mock("../lobby-servers/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lobby-servers/config")>()),
  useLobbyAccounts: () => [{ accounts: accounts() }, () => {}],
  useLastLogin: () => [null, () => {}],
  useCustomServers: () => [{ servers: [] }, () => {}],
  allServers: () => servers(),
}));

import ResumeRail, {
  loginOffer,
  RAIL_CAP,
  RAIL_CARD_CLASS,
  RAIL_DIM_CLASS,
  railCards,
} from "./zones/ResumeRail";

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
const CAMPAIGN = candidate("campaign", "Core Contingency");

const BAR: LobbyServer = {
  id: "bar",
  name: "Beyond All Reason",
  host: "server4.beyondallreason.info",
  port: 8200,
  tls: false,
  allowSelfSigned: false,
};
const TECHA: LobbyServer = { ...BAR, id: "techa", name: "Tech Annihilation" };

function account(
  id: string,
  username: string,
  over: Partial<LobbyAccount> = {},
) {
  return { id, serverId: "bar", username, ...over };
}

const SAVED = account("a1", "AF_");

/** The rail as the markup a browser would get. */
function render(): string {
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(ResumeRail)),
  );
}

/** The visible text of the rendered rail, tags stripped. */
function text(): string {
  return render()
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

beforeEach(() => {
  resume.mockReturnValue({ candidates: [], loading: false });
  lobby.mockReturnValue({ connected: true, busy: false });
  accounts.mockReturnValue([]);
  servers.mockReturnValue([BAR, TECHA]);
});

describe("railCards", () => {
  it("caps four runners-up at three", () => {
    const cards = railCards(
      [HERO, WARPATH, CONQUEST, CAMPAIGN, candidate("battle", "8v8")],
      null,
    );
    expect(cards).toHaveLength(RAIL_CAP);
    expect(cards.map((c) => c.title)).toEqual([
      "Kestrel",
      "Orion Reach",
      "Core Contingency",
    ]);
  });

  it("shows exactly two when there are two runners-up", () => {
    expect(
      railCards([HERO, WARPATH, CONQUEST], null).map((c) => c.title),
    ).toEqual(["Kestrel", "Orion Reach"]);
  });

  it("shows exactly one when there is one runner-up", () => {
    expect(railCards([HERO, WARPATH], null).map((c) => c.title)).toEqual([
      "Kestrel",
    ]);
  });

  it("shows nothing when the hero took the only candidate", () => {
    expect(railCards([HERO], null)).toEqual([]);
  });

  it("shows nothing at all on a fresh install", () => {
    expect(railCards([], null)).toEqual([]);
  });

  it("never takes the head of the list, which is the hero's", () => {
    expect(railCards([HERO, WARPATH], null).map((c) => c.title)).not.toContain(
      "Last setup",
    );
  });

  it("words each card from the collector, not from the zone", () => {
    const [card] = railCards([HERO, CONQUEST], null);
    // The same strings the Continue hero uses for the same run.
    expect(card.label).toBe("Conquest");
    expect(card.action).toBe("Resume conquest");
    expect(card.detail).toBe("Orion Reach detail");
    expect(card.to).toBe("/conquest/Orion Reach");
  });
});

describe("the log-in card's slot", () => {
  const offer = { account: SAVED, server: BAR };

  it("holds a slot rather than competing for one", () => {
    // Four candidates with the hero taking one would fill the rail exactly, so a
    // login card that queued behind them would never appear.
    const cards = railCards([HERO, WARPATH, CONQUEST, CAMPAIGN], offer);
    expect(cards).toHaveLength(RAIL_CAP);
    expect(cards.at(-1)?.title).toBe("AF_");
    expect(cards.map((c) => c.title)).not.toContain("Core Contingency");
  });

  it("comes last, so what you were doing reads first", () => {
    expect(railCards([HERO, WARPATH], offer).map((c) => c.title)).toEqual([
      "Kestrel",
      "AF_",
    ]);
  });

  it("is the whole rail when there is nothing to resume", () => {
    const cards = railCards([], offer);
    expect(cards.map((c) => c.title)).toEqual(["AF_"]);
    expect(cards[0].label).toBe("Multiplayer");
    expect(cards[0].detail).toBe("Beyond All Reason");
    expect(cards[0].action).toBe("Log in");
  });

  it("goes to the login screen, not to a connect", () => {
    // Clicking must never read the keychain, so the card is a link to the panel
    // that already lists this account, with the connect left to the user.
    expect(railCards([], offer)[0].to).toBe("/lobby");
  });
});

describe("loginOffer", () => {
  it("offers the most recently used login", () => {
    const older = account("a1", "Older", { lastUsedAt: 1000 });
    const newer = account("a2", "Newer", { lastUsedAt: 2000 });
    expect(loginOffer([older, newer], null, [BAR])?.account.username).toBe(
      "Newer",
    );
  });

  it("offers a login saved but never connected with", () => {
    // `lastLogin` is null until the first-ever successful connect, so a login
    // added in Settings and not yet used has no timestamp at all.
    expect(loginOffer([SAVED], null, [BAR])?.account.username).toBe("AF_");
  });

  it("names the server the login belongs to", () => {
    expect(loginOffer([SAVED], null, [BAR])?.server.name).toBe(
      "Beyond All Reason",
    );
  });

  it("skips a login whose server the distribution does not allow", () => {
    // A profile that narrows the catalog must not have the home page suggest a
    // server it removed.
    expect(loginOffer([SAVED], null, [TECHA])).toBeNull();
  });

  it("falls through to the next login when the first is disallowed", () => {
    const allowed = account("a2", "Other", { serverId: "techa" });
    expect(loginOffer([SAVED, allowed], null, [TECHA])?.account.username).toBe(
      "Other",
    );
  });

  it("offers nothing when no login is saved", () => {
    expect(loginOffer([], null, [BAR])).toBeNull();
  });
});

describe("the rail on the page", () => {
  it("renders nothing while the sources are still loading", () => {
    // The hero waits for the same flag, so the two arrive together rather than
    // the rail filling in under a settled hero.
    resume.mockReturnValue({ candidates: [HERO, WARPATH], loading: true });
    expect(render()).toBe("");
  });

  it("renders nothing when there is nothing to show", () => {
    expect(render()).toBe("");
  });

  it("shows the kind, title, detail and action of each runner-up", () => {
    resume.mockReturnValue({
      candidates: [HERO, WARPATH, CONQUEST],
      loading: false,
    });
    expect(text()).toBe(
      "Warpath run Kestrel Kestrel detail Resume run " +
        "Conquest Orion Reach Orion Reach detail Resume conquest",
    );
  });

  it("sends each card where its candidate says", () => {
    resume.mockReturnValue({ candidates: [HERO, WARPATH], loading: false });
    expect(render()).toContain('href="/warpath/Kestrel"');
  });

  it("offers a saved login when logged out", () => {
    lobby.mockReturnValue({ connected: false, busy: false });
    accounts.mockReturnValue([SAVED]);
    expect(text()).toBe("Multiplayer AF_ Beyond All Reason Log in");
    expect(render()).toContain('href="/lobby"');
  });

  it("offers no login when already logged in", () => {
    accounts.mockReturnValue([SAVED]);
    expect(render()).toBe("");
  });

  it("offers no login while a connect is in flight", () => {
    // Auto-connect would otherwise flash the offer during boot and withdraw it.
    lobby.mockReturnValue({ connected: false, busy: true });
    accounts.mockReturnValue([SAVED]);
    expect(render()).toBe("");
  });

  it("offers no login when logged out with nothing saved", () => {
    lobby.mockReturnValue({ connected: false, busy: false });
    expect(render()).toBe("");
  });

  it("groups the cards under a label rather than a heading", () => {
    resume.mockReturnValue({ candidates: [HERO, WARPATH], loading: false });
    expect(render()).toContain('aria-label="More to pick up"');
  });
});

/**
 * The legibility guarantee for the card's four lines, measured rather than
 * eyeballed.
 *
 * What this proves: the title and the action, which are the card's own
 * foreground, clear WCAG AA (4.5:1) on the card surface in every base ramp
 * picoframe ships, in both colour schemes. It also proves the two 12px secondary
 * lines use the shared muted token rather than a bespoke ink, which is what makes
 * them somebody else's measurement: `theme/mutedForeground.test.ts` covers the
 * token itself, app-wide, on every surface including this one.
 *
 * What it does not prove: anything about the page backdrop showing through, which
 * it cannot, because `bg-card` is opaque.
 *
 * The colour maths is transcribed from WCAG 2.2 and duplicated from
 * `toolCards.test.ts` rather than shared, because a formula copied into a second
 * test is cheaper to read than an import that has to be chased.
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

/**
 * Every base preset, as `[name, --base-hue, --base-sat, --base-sat-text]`,
 * transcribed from `@picoframe/frame/src/theme.css`. The text knob defaults to
 * the surface knob, which is what the subtle tier leaves it at.
 */
const BASES: [string, number, number, number?][] = [
  ["zinc", 240, 1],
  ["slate", 215, 1.6],
  ["gray", 220, 0.5],
  ["stone", 30, 1.5],
  ["neutral", 0, 0],
  ["rose", 345, 2.4],
  ["red", 2, 2.4],
  ["amber", 40, 2.4],
  ["green", 150, 2.2],
  ["teal", 185, 2.2],
  ["blue", 214, 2.6],
  ["indigo", 250, 2.4],
  ["violet", 276, 2.4],
  ["purple", 280, 7, 2],
  ["sky", 208, 6, 2],
  ["navy", 225, 11, 2],
  ["fuchsia", 330, 6, 2],
  ["orange", 25, 6, 2],
  ["lime", 95, 5.5, 2],
  ["emerald", 160, 6.5, 2],
  ["yellow", 50, 6, 2],
  ["crimson", 350, 6.5, 2],
];

/** `--card` and `--card-foreground` for one base in one scheme. */
function cardTokens(
  hue: number,
  sat: number,
  satText: number,
  dark: boolean,
): { card: Rgb; ink: Rgb } {
  return dark
    ? { card: hsl(hue, (sat * 5) / 100, 0.1), ink: hsl(0, 0, 0.95) }
    : { card: hsl(0, 0, 1), ink: hsl(hue, (satText * 10) / 100, 0.12) };
}

describe("secondary text on a rail card", () => {
  it("uses the shared muted token, not an ink of its own", () => {
    // The rail carried `hsl(var(--card-foreground)/0.65)` while the token failed
    // AA. Now that it does not, a second ink here would only make the rail and
    // the hero above it disagree about what secondary text looks like.
    expect(RAIL_DIM_CLASS).toBe("text-muted-foreground");
  });

  it("keeps the card surface plain, so the token's measurement applies", () => {
    // `theme/mutedForeground.test.ts` measures the token on `--card`, `--muted`
    // and a `bg-primary/5` tint. A surface outside that set, or one that changed
    // on hover, would be unmeasured.
    expect(RAIL_CARD_CLASS).toContain("bg-card");
    expect(RAIL_CARD_CLASS).not.toContain("bg-primary");
    expect(RAIL_CARD_CLASS).not.toContain("hover:bg-");
  });

  for (const dark of [false, true]) {
    for (const [name, hue, sat, satText] of BASES) {
      const { card, ink } = cardTokens(hue, sat, satText ?? sat, dark);
      const scheme = dark ? "dark" : "light";

      it(`clears AA for the title and action on ${name} in ${scheme}`, () => {
        expect(contrast(ink, card)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
