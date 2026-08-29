// @vitest-environment happy-dom

/**
 * What a host on a public address reads in the reachability panel (issue #2054).
 *
 * `reachabilityHeadline` and its neighbours are tested on their own and prove
 * the words are right. What they cannot prove is what the panel does with them:
 * the colour of the box and the router's own words underneath are decided here
 * and nowhere else, and both of them used to tell a host who is already on the
 * internet that something had gone wrong.
 *
 * The port opener is stood in for, because this machine has no public address to
 * be reached at and the milestone's other issues have already established that
 * the state cannot be reached on the network coilbox is developed on.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReachablePorts } from "./ReachablePorts";
import type { DirectReachability } from "./reachability";

/** A VPS, or a home line with no NAT. Nothing answered the mapping request
 *  because there was no gateway to answer it. */
const ON_PUBLIC_ADDRESS: DirectReachability = {
  method: null,
  ports: [],
  wanted: [
    { port: 8200, externalPort: 8200, transport: "tcp" },
    { port: 8452, externalPort: 8452, transport: "udp" },
  ],
  lanAddress: "209.35.91.246",
  publicAddress: "209.35.91.246",
  routerAddress: null,
  doubleNat: false,
  confirmedPort: 8452,
  problem: "no UPnP gateway answered",
};

/** The same report from an ordinary home connection, where the refusal is real
 *  and every word of the advice applies. */
const REFUSED: DirectReachability = {
  ...ON_PUBLIC_ADDRESS,
  lanAddress: "192.168.1.45",
  confirmedPort: null,
};

const report = vi.hoisted(() => ({
  current: null as DirectReachability | null,
}));

vi.mock("./useReachablePorts", () => ({
  useReachablePorts: () => ({
    report: report.current,
    busy: false,
    error: null,
  }),
}));

afterEach(cleanup);

/** The panel with the toggle already on, since the toggle is not what is being
 *  asked about here. */
function show(given: DirectReachability) {
  report.current = given;
  render(<ReachablePorts ports={[]} help="Opens the ports" />);
  fireEvent.click(screen.getByRole("checkbox"));
}

describe("the reachability panel for a host on a public address", () => {
  it("says they are reachable as they are", () => {
    show(ON_PUBLIC_ADDRESS);
    expect(
      screen.getByText(
        "Open. This machine is on the internet at 209.35.91.246, so there was nothing to forward.",
      ),
    ).toBeTruthy();
  });

  it("does not send them to a router setting", () => {
    show(ON_PUBLIC_ADDRESS);
    expect(document.body.textContent).not.toContain("UPnP or NAT-PMP");
    expect(document.body.textContent).not.toContain("by hand");
    expect(document.body.textContent).not.toContain("192.168");
  });

  // The router's own words are kept for the outcomes they explain. Under
  // "Open." they read as a fault, and there is no fault here: nothing answered
  // because there is nothing in front of this machine to answer.
  it("does not repeat the unanswered request as a fault", () => {
    show(ON_PUBLIC_ADDRESS);
    expect(document.body.textContent).not.toContain("no UPnP gateway answered");
  });

  it("is not drawn as a problem", () => {
    show(ON_PUBLIC_ADDRESS);
    const box = document.querySelector(".text-destructive");
    expect(box).toBeNull();
  });
});

describe("the reachability panel for a host behind a router", () => {
  it("still says the router refused, with the way out", () => {
    show(REFUSED);
    expect(
      screen.getByText("Your router would not open the ports."),
    ).toBeTruthy();
    expect(document.body.textContent).toContain("UPnP or NAT-PMP");
    expect(document.body.textContent).toContain("192.168.1.45");
  });

  it("keeps the router's own words for the host to read", () => {
    show(REFUSED);
    expect(document.body.textContent).toContain("no UPnP gateway answered");
  });

  it("is drawn as a problem", () => {
    show(REFUSED);
    expect(document.querySelector(".text-destructive")).not.toBeNull();
  });
});
