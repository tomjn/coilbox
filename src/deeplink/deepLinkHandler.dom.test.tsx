// @vitest-environment happy-dom

/**
 * What the deep-link handler does with a second link while the first is still
 * being asked about (issue #3409).
 *
 * A link is written by whoever sent it, so the button a player has read must
 * keep doing what the words above it said. One prompt is open at a time across
 * all four kinds, and a link that arrives while one is open is refused with a
 * notice, whatever kinds the two are.
 *
 * The router, the fetch and the notice are stood in for or watched, so nothing
 * leaves the test and nothing is dialled.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeContainerCode } from "../container/container";
import {
  resetInviteStore,
  useInviteState,
} from "../multiplayer/invite/inviteStore";
import { dispatchDeepLink } from "./bus";
import { DeepLinkHandler } from "./DeepLinkHandler";

vi.mock("@tauri-apps/plugin-deep-link", () => ({
  getCurrent: async () => null,
  onOpenUrl: async () => () => {},
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: async () => {},
}));

vi.mock("../hub/config", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("../hub/config")),
  useTrustedHubUrl: () => "https://hub.example",
}));

const notify = vi.fn();
vi.mock("../notify/notify", () => ({
  notify: (input: unknown) => notify(input),
}));

const fetchImportPlan = vi.fn(
  (_url: string, _fetch: unknown): Promise<never> => new Promise(() => {}),
);
vi.mock("./fetchImport", () => ({
  fetchImportPlan: (url: string, fetch: unknown) => fetchImportPlan(url, fetch),
}));

const BUSY =
  "Another link is still open. Answer or close it, then open this link again.";

const code = encodeContainerCode("preset", 1, {
  participants: [],
  gameName: "Balanced Annihilation",
  mapName: "Comet Catcher",
  startPosType: 2,
  modOptionValues: {},
});

/** One link of each kind, with what the dialog it opens says and what its
 * confirm button is called. */
const LINKS = {
  room: {
    url: "coilbox://room?address=192.168.1.45&port=8200",
    says: "Join the room at 192.168.1.45:8200?",
    confirm: "Open the join form",
  },
  open: {
    url: "coilbox://open?screen=map&id=Comet%20Catcher",
    says: 'Open the map "Comet Catcher".',
    confirm: "Open",
  },
  import: {
    url: `coilbox://import?code=${encodeURIComponent(code)}`,
    says: "Import a",
    confirm: "Continue",
  },
  importUrl: {
    url: "coilbox://import?url=https%3A%2F%2Fpaste.example%2Fa.txt",
    says: "This link downloads an import from paste.example.",
    confirm: "Fetch and check",
  },
} as const;

/** A link that is for the second place, and different from every one above. */
const SECOND = {
  room: "coilbox://room?address=10.0.0.9&port=9000",
  open: "coilbox://open?screen=game&id=Evil",
  import: "coilbox://import?url=https%3A%2F%2Fevil.example%2Fb.txt",
  hubShare: "coilbox://import?url=https%3A%2F%2Fhub.example%2Fi%2Fsome-item",
  join: "coilbox://join?server=evil.example%3A8200&battle=1",
};

let where = "";
let state: unknown = null;
function Where() {
  const location = useLocation();
  where = location.pathname + location.search;
  state = location.state;
  return null;
}

let invitePrompt: unknown = null;
function InvitePrompt() {
  invitePrompt = useInviteState().prompt;
  return null;
}

function draw() {
  return render(
    <MemoryRouter initialEntries={["/home"]}>
      <Where />
      <InvitePrompt />
      <DeepLinkHandler>
        <p>app</p>
      </DeepLinkHandler>
    </MemoryRouter>,
  );
}

function arrive(url: string) {
  act(() => dispatchDeepLink(url));
}

const press = (name: string | RegExp) =>
  fireEvent.click(screen.getByRole("button", { name }));

const refusals = () =>
  notify.mock.calls.filter(([n]) => (n as { body: string }).body === BUSY);

beforeEach(() => {
  where = "";
  state = null;
  invitePrompt = null;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  resetInviteStore();
});

describe("a room link", () => {
  it("shows the address in the one form a join link's is shown in", () => {
    draw();
    arrive("coilbox://room?address=Tom-Laptop.LOCAL.&port=08200");
    expect(
      screen.getByText("Join the room at tom-laptop.local:8200?"),
    ).toBeTruthy();
    expect(screen.queryByText(/Tom-Laptop/)).toBeNull();
  });

  it("shows an IPv6 address in brackets, with its port (issue #3420)", () => {
    draw();
    arrive("coilbox://room?address=%5B2001%3ADB8%3A%3A1%5D&port=8200");
    expect(
      screen.getByText("Join the room at [2001:db8::1]:8200?"),
    ).toBeTruthy();
  });

  it("is refused with a notice when its address is not an address", () => {
    draw();
    arrive("coilbox://room?address=known%40evil.example&port=8200");
    expect(
      screen.queryByRole("button", { name: "Open the join form" }),
    ).toBeNull();
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Ignored a coilbox link",
        body: "This room link's address is not an address.",
        level: "error",
      }),
    );
  });

  it("hands the form the address the dialog showed", () => {
    draw();
    arrive("coilbox://room?address=0x7f.1&port=8200");
    expect(screen.getByText("Join the room at 127.0.0.1:8200?")).toBeTruthy();
    press("Open the join form");
    expect(where).toBe("/battles");
    expect(state).toEqual({
      deeplinkRoom: { address: "127.0.0.1", port: 8200 },
    });
  });
});

describe("a second link while a first is open", () => {
  const firsts = Object.keys(LINKS) as (keyof typeof LINKS)[];
  const seconds = Object.keys(SECOND) as (keyof typeof SECOND)[];

  for (const first of firsts) {
    for (const second of seconds) {
      it(`refuses a ${second} link while a ${first} link is open, and Confirm still does the first`, () => {
        draw();
        arrive(LINKS[first].url);
        expect(
          screen.getByText(LINKS[first].says, { exact: false }),
        ).toBeTruthy();

        arrive(SECOND[second]);

        expect(refusals()).toHaveLength(1);
        expect(refusals()[0][0]).toMatchObject({
          title: "Ignored a coilbox link",
          level: "error",
        });
        // The words on screen are still the first link's.
        expect(
          screen.getByText(LINKS[first].says, { exact: false }),
        ).toBeTruthy();
        expect(screen.queryByText(/evil\.example/)).toBeNull();
        expect(screen.queryByText(/Evil/)).toBeNull();
        expect(screen.queryByText(/10\.0\.0\.9/)).toBeNull();
        expect(invitePrompt).toBeNull();
        expect(fetchImportPlan).not.toHaveBeenCalled();

        press(LINKS[first].confirm);

        if (first === "room") {
          expect(where).toBe("/battles");
          expect(state).toEqual({
            deeplinkRoom: { address: "192.168.1.45", port: 8200 },
          });
        } else if (first === "open") {
          expect(where).toBe("/library/maps/Comet%20Catcher");
        } else if (first === "import") {
          expect(where).toContain("/play/skirmish?import=");
        } else {
          expect(fetchImportPlan).toHaveBeenCalledTimes(1);
          expect(fetchImportPlan.mock.calls[0][0]).toBe(
            "https://paste.example/a.txt",
          );
        }
      });
    }
  }

  it("takes the next link once the first has been cancelled", () => {
    draw();
    arrive(LINKS.room.url);
    arrive(SECOND.open);
    expect(refusals()).toHaveLength(1);

    press("Cancel");
    arrive(SECOND.open);
    expect(refusals()).toHaveLength(1);
    expect(screen.getByText('Open the game "Evil".')).toBeTruthy();
  });

  it("takes the next link once the first has been confirmed", () => {
    draw();
    arrive(LINKS.open.url);
    press("Open");
    arrive(SECOND.room);
    expect(refusals()).toHaveLength(0);
    expect(screen.getByText("Join the room at 10.0.0.9:9000?")).toBeTruthy();
  });

  it("refuses a link while a fetch is running, so its answer cannot replace theirs", () => {
    draw();
    arrive("coilbox://import?url=https%3A%2F%2Fhub.example%2Fgallery");
    expect(fetchImportPlan).toHaveBeenCalledTimes(1);

    arrive(SECOND.room);
    arrive(SECOND.join);

    expect(refusals()).toHaveLength(2);
    expect(screen.queryByText(/10\.0\.0\.9/)).toBeNull();
    expect(invitePrompt).toBeNull();
  });
});

describe("a link while a join invite is open", () => {
  it("refuses a room, open and import link, and the invite stays what it said", () => {
    draw();
    arrive("coilbox://join?server=lobby.example.com%3A8200&battle=42");
    const prompt = invitePrompt;
    expect(prompt).not.toBeNull();

    for (const url of [
      LINKS.room.url,
      LINKS.open.url,
      LINKS.import.url,
      LINKS.importUrl.url,
      SECOND.hubShare,
    ]) {
      arrive(url);
    }

    expect(refusals()).toHaveLength(5);
    expect(invitePrompt).toBe(prompt);
    expect(
      screen.queryByRole("button", {
        name: /Open the join form|Continue|Fetch and check/,
      }),
    ).toBeNull();
    expect(where).toBe("/home");
  });

  it("refuses a second join link, as before", () => {
    draw();
    arrive("coilbox://join?server=lobby.example.com%3A8200&battle=42");
    const prompt = invitePrompt;
    arrive(SECOND.join);
    expect(invitePrompt).toBe(prompt);
    expect(notify).toHaveBeenCalledTimes(1);
  });
});

describe("a link that is not valid while a prompt is open", () => {
  it("is still reported, and still changes nothing", () => {
    draw();
    arrive(LINKS.room.url);
    arrive("coilbox://room?address=known%40evil.example&port=8200");
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "This room link's address is not an address.",
      }),
    );
    expect(screen.getByText(LINKS.room.says)).toBeTruthy();
  });
});
