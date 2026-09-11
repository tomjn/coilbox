// @vitest-environment happy-dom

/**
 * The route word in the battle room's top bar (issue #2022).
 *
 * `battleRouteLabel` is tested on its own and proves the wording. What it
 * cannot prove is the thing that would actually hurt somebody: the recorded
 * route is a module singleton with no battle id in it, and it survives leaving
 * the battle it describes, so a header that read it unconditionally would show
 * a stale route to somebody sitting in a battle that is not theirs. So these
 * tests go through the header with the route already recorded, and ask what is
 * on screen.
 *
 * Radix's popover is stood in for because the header builds one for the close
 * confirmation, and it is not what is being asked about here.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type HostingRoute,
  recordHostingRoute,
} from "../../direct/hostingRoute";
import type { Battle } from "../bindings";
import { BattleRoomHeader } from "./BattleRoomHeader";

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

function battle(): Battle {
  return {
    id: 7,
    tachyonId: null,
    host: "me",
    ip: "",
    port: "",
    natType: "0",
    map: "Comet Catcher Remake 1.8",
    maphash: "",
    modname: "Beyond All Reason test-1234",
    engine: "",
    version: "",
    maxPlayers: 8,
    playerCount: null,
    passworded: false,
    locked: false,
    spectatorCount: 0,
    title: "A battle",
    channel: null,
    members: {},
    bots: {},
    scriptTags: {},
    startRects: {},
    bosses: [],
    bossesEnabled: false,
    inProgress: false,
    mode: null,
  };
}

/**
 * The header as the battle room draws it, with only what a test varies named.
 *
 * The route goes in through `recordHostingRoute`, which is where a hosting form
 * puts it, rather than through a prop. Handing it in directly would test the
 * wording and nothing else, and the wording already has its own tests.
 */
function drawHeader(
  over: { selfHost?: boolean; directRoom?: boolean; route?: HostingRoute } = {},
) {
  if (over.route) recordHostingRoute(over.route);
  render(
    <BattleRoomHeader
      battle={battle()}
      myStatus={undefined}
      sync="synced"
      blockShort={null}
      blockReason={null}
      unsynced={[]}
      hostIngame={false}
      allReady={false}
      onToggleReady={() => {}}
      onToggleSpectate={() => {}}
      onLeave={() => {}}
      onStart={() => {}}
      selfHost={over.selfHost ?? true}
      closesRoom={false}
      locked={false}
      onToggleLock={() => {}}
      serverKey={null}
      directRoom={over.directRoom ?? false}
    />,
  );
}

/**
 * Whether the bar drew a route at all.
 *
 * Asked of the element rather than of a list of words, because a test that
 * looks for the four words it knows about would stay green for a fifth. The
 * route control is the only tooltip in this header.
 */
function routeShown(): boolean {
  return !!document.querySelector('[data-slot="tooltip-trigger"]');
}

afterEach(() => {
  cleanup();
  recordHostingRoute(null);
});

beforeEach(() => {
  recordHostingRoute(null);
});

describe("the battle room's route word", () => {
  // The top bar says a battle is relayed, on every page and with the way back
  // to it, so the room says nothing and does not say it twice.
  it("leaves a relayed battle to the top bar", () => {
    drawHeader({ route: "relay" });
    expect(routeShown()).toBe(false);
  });

  /**
   * The route can be recorded after the room is drawn. `mp_open_battle` waits
   * for the lobby's answer, and that answer is also the delta that puts this
   * client in the battle and sends the page here, so the room arrives before the
   * form gets its promise back and records anything. A header that read the
   * record once on mount would leave the host with no word at all.
   */
  it("takes a route recorded after the room is already on screen", () => {
    drawHeader();
    expect(routeShown()).toBe(false);

    act(() => {
      recordHostingRoute("direct");
    });

    expect(screen.getByText("Direct")).toBeTruthy();
  });

  // The word on its own explains nothing, so the reason has to be reachable
  // from it. Keyboard focus rather than a hover, because that is the path that
  // breaks silently when a trigger stops being a real focusable control.
  it("gives the reason behind the word to somebody who asks for it", async () => {
    drawHeader({ route: "direct" });
    fireEvent.focus(screen.getByText("Direct"));
    expect(
      await screen.findByText(/players connect straight to it/),
    ).toBeTruthy();
  });

  it("names the direct routes too, so a good ping has an answer as well", () => {
    drawHeader({ route: "direct" });
    expect(screen.getByText("Direct")).toBeTruthy();
    cleanup();
    drawHeader({ route: "portMapped" });
    expect(screen.getByText("Port opened")).toBeTruthy();
  });

  // The one that matters. The recorded route outlives the battle it was
  // recorded for, so somebody who hosts a battle, closes it and walks into a
  // battle hosted by somebody else still has that route sitting in the module.
  // Nothing about their battle is known, and naming its route would be an
  // invented answer to a real question.
  it("shows a joiner nothing, whatever route this client last hosted", () => {
    drawHeader({ selfHost: false, route: "direct" });
    expect(screen.queryByText("Direct")).toBe(null);
    expect(routeShown()).toBe(false);
  });

  // The port check is off by default in both hosting forms, so this is the
  // ordinary case and it draws nothing at all.
  it("says nothing about a battle whose route was never checked", () => {
    drawHeader({ route: "unchecked" });
    expect(routeShown()).toBe(false);
  });

  it("keeps quiet about a LAN room the internet cannot reach", () => {
    drawHeader({ route: "unreachable", directRoom: true });
    expect(routeShown()).toBe(false);
  });

  it("says so when a battle on a server can be reached by nobody", () => {
    drawHeader({ route: "unreachable" });
    expect(screen.getByText("Not reachable")).toBeTruthy();
  });
});
