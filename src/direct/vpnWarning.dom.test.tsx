// @vitest-environment happy-dom

/**
 * The VPN warning (issue #2800).
 *
 * The rule that separates a VPN carrying everything from Tailscale lives in
 * Rust, where `vpn.rs` tests it against this machine's real interfaces. What is
 * left for here is what a person ends up reading: nothing at all unless the
 * backend named a VPN, the longer sentence when hosting, the shorter one when
 * joining, and nothing when the question could not be answered.
 *
 * The last of those is the one worth having. A component that warned on a
 * failed call would warn on every machine where the plugin is not reachable,
 * which is the false warning this feature is arranged to avoid.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VpnWarning } from "./VpnWarning";

/**
 * What the backend answers, and how many times it has been asked.
 *
 * A plain function rather than a `vi.fn`, because one of the tests below has
 * the call fail. A rejection this component catches still fails the test when
 * the rejected promise passes through a vitest spy, so the spy is left out and
 * the call is counted here instead.
 */
const backend = vi.hoisted(() => ({
  answer: async (): Promise<{ vpn: { interface: string } | null }> => ({
    vpn: null,
  }),
  asked: 0,
}));

vi.mock("./bindings", () => ({
  directVpnRoute: () => {
    backend.asked += 1;
    return backend.answer();
  },
}));

/** The backend naming a VPN on the default route. */
const carrying = (interfaceName: string) => {
  backend.answer = async () => ({ vpn: { interface: interfaceName } });
};

/** The backend saying nothing carries it, which is also what Tailscale gives. */
const clear = () => {
  backend.answer = async () => ({ vpn: null });
};

/** Wait until the component has asked once. */
const asked = () => vi.waitFor(() => expect(backend.asked).toBeGreaterThan(0));

afterEach(cleanup);
beforeEach(() => {
  clear();
  backend.asked = 0;
});

describe("the VPN warning", () => {
  it("says nothing when no VPN carries this machine's traffic", async () => {
    clear();
    render(<VpnWarning place="host" />);
    await asked();
    expect(screen.queryByText(/VPN/)).toBeNull();
  });

  // Hosting is the expensive case, so the host is told both halves of the cost.
  it("tells a host that players may not reach them and pings will be worse", async () => {
    carrying("utun4");
    render(<VpnWarning place="host" />);
    const said = await screen.findByText(/utun4/);
    expect(said.textContent).toMatch(/may not be able to reach you directly/);
    expect(said.textContent).toMatch(/pings will be worse/);
    expect(said.textContent).toMatch(/Turn the VPN off/);
  });

  // Joining costs one person one ping, so it is the shorter note and says
  // nothing about anybody being unable to reach them.
  it("tells somebody joining only what it costs their own ping", async () => {
    carrying("NordLynx");
    render(<VpnWarning place="join" />);
    const said = await screen.findByText(/NordLynx/);
    expect(said.textContent).toMatch(/your ping will be worse/);
    expect(said.textContent).not.toMatch(/reach you directly/);
  });

  // Naming it is the difference between "something on this machine" and the
  // thing they can go and turn off.
  it("names the interface the traffic goes out of", async () => {
    carrying("utun7");
    render(<VpnWarning place="host" />);
    expect(await screen.findByText(/\(utun7\)/)).toBeTruthy();
  });

  it("says nothing when the check could not be run at all", async () => {
    backend.answer = async () => {
      throw new Error("no plugin here");
    };
    render(<VpnWarning place="host" />);
    await asked();
    expect(screen.queryByText(/VPN/)).toBeNull();
  });
});
