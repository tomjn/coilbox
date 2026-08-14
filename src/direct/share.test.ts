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

describe("shareAddresses", () => {
  it("names the one network address as this network, with no interface", () => {
    const found = shareAddresses(
      [on("192.168.1.45", "en0"), loopback],
      8200,
      null,
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
    );
    expect(found.some((a) => a.scope === "internet")).toBe(false);
  });

  it("says so rather than pretending, on a machine with no network at all", () => {
    const found = shareAddresses([loopback], 8200, null);
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
    );
    expect(shareHeadline(found)).toContain("the network they are on");
  });

  it("does not ask them to pick when there is nothing to pick from", () => {
    const found = shareAddresses(
      [on("192.168.1.45", "en0"), loopback],
      8200,
      null,
    );
    expect(shareHeadline(found)).toBe("Give joiners this address:");
  });

  it("does not offer an address nobody else can reach", () => {
    expect(shareHeadline(shareAddresses([loopback], 8200, null))).toContain(
      "nobody else can reach",
    );
  });
});
