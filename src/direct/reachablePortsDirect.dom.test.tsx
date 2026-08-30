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
 *
 * The cloud instance at the bottom is issue #2114, and it is the other half of
 * the same mistake: the panel stating a cause it had not established. That host
 * is not on a public address, holds no mapping, and has no router either.
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
  publicAddressIsLocal: true,
  routerAddress: null,
  doubleNat: false,
  confirmedPort: 8452,
  problem: "no UPnP gateway answered",
};

/** The same machine with a Docker bridge on it, so the address the room
 *  announces itself at is the bridge and not the public one (issue #2111). */
const ON_PUBLIC_ADDRESS_WITH_A_BRIDGE: DirectReachability = {
  ...ON_PUBLIC_ADDRESS,
  lanAddress: "172.17.0.1",
};

/** The same report from an ordinary home connection, where there is a router and
 *  it opened nothing. */
const REFUSED: DirectReachability = {
  ...ON_PUBLIC_ADDRESS,
  lanAddress: "192.168.1.45",
  publicAddressIsLocal: false,
  confirmedPort: null,
  problem:
    "Nothing opened the ports. NAT-PMP: nothing answered on UDP 5351. UPnP: no UPnP gateway answered.",
};

/** A cloud instance whose provider translates its public address one to one, so
 *  the card holds only 172.31.14.9 and the report is the one above with
 *  different numbers in it (issue #2114). */
const ON_A_CLOUD_INSTANCE: DirectReachability = {
  ...REFUSED,
  lanAddress: "172.31.14.9",
  publicAddress: "13.40.72.15",
  confirmedPort: 8452,
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

/**
 * A VPS running Docker, which is the ordinary VPS (issue #2111).
 *
 * The panel read the bridge's address against the one STUN saw, found two
 * different strings, and sent a host with no router to their router's settings
 * page. Everything the panel is being asked here it already gets right for the
 * machine above, so what is actually under test is that one more network card
 * cannot take it away.
 */
describe("the reachability panel for a host on a public address with a docker bridge", () => {
  it("says they are reachable as they are", () => {
    show(ON_PUBLIC_ADDRESS_WITH_A_BRIDGE);
    expect(
      screen.getByText(
        "Open. This machine is on the internet at 209.35.91.246, so there was nothing to forward.",
      ),
    ).toBeTruthy();
  });

  it("does not send them to a router setting", () => {
    show(ON_PUBLIC_ADDRESS_WITH_A_BRIDGE);
    expect(document.body.textContent).not.toContain("UPnP or NAT-PMP");
    expect(document.body.textContent).not.toContain("172.17.0.1");
  });

  it("is not drawn as a problem", () => {
    show(ON_PUBLIC_ADDRESS_WITH_A_BRIDGE);
    expect(document.querySelector(".text-destructive")).toBeNull();
  });
});

describe("the reachability panel for a host behind a router", () => {
  it("still says nothing opened, with the way out", () => {
    show(REFUSED);
    expect(screen.getByText("Nothing would open the ports.")).toBeTruthy();
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

/**
 * A cloud instance behind its provider's one to one NAT (issue #2114).
 *
 * Nothing in the report separates this host from the one above, so the panel
 * cannot draw them differently and does not try. What it must do is give this
 * reader something they can act on, which is a firewall rule in a browser and
 * not a setting on a router they have not got.
 */
describe("the reachability panel for a host on a cloud instance", () => {
  it("offers the firewall rule that is the only thing this host can change", () => {
    show(ON_A_CLOUD_INSTANCE);
    expect(screen.getByText("Nothing would open the ports.")).toBeTruthy();
    expect(document.body.textContent).toContain("firewall or security group");
    expect(document.body.textContent).toContain("TCP 8200 and UDP 8452");
  });

  // The detail line is Rust's sentence, and this only proves the panel still
  // puts it on the screen for this host. That the sentence itself names no
  // router is `portmap.rs`'s own test, since the string here is a fixture.
  it("shows the two unanswered requests without calling either one a router", () => {
    show(ON_A_CLOUD_INSTANCE);
    expect(document.body.textContent).toContain(
      "Nothing opened the ports. NAT-PMP:",
    );
    expect(document.body.textContent).not.toContain("Your router");
  });
});
