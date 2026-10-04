// @vitest-environment happy-dom

/**
 * The Share button that replaced the band of join addresses under the battle
 * room's header (issue #3460).
 *
 * The rows and the warnings are tested as pure functions in `share.test.ts`.
 * What this proves is what a host sees and can press: the button, what opens
 * behind it, that each action puts the right text on the clipboard, that a
 * warning is on the button before anything is opened, and that the keyboard
 * can get in and out.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectRoomStatus } from "./bindings";
import { ShareRoomButton } from "./ShareRoomButton";

const addresses = vi.hoisted(() => vi.fn());
const portStatus = vi.hoisted(() => vi.fn());

vi.mock("./bindings", () => ({
  directLocalAddresses: () => addresses(),
}));

vi.mock("./reachability", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./reachability")>()),
  directPortStatus: () => portStatus(),
}));

const room = (over: Partial<DirectRoomStatus> = {}): DirectRoomStatus => ({
  port: 8200,
  host: "alice",
  ip: "192.168.1.45",
  approveJoins: false,
  advertise: true,
  peers: 1,
  pending: [],
  battle: null,
  ...over,
});

const lan = { address: "192.168.1.45", interface: "en0", loopback: false };
const vpn = { address: "10.8.0.2", interface: "utun4", loopback: false };
const loopback = { address: "127.0.0.1", interface: "lo0", loopback: true };

const writeText = vi.fn();

beforeEach(() => {
  addresses.mockReset();
  portStatus.mockReset();
  portStatus.mockResolvedValue({ reachability: null });
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

afterEach(cleanup);

/** The button on screen with the machine's addresses read, and not yet opened. */
async function shown(
  found: (typeof lan)[],
  status: Partial<DirectRoomStatus> = {},
) {
  addresses.mockResolvedValue({ addresses: found });
  render(<ShareRoomButton room={room(status)} />);
  // The reads land after the first paint.
  await act(async () => {});
  return screen.getByRole("button", { name: /^Share/ });
}

async function opened(
  found: (typeof lan)[],
  status: Partial<DirectRoomStatus> = {},
) {
  const button = await shown(found, status);
  fireEvent.click(button);
  return button;
}

describe("the Share button", () => {
  it("opens a popover with the address, a link action and an address action", async () => {
    await opened([lan, loopback]);
    const popover = screen.getByRole("dialog");

    expect(within(popover).getByText("On this network")).toBeTruthy();
    expect(within(popover).getByText("192.168.1.45:8200")).toBeTruthy();
    expect(within(popover).getByText("Copy link")).toBeTruthy();
    expect(within(popover).getByText("Copy address")).toBeTruthy();
  });

  // The user's call: a second coilbox on the same computer is not who a host
  // shares a room with, so the popover offers addresses another machine can use.
  it("does not offer the loopback address", async () => {
    await opened([lan, loopback]);
    const popover = screen.getByRole("dialog");

    expect(within(popover).queryByText(/127\.0\.0\.1/)).toBeNull();
    expect(within(popover).queryByText("Same machine")).toBeNull();
  });

  it("gives each network its own block when there is more than one", async () => {
    await opened([lan, vpn, loopback]);
    const popover = screen.getByRole("dialog");

    expect(within(popover).getByText("On en0")).toBeTruthy();
    expect(within(popover).getByText("On utun4")).toBeTruthy();
    expect(within(popover).getAllByText("Copy link")).toHaveLength(2);
  });

  it("copies the invite link from Copy link", async () => {
    await opened([lan]);
    fireEvent.click(screen.getByText("Copy link"));

    expect(writeText).toHaveBeenCalledTimes(1);
    const link = writeText.mock.calls[0][0] as string;
    expect(link.startsWith("coilbox://")).toBe(true);
    expect(link).toContain("192.168.1.45");
    expect(link).toContain("8200");
  });

  it("copies the bare address from Copy address", async () => {
    await opened([lan]);
    fireEvent.click(screen.getByText("Copy address"));

    expect(writeText).toHaveBeenCalledWith("192.168.1.45:8200");
  });

  it("says Copied on the button that was pressed, then goes back", async () => {
    vi.useFakeTimers();
    try {
      await opened([lan]);
      await act(async () => {
        fireEvent.click(screen.getByText("Copy link"));
      });
      expect(screen.getByText("Copied")).toBeTruthy();
      expect(screen.getByText("Copy address")).toBeTruthy();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(screen.queryByText("Copied")).toBeNull();
      expect(screen.getByText("Copy link")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("says so when the clipboard refuses", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    await opened([lan]);
    await act(async () => {
      fireEvent.click(screen.getByText("Copy link"));
    });

    expect(screen.getByText("Couldn't copy")).toBeTruthy();
  });
});

describe("a warning the host has to read", () => {
  it("has no marker and no warning on an ordinary announced room", async () => {
    const button = await opened([lan]);

    expect(button.textContent).not.toContain("has a warning");
    expect(screen.queryByText(/Not announced/)).toBeNull();
    expect(screen.getByText("Give joiners this address.")).toBeTruthy();
  });

  it("marks the button before it is opened, and says it first in the popover", async () => {
    const button = await shown([lan], { advertise: false });
    expect(button.textContent).toContain("has a warning");

    fireEvent.click(button);
    const popover = screen.getByRole("dialog");
    const warning = within(popover).getByText(
      "Not announced on this network, so give joiners your address.",
    );
    const heading = within(popover).getByText("Invite people to this room");
    const block = within(popover).getByText("On this network");
    // The warning is between the heading and the first address.
    expect(
      heading.compareDocumentPosition(warning) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      warning.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("marks the button when the outside address cannot start a game", async () => {
    portStatus.mockResolvedValue({
      reachability: {
        method: "upnp",
        doubleNat: false,
        publicAddress: "203.0.113.9",
        ports: [{ port: 8200, externalPort: 8200, transport: "tcp" }],
      },
    });
    const button = await shown([lan]);
    expect(button.textContent).toContain("has a warning");

    fireEvent.click(button);
    expect(
      within(screen.getByRole("dialog")).getByText(
        /From outside: They can join this room and chat/,
      ),
    ).toBeTruthy();
  });
});

describe("a host with no address to give", () => {
  it("says so plainly, marks the button, and draws no list", async () => {
    const button = await opened([loopback]);
    const popover = screen.getByRole("dialog");

    expect(button.textContent).toContain("has a warning");
    expect(
      within(popover).getByText(
        "This room has no address another computer can reach, because this machine is on no network.",
      ),
    ).toBeTruthy();
    expect(within(popover).queryByText("Copy link")).toBeNull();
    expect(within(popover).queryByText("Copy address")).toBeNull();
    expect(within(popover).queryByText(/127\.0\.0\.1/)).toBeNull();
  });
});

describe("the keyboard", () => {
  it("is a real button, so Tab reaches it and Enter or Space press it", async () => {
    const button = await shown([lan]);
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(button.getAttribute("tabindex")).not.toBe("-1");
  });

  it("moves focus into the popover on opening and back to the button on Escape", async () => {
    const button = await opened([lan]);
    const popover = screen.getByRole("dialog");
    await act(async () => {});
    expect(popover.contains(document.activeElement)).toBe(true);

    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? document.body, {
        key: "Escape",
      });
    });
    // Radix hands focus back once the popover has unmounted, which is a tick
    // after the key press.
    await waitFor(() => expect(document.activeElement).toBe(button));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
