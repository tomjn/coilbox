// @vitest-environment happy-dom

/**
 * Zero-K's offer to rejoin a running match (issue #4198). Accepting goes to the
 * battle room carrying the battle to ask for. Dismissing sends nothing and goes
 * nowhere.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@picoframe/frame", () => ({
  Button: ({
    children,
    ...props
  }: { children?: ReactNode } & Record<string, unknown>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

const wire = vi.hoisted(() => ({
  navigate: vi.fn(),
  connections: {} as Record<string, unknown>,
}));

vi.mock("react-router", () => ({ useNavigate: () => wire.navigate }));
vi.mock("../notify/notify", () => ({ notify: async () => {} }));
vi.mock("./store", () => ({
  useMultiplayer: () => ({ connections: wire.connections }),
  useProtocolServers: () => [],
  serverNameFor: () => "Zero-K",
}));

import { RejoinOfferPanel } from "./RejoinOfferPanel";

const KEY = "me@zero-k.info:8200";

function offered(battleId: number | null) {
  wire.connections = {
    [KEY]: {
      serverKey: KEY,
      live: true,
      mirror: { rejoinOffer: battleId == null ? null : { battleId } },
    },
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RejoinOfferPanel", () => {
  it("shows nothing without an offer", () => {
    offered(null);
    render(<RejoinOfferPanel />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("accepting goes to the battle room with the battle to ask for", () => {
    offered(42);
    render(<RejoinOfferPanel />);
    fireEvent.click(screen.getByText("Rejoin"));
    expect(wire.navigate).toHaveBeenCalledTimes(1);
    expect(wire.navigate).toHaveBeenCalledWith(
      `/battle?server=${encodeURIComponent(KEY)}`,
      { state: { rejoinBattleId: 42 } },
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("dismissing sends nothing, goes nowhere and closes the offer", () => {
    offered(42);
    render(<RejoinOfferPanel />);
    fireEvent.click(screen.getByText("Dismiss"));
    expect(wire.navigate).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
