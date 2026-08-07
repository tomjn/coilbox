import type { NavGroup } from "@picoframe/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The zone reads the frame (title + nav) and the lobby connection. Vitest runs in
// node with no DOM, and @picoframe/frame's published dist uses extensionless
// relative imports the node resolver won't load, so both are stubbed and the
// component is called as a function (same approach as layout.test.ts).
const frame = vi.fn<() => { title: string; nav: NavGroup[] }>();
vi.mock("@picoframe/frame", () => ({ useFrame: () => frame() }));

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

import Greeting, { greetingCopy } from "./zones/Greeting";

const TOOLS: NavGroup[] = [
  { id: "play", items: [{ id: "skirmish", label: "Skirmish", to: "/play" }] },
];

/** Nav with nothing on it but Home, which the grid never lists. */
const HOME_ONLY: NavGroup[] = [
  { id: "main", items: [{ id: "home", label: "Home", to: "/" }] },
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

/** The heading and tagline the rendered zone puts on the page. */
function render() {
  const node = Greeting() as unknown as {
    props: { children: { props: { children: string } }[] };
  };
  const [heading, tagline] = node.props.children;
  return { heading: heading.props.children, tagline: tagline.props.children };
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
      hasTools: true,
    });
    expect(heading).toBe("Welcome back, Zephyr");
  });

  it("falls back to the app title when nobody is logged in", () => {
    const { heading } = greetingCopy({
      title: "Beyond All Reason",
      username: null,
      hasResume: false,
      hasTools: true,
    });
    expect(heading).toBe("Beyond All Reason");
  });

  it("points at what you were doing when there is something to resume", () => {
    const { tagline } = greetingCopy({
      title: "Coilbox",
      username: null,
      hasResume: true,
      hasTools: true,
    });
    expect(tagline).toBe("Pick up where you left off.");
  });

  it("sends you to the tools when there is nothing to resume", () => {
    const { tagline } = greetingCopy({
      title: "Coilbox",
      username: null,
      hasResume: false,
      hasTools: true,
    });
    expect(tagline).toBe("Choose a tool to get started.");
  });

  it("says so when there are no tools to choose from", () => {
    // The line picoframe's launcher showed for an empty grid. The greeting owns
    // it now, so the page never invites you to choose from nothing.
    const { tagline } = greetingCopy({
      title: "Coilbox",
      username: null,
      hasResume: false,
      hasTools: false,
    });
    expect(tagline).toBe("No tools available yet.");
  });

  it("prefers the resume line over the empty-grid line", () => {
    const { tagline } = greetingCopy({
      title: "Coilbox",
      username: null,
      hasResume: true,
      hasTools: false,
    });
    expect(tagline).toBe("Pick up where you left off.");
  });
});

describe("Greeting zone", () => {
  it("shows the app title and the action line when logged out", () => {
    expect(render()).toEqual({
      heading: "Coilbox",
      tagline: "Choose a tool to get started.",
    });
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

  it("says there are no tools when the nav lists only Home", () => {
    frame.mockReturnValue({ title: "Coilbox", nav: HOME_ONLY });
    expect(render().tagline).toBe("No tools available yet.");
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
});
