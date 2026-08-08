import type { NavGroup } from "@picoframe/plugin-sdk";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The zone reads the frame (title + nav) and the lobby connection. Vitest runs in
// node with no DOM, and @picoframe/frame's published dist uses extensionless
// relative imports the node resolver won't load, so both are stubbed and the
// component is called as a function (same approach as layout.test.ts).
//
// The theme, `cn` and `Button` are stubbed too, because the last block here
// renders the tool grid off the same nav the greeting read. That pair is the
// subject: the two zones have to agree about which pages have a tool on them.
// Same stubs as linkCard.test.ts, and `cn` is the real tailwind-merge for the
// same reason.
const frame = vi.fn<() => { title: string; nav: NavGroup[] }>();
vi.mock("@picoframe/frame", async () => {
  const { clsx } = await import("clsx");
  const { twMerge } = await import("tailwind-merge");
  return {
    useFrame: () => frame(),
    // A tool card asks which scheme it is drawing art for. Nothing here looks at
    // the art, so the answer only has to be one of the two.
    useTheme: () => ({ resolved: "dark" }),
    cn: (...parts: unknown[]) => twMerge(clsx(parts)),
    Button: ({
      children,
      ...props
    }: { children?: unknown } & Record<string, unknown>) =>
      createElement("button", { type: "button", ...props }, children as never),
  };
});

// The links card opens its chips through the OS opener, which is not there in node.
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: async () => {} }));

type Lobby = {
  activeKey: string | null;
  mirror: { phase: string | null; state: { myUsername: string | null } | null };
};
const lobby = vi.fn<() => Lobby>();
vi.mock("../multiplayer/store", () => ({ useMultiplayer: () => lobby() }));

// The shared resume collector reads five stores off disk and the lobby snapshot.
// The greeting only asks it whether the list is empty, so the list is what the
// test supplies. What goes into that list is `continue.test.ts`'s subject.
const resume = vi.fn<() => { candidates: unknown[]; loading: boolean }>();
vi.mock("./continue", () => ({ useResume: () => resume() }));

import Greeting, {
  type GreetingOverrides,
  greetingCopy,
} from "./zones/Greeting";
import ToolCards from "./zones/ToolCards";

const TOOLS: NavGroup[] = [
  { id: "play", items: [{ id: "skirmish", label: "Skirmish", to: "/play" }] },
];

/** Nav with nothing on it but Home, which the grid never lists. */
const HOME_ONLY: NavGroup[] = [
  { id: "main", items: [{ id: "home", label: "Home", to: "/" }] },
];

/**
 * A distribution narrowed down to nothing but its `profile.links`: a non-empty
 * nav group carrying no route into the app.
 */
const LINKS_ONLY: NavGroup[] = [
  {
    id: "profile-links",
    label: "Community",
    items: [
      { id: "profile-link-0", label: "Discord", href: "https://discord.gg/x" },
      { id: "profile-link-1", label: "Forum", href: "https://forum.example" },
    ],
  },
];

/** Logged out: no connection, nobody to greet. */
const OFFLINE: Lobby = {
  activeKey: null,
  mirror: { phase: null, state: null },
};

/** Connected and accepted, so the server has told us our name. */
function online(name: string): Lobby {
  return {
    activeKey: "server:1",
    mirror: { phase: "ready", state: { myUsername: name } },
  };
}

/** One of the greeting's rendered elements, or the `false` of an unrendered one. */
type Line = false | { props: { children: string; className: string } };

/**
 * The heading and the line (or lines) the rendered zone puts on the page.
 *
 * `tagline` is the one a page with a tool card shows. `taglineWithoutTools` is
 * the alternative, null when the state already settled which sentence is right
 * and only one is on the page.
 */
function render(overrides?: GreetingOverrides) {
  const node = Greeting(overrides) as unknown as {
    props: { children: [{ props: { children: string } }, Line, Line] };
  };
  const [heading, tagline, without] = node.props.children;
  return {
    heading: heading.props.children,
    tagline: tagline ? tagline.props.children : null,
    taglineWithoutTools: without ? without.props.children : null,
    /** The classes that decide which of the two the browser shows. */
    classes: [tagline, without]
      .filter((p): p is Exclude<Line, false> => p !== false)
      .map((p) => p.props.className)
      .join(" "),
  };
}

/** The tool grid off the same nav the greeting read, as markup. */
function grid(): string {
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(ToolCards)),
  );
}

beforeEach(() => {
  frame.mockReturnValue({ title: "Coilbox", nav: TOOLS });
  lobby.mockReturnValue(OFFLINE);
  resume.mockReturnValue({ candidates: [], loading: false });
});

describe("greetingCopy", () => {
  it("greets a logged-in player by name", () => {
    const { heading } = greetingCopy({
      title: "Coilbox",
      username: "Zephyr",
      hasResume: false,
    });
    expect(heading).toBe("Welcome back, Zephyr");
  });

  it("falls back to the app title when nobody is logged in", () => {
    const { heading } = greetingCopy({
      title: "Beyond All Reason",
      username: null,
      hasResume: false,
    });
    expect(heading).toBe("Beyond All Reason");
  });

  it("points at what you were doing when there is something to resume", () => {
    const copy = greetingCopy({
      title: "Coilbox",
      username: null,
      hasResume: true,
    });
    expect(copy.tagline).toBe("Pick up where you left off.");
    // Settled here, so the page carries one sentence and needs no second.
    expect(copy.taglineWithoutTools).toBeNull();
  });

  it("hands back both tool lines when there is nothing to resume", () => {
    // Which is true depends on what the grid drew, and the grid draws after a
    // per-item `useVisible` this function cannot call (#1066). So both go on the
    // page and the browser picks.
    const copy = greetingCopy({
      title: "Coilbox",
      username: null,
      hasResume: false,
    });
    expect(copy.tagline).toBe("Choose a tool to get started.");
    expect(copy.taglineWithoutTools).toBe("No tools available yet.");
  });
});

describe("greetingCopy with a distribution's own wording", () => {
  const state = { title: "Coilbox", username: "Zephyr", hasResume: true };

  it("replaces the heading even for a logged-in player", () => {
    // A distribution that names its own front door means it, so the name
    // greeting does not survive over the top of it.
    expect(greetingCopy(state, { title: "Splinter Faction" }).heading).toBe(
      "Splinter Faction",
    );
  });

  it("replaces the tagline whatever the state would have said", () => {
    const copy = greetingCopy(
      { ...state, hasResume: false },
      { tagline: "Fight on." },
    );
    expect(copy.tagline).toBe("Fight on.");
    // The distribution wrote one sentence, so the page shows that one and does
    // not go looking at the grid for a second opinion.
    expect(copy.taglineWithoutTools).toBeNull();
  });

  it("overrides each line independently", () => {
    const copy = greetingCopy(state, { tagline: "Fight on." });
    expect(copy.heading).toBe("Welcome back, Zephyr");
  });

  it("keeps Coilbox's wording when the distribution supplies none", () => {
    expect(greetingCopy(state, {})).toEqual(greetingCopy(state));
  });
});

describe("Greeting zone", () => {
  it("shows the app title and the action line when logged out", () => {
    const r = render();
    expect(r.heading).toBe("Coilbox");
    expect(r.tagline).toBe("Choose a tool to get started.");
  });

  it("shows the distribution's title, not a hardcoded one", () => {
    frame.mockReturnValue({ title: "Splinter Faction", nav: TOOLS });
    expect(render().heading).toBe("Splinter Faction");
  });

  it("greets the lobby name once the login is accepted", () => {
    lobby.mockReturnValue(online("Zephyr"));
    expect(render().heading).toBe("Welcome back, Zephyr");
  });

  it("keeps the title while a connection is still in progress", () => {
    // Mid-handshake the account being dialled is still a guess, so the heading
    // waits for the server to accept it rather than changing twice.
    lobby.mockReturnValue({
      activeKey: "server:1",
      mirror: { phase: "registered", state: null },
    });
    expect(render().heading).toBe("Coilbox");
  });

  it("keeps the title when a connection is up but unnamed", () => {
    lobby.mockReturnValue({
      activeKey: "server:1",
      mirror: { phase: "ready", state: { myUsername: null } },
    });
    expect(render().heading).toBe("Coilbox");
  });

  it("offers to resume when the collector found something", () => {
    resume.mockReturnValue({
      candidates: [{ id: "warpath:run-1" }],
      loading: false,
    });
    expect(render().tagline).toBe("Pick up where you left off.");
  });

  it("waits for the sources before promising a resume", () => {
    // The hero and the rail both wait for `loading`, so a greeting that did not
    // would promise "Pick up where you left off." over a page with nothing on it
    // to pick up (#1002).
    resume.mockReturnValue({
      candidates: [{ id: "warpath:run-1" }],
      loading: true,
    });
    expect(render().tagline).toBe("Choose a tool to get started.");
  });

  it("sends you to the tools when the collector found nothing", () => {
    // A fresh install, and the first frame of every install: the sources load
    // from disk, so an empty list is what the greeting sees until they answer.
    lobby.mockReturnValue(online("Zephyr"));
    expect(render().tagline).toBe("Choose a tool to get started.");
  });

  it("says what the zone entry told it to", () => {
    // The layout hands these down from `{ "zone": "greeting", ... }`, so the
    // zone stays a pure function of what it is given and never reads a profile.
    lobby.mockReturnValue(online("Zephyr"));
    const r = render({ title: "Splinter Faction", tagline: "Fight on." });
    expect(r.heading).toBe("Splinter Faction");
    expect(r.tagline).toBe("Fight on.");
    expect(r.taglineWithoutTools).toBeNull();
  });
});

/**
 * The one fact the greeting and the tool grid share: the marker a drawn tool card
 * leaves behind.
 *
 * Every case here renders both zones off the one nav and checks they agree. The
 * greeting carries both sentences and names the marker in the classes that hide
 * one of them, so "does the page say there are tools?" is answered by whether the
 * grid left a marker to find, and nothing else. Counting the nav could not answer
 * it: a nav item's `useVisible` is a hook, and only the card that calls it knows
 * whether it drew (#1066).
 */
describe("the greeting and the tool grid", () => {
  /** The marker the grid leaves, and the greeting waits for. */
  const MARKER = "data-tool-card";

  it("names the same marker in both zones", () => {
    expect(grid()).toContain(MARKER);
    expect(render().classes).toContain(`[${MARKER}]`);
  });

  it("draws no marker when every tool in the nav is gated off", () => {
    // The case the app cannot reach, because Skirmish is never gated. A
    // distribution can: `useAdvancedMode` gates every item in the Animation and
    // Mapconv groups, and `profile.hide` gates several more.
    frame.mockReturnValue({
      title: "Coilbox",
      nav: [
        {
          id: "animation",
          label: "Animation",
          items: [
            {
              id: "animation.cob",
              label: "COB tools",
              to: "/animation/cob",
              useVisible: () => false,
            },
          ],
        },
      ],
    });
    expect(grid()).not.toContain(MARKER);
    expect(render().taglineWithoutTools).toBe("No tools available yet.");
  });

  it("draws no marker for a nav of external links and nothing else", () => {
    // #1057, and still true: a link is a way out of Coilbox rather than
    // something to do in it, so it gets a chip in the links card and no marker.
    frame.mockReturnValue({ title: "Coilbox", nav: LINKS_ONLY });
    const html = grid();
    expect(html).not.toContain(MARKER);
    expect(html).toContain("data-link-card");
    // The links are the only thing a distribution narrowed this far has left,
    // and the fix would be a worse bug if the page lost them.
    expect(html).toContain("Discord");
    expect(html).toContain("Forum");
  });

  it("draws no marker when the nav lists only Home", () => {
    frame.mockReturnValue({ title: "Coilbox", nav: HOME_ONLY });
    expect(grid()).toBe("");
  });

  it("draws a marker when a group mixes tools and links", () => {
    // The reference links the Animation, Mapconv and Lego plugins declare sit in
    // the same group as the tools they are references for. One visible tool in
    // the group is enough: there is something to choose.
    frame.mockReturnValue({
      title: "Coilbox",
      nav: [
        {
          id: "animation",
          label: "Animation",
          items: [
            { id: "animation.cob", label: "COB tools", to: "/animation/cob" },
            {
              id: "animation.skeletor-s3o",
              label: "Skeletor S3O",
              href: "https://github.com/Beherith/Skeletor_S3O",
              sidebar: false,
            },
          ],
        },
      ],
    });
    expect(grid()).toContain(MARKER);
  });
});
