import { describe, expect, it } from "vitest";
import type { DirectLocalAddress } from "./bindings";
import type { DirectReachability } from "./reachability";
import { addressText, shareAddresses, shareHeadline } from "./share";

const on = (address: string, iface: string): DirectLocalAddress => ({
  address,
  interface: iface,
  loopback: false,
});

const loopback: DirectLocalAddress = {
  address: "127.0.0.1",
  interface: "lo0",
  loopback: true,
};

const mapped = (publicAddress: string, external: number): DirectReachability =>
  ({
    method: "upnp",
    doubleNat: false,
    publicAddress,
    ports: [{ port: 8200, externalPort: external, transport: "tcp" }],
  }) as unknown as DirectReachability;

const refused = {
  method: null,
  doubleNat: false,
  publicAddress: null,
  ports: [],
} as unknown as DirectReachability;

/** A machine on the internet under its own address: a VPS, or a home line with
 *  no NAT. Nothing was mapped because there was no gateway to ask, and the
 *  address the internet sees is one of this machine's own interfaces.
 *
 *  `lanAddress` is separate because it is the address a room announces itself
 *  at, and on any machine with a second interface that is the private one and
 *  not this (issue #2111). */
const direct = (
  address: string,
  lanAddress: string = address,
): DirectReachability =>
  ({
    method: null,
    doubleNat: false,
    lanAddress,
    publicAddress: address,
    publicAddressIsLocal: true,
    ports: [],
    wanted: [{ port: 8200, externalPort: 8200, transport: "tcp" }],
  }) as unknown as DirectReachability;

describe("shareAddresses", () => {
  it("names the one network address as this network, with no interface", () => {
    const found = shareAddresses(
      [on("192.168.1.45", "en0"), loopback],
      8200,
      null,
      "192.168.1.45",
    );
    const network = found.filter((a) => a.scope === "network");
    expect(network).toHaveLength(1);
    expect(network[0].label).toBe("On this network");
    expect(addressText(network[0])).toBe("192.168.1.45:8200");
  });

  // A VPN, Docker or a virtual machine adapter is the case this exists for: two
  // private addresses, and only the host can tell which one their friend is on
  // the same side of.
  it("names the interface once there is more than one to choose between", () => {
    const found = shareAddresses(
      [on("192.168.1.45", "en0"), on("10.8.0.2", "utun4"), loopback],
      8200,
      null,
      "192.168.1.45",
    );
    expect(
      found.filter((a) => a.scope === "network").map((a) => a.label),
    ).toEqual(["On en0", "On utun4"]);
  });

  it("keeps the order it was given, which is best first", () => {
    const found = shareAddresses(
      [on("192.168.1.45", "en0"), on("10.8.0.2", "utun4"), loopback],
      8200,
      null,
      "192.168.1.45",
    );
    expect(found.map((a) => a.address)).toEqual([
      "192.168.1.45",
      "10.8.0.2",
      "127.0.0.1",
    ]);
  });

  it("always ends with this machine, whatever else was found", () => {
    const found = shareAddresses(
      [on("192.168.1.45", "en0"), loopback],
      8200,
      null,
      "192.168.1.45",
    );
    const last = found[found.length - 1];
    expect(last.scope).toBe("machine");
    expect(addressText(last)).toBe("127.0.0.1:8200");
  });

  // The room's own port is not the one to read out when the router handed back
  // a different external one: the joiner dials the router, not the room.
  it("carries the router's port for the address outside this network", () => {
    const found = shareAddresses(
      [on("192.168.1.45", "en0"), loopback],
      8200,
      mapped("81.2.3.4", 8300),
      "192.168.1.45",
    );
    const outside = found.find((a) => a.scope === "internet");
    expect(outside && addressText(outside)).toBe("81.2.3.4:8300");
  });

  // Which is every room on a LAN, and every room behind a router that refuses
  // UPnP and NAT-PMP.
  it("offers no outside address when nothing opened", () => {
    const found = shareAddresses(
      [on("192.168.1.45", "en0"), loopback],
      8200,
      refused,
      "192.168.1.45",
    );
    expect(found.some((a) => a.scope === "internet")).toBe(false);
  });

  // Issue #2085. On a VPS this address is the internet, so calling it the one
  // for somebody on the same network as you is the opposite of the truth.
  it("calls a machine's own public address the one for outside", () => {
    const found = shareAddresses(
      [on("209.35.91.246", "eth0"), loopback],
      8200,
      direct("209.35.91.246"),
      "209.35.91.246",
    );
    const outside = found.find((a) => a.scope === "internet");
    expect(outside?.label).toBe("From outside");
    expect(outside && addressText(outside)).toBe("209.35.91.246:8200");
    expect(found.some((a) => a.scope === "network")).toBe(false);
  });

  it("lists a direct host's address once, not as a local one as well", () => {
    const found = shareAddresses(
      [on("209.35.91.246", "eth0"), loopback],
      8200,
      direct("209.35.91.246"),
      "209.35.91.246",
    );
    expect(found.filter((a) => a.address === "209.35.91.246")).toHaveLength(1);
  });

  // A VPS with a VPN on it. The public address becomes the outside row, so the
  // one private address left has nothing to be told apart from. The report says
  // the room is announced at 10.8.0.2, because that is what the Rust side picks
  // on a machine with a private address on it, and it is not what decides which
  // row the public address goes in (issue #2111).
  it("leaves the private address unnamed once the public one has moved", () => {
    const found = shareAddresses(
      [on("209.35.91.246", "eth0"), on("10.8.0.2", "utun4"), loopback],
      8200,
      direct("209.35.91.246", "10.8.0.2"),
      "10.8.0.2",
    );
    expect(
      found.filter((a) => a.scope === "network").map((a) => a.label),
    ).toEqual(["On this network"]);
  });

  // Issue #2127. The router opened the room's port, so this address reaches the
  // room. The room then hands everybody in it 192.168.1.45, which the joiner
  // outside cannot dial, so their engine hangs on "Connecting to". Without this
  // the host reads "From outside" and sends a friend into a dead end.
  it("says what an outside address does not buy when the room is announced elsewhere", () => {
    const found = shareAddresses(
      [on("192.168.1.45", "en0"), loopback],
      8200,
      mapped("81.2.3.4", 8300),
      "192.168.1.45",
    );
    const outside = found.find((a) => a.scope === "internet");
    expect(outside?.caveat).toContain("cannot start the game");
    expect(outside?.caveat).toContain("192.168.1.45");
    expect(outside?.who).toContain("cannot start the game");
  });

  // The other side of the same rule. A machine on the internet under its own
  // address announces that address, so the outside row delivers the game as well
  // as the room and has nothing to warn about.
  it("keeps the outside address unqualified when the room is announced at it", () => {
    const found = shareAddresses(
      [on("209.35.91.246", "eth0"), loopback],
      8200,
      direct("209.35.91.246"),
      "209.35.91.246",
    );
    const outside = found.find((a) => a.scope === "internet");
    expect(outside?.caveat).toBeUndefined();
    expect(outside?.who).toBe("for somebody who is not on your network");
  });

  // A VPS with Docker on it holds 172.17.0.1 as well as its public address, and
  // the Rust side picks the private one to announce (issue #2111). The machine
  // is on the internet under its own address and the outside row still cannot
  // deliver a game, which is why this asks what the room announced rather than
  // how the address was found.
  it("qualifies a direct host's own address when the room announced a private one", () => {
    const found = shareAddresses(
      [on("209.35.91.246", "eth0"), on("172.17.0.1", "docker0"), loopback],
      8200,
      direct("209.35.91.246", "172.17.0.1"),
      "172.17.0.1",
    );
    const outside = found.find((a) => a.scope === "internet");
    expect(outside?.caveat).toContain("172.17.0.1");
  });

  it("says so rather than pretending, on a machine with no network at all", () => {
    const found = shareAddresses([loopback], 8200, null, "127.0.0.1");
    expect(found).toHaveLength(1);
    expect(found[0].who).toContain("on no network");
  });
});

describe("shareHeadline", () => {
  it("asks the host to pick when there is more than one network", () => {
    const found = shareAddresses(
      [on("192.168.1.45", "en0"), on("10.8.0.2", "utun4"), loopback],
      8200,
      null,
      "192.168.1.45",
    );
    expect(shareHeadline(found)).toContain("the network they are on");
  });

  it("does not ask them to pick when there is nothing to pick from", () => {
    const found = shareAddresses(
      [on("192.168.1.45", "en0"), loopback],
      8200,
      null,
      "192.168.1.45",
    );
    expect(shareHeadline(found)).toBe("Give joiners this address:");
  });

  // A machine whose one address is a public one is on a network, and it is the
  // biggest one there is. Reading the empty list of local rows as "no network"
  // would tell a VPS host nobody can reach them.
  it("still offers the address of a machine whose only address is a public one", () => {
    const found = shareAddresses(
      [on("209.35.91.246", "eth0"), loopback],
      8200,
      direct("209.35.91.246"),
      "209.35.91.246",
    );
    expect(shareHeadline(found)).toBe("Give joiners this address:");
  });

  it("does not offer an address nobody else can reach", () => {
    expect(
      shareHeadline(shareAddresses([loopback], 8200, null, "127.0.0.1")),
    ).toContain("nobody else can reach");
  });
});
