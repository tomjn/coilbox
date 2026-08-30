import { describe, expect, it } from "vitest";
import {
  battlePorts,
  type DirectReachability,
  isOnPublicAddress,
  isReachabilityProblem,
  isReachable,
  joinAddress,
  portList,
  reachabilityAdvice,
  reachabilityHeadline,
  reachabilityState,
  roomPorts,
} from "./reachability";

/** A report with nothing in it, so each test says only what it is about. */
function report(over: Partial<DirectReachability> = {}): DirectReachability {
  return {
    method: null,
    ports: [],
    wanted: [
      { port: 8200, externalPort: 8200, transport: "tcp" },
      { port: 8452, externalPort: 8452, transport: "udp" },
    ],
    lanAddress: "192.168.1.45",
    publicAddress: null,
    publicAddressIsLocal: false,
    routerAddress: null,
    doubleNat: false,
    confirmedPort: null,
    problem: null,
    ...over,
  };
}

/** A report where both ports opened and the internet answered. */
function opened(over: Partial<DirectReachability> = {}): DirectReachability {
  return report({
    method: "upnp",
    ports: [
      { port: 8200, externalPort: 8200, transport: "tcp" },
      { port: 8452, externalPort: 8452, transport: "udp" },
    ],
    publicAddress: "209.35.91.246",
    routerAddress: "209.35.91.246",
    confirmedPort: 8452,
    ...over,
  });
}

/** A machine on the internet under its own address: a VPS, or a home line with
 *  no NAT. Nothing answers the port mapping request because there is no gateway
 *  to answer it, so this looks like a refusal with a public address in it. */
function onPublicAddress(
  over: Partial<DirectReachability> = {},
): DirectReachability {
  return report({
    lanAddress: "209.35.91.246",
    publicAddress: "209.35.91.246",
    publicAddressIsLocal: true,
    problem: "no UPnP gateway answered",
    ...over,
  });
}

/** The same VPS with a Docker bridge on it, which is the ordinary one. Rust
 *  announces a room at the bridge, because a private address is the right one to
 *  announce, and still says the address the internet sees is this machine's
 *  (issue #2111). */
function onPublicAddressWithABridge(
  over: Partial<DirectReachability> = {},
): DirectReachability {
  return onPublicAddress({ lanAddress: "172.17.0.1", ...over });
}

/**
 * A cloud instance with a public IPv4, which the provider translates one to one.
 *
 * The card holds only the private address, so STUN comes back with one this
 * machine does not hold and `publicAddressIsLocal` is false. Nothing answers the
 * mapping request because there is no gateway to answer it. Byte for byte the
 * same report as a home router with UPnP switched off, and the host has no
 * router and no UPnP (issue #2114).
 *
 * The reflexive port survives a one to one NAT, which is why `confirmedPort` is
 * set here and not on {@link report}. It is the nearest thing to a signal and it
 * is not one: home routers preserve the source port too.
 */
function onCloudInstance(
  over: Partial<DirectReachability> = {},
): DirectReachability {
  return report({
    lanAddress: "172.31.14.9",
    publicAddress: "13.40.72.15",
    publicAddressIsLocal: false,
    confirmedPort: 8452,
    problem:
      "Nothing opened the ports. NAT-PMP: nothing answered on UDP 5351. UPnP: no UPnP gateway answered.",
    ...over,
  });
}

describe("roomPorts", () => {
  // The whole point of the issue: one port gets everybody into the room and
  // then fails at launch, which is worse than not trying.
  it("asks for the lobby and the game, never one of them", () => {
    expect(roomPorts(8200, 8452)).toEqual([
      { port: 8200, transport: "tcp", description: "Coilbox room" },
      { port: 8452, transport: "udp", description: "Coilbox game" },
    ]);
  });

  it("follows a host who moved their room off the default port", () => {
    expect(roomPorts(8300, 8452)[0].port).toBe(8300);
  });
});

describe("battlePorts", () => {
  // A battle on a real lobby server has no lobby port of its own, because the
  // server is somebody else's and this client listens on nothing.
  it("asks for the game port only", () => {
    expect(battlePorts(8452)).toEqual([
      { port: 8452, transport: "udp", description: "Coilbox game" },
    ]);
  });
});

describe("reachabilityState", () => {
  it("calls a mapping with a public address behind it open", () => {
    expect(reachabilityState(opened())).toBe("open");
  });

  // Carrier grade NAT. The router means it and it still does not work, so this
  // must never read as success.
  it("calls a mapping behind the provider's own NAT a double NAT", () => {
    expect(
      reachabilityState(
        opened({ doubleNat: true, routerAddress: "100.88.1.2" }),
      ),
    ).toBe("doubleNat");
  });

  it("calls a run where nothing opened refused", () => {
    expect(reachabilityState(report({ problem: "no gateway" }))).toBe(
      "refused",
    );
  });

  /**
   * A cloud instance behind its provider's one to one NAT, which is issue
   * #2114's host. The wording it reads changed and the verdict did not, on
   * purpose.
   *
   * Coilbox has no way to find out whether this host is reachable: the one to
   * one NAT is transparent, and whether anybody gets in is a firewall rule in
   * the provider's console that nothing here can see. So the two wrong answers
   * are not symmetric. Calling them refused costs a reachable host a relay hop
   * and a battle that works. Calling them direct sends whoever has not opened
   * the firewall off to host a battle nobody can join, with no advice on the
   * screen to act on and the relay skipped.
   *
   * The reflexive port is the nearest thing to a signal and it is set here, so
   * this fails if a later change reads it as proof of the transparent case.
   */
  it("does not promote a cloud instance to direct on a preserved port", () => {
    expect(reachabilityState(onCloudInstance())).toBe("refused");
    expect(isReachable(onCloudInstance())).toBe(false);
  });

  // The ports are open and nothing would say what address they are behind.
  // Not a mapping failure, and not something to guess an address for.
  it("separates an open port with no known address from a refusal", () => {
    expect(reachabilityState(opened({ publicAddress: null }))).toBe(
      "noAddress",
    );
  });

  // A refusal wins over a missing address: there is nothing to have an address
  // for.
  it("reports a refusal rather than a missing address when both are true", () => {
    expect(reachabilityState(report({ publicAddress: null }))).toBe("refused");
  });

  // The issue. A machine already on the internet has no gateway to answer a
  // port mapping request, so its report is a refusal, and reading that as one
  // tells a host who is reachable that they are not.
  it("calls a machine on its own public address direct, not refused", () => {
    expect(reachabilityState(onPublicAddress())).toBe("direct");
  });

  // Ordered like the hosting ladder: a machine that is on the internet and also
  // happens to hold a mapping was reachable without it.
  it("prefers direct over a mapping the machine did not need", () => {
    expect(
      reachabilityState(
        opened({
          lanAddress: "209.35.91.246",
          publicAddress: "209.35.91.246",
          publicAddressIsLocal: true,
        }),
      ),
    ).toBe("direct");
  });

  // One more network card is all it took. This used to read the bridge's
  // 172.17.0.1 against the address STUN saw, find them different, and tell a
  // host with no router that their router had refused (issue #2111).
  it("calls a machine with a docker bridge beside its public address direct", () => {
    expect(reachabilityState(onPublicAddressWithABridge())).toBe("direct");
  });

  // Two unknowns are not a match. A machine with no local address and no STUN
  // answer knows nothing about itself.
  it("does not read two unknown addresses as a public one", () => {
    expect(reachabilityState(report({ lanAddress: null }))).toBe("refused");
  });
});

describe("isOnPublicAddress", () => {
  it("is true only when the address the internet sees is this machine's own", () => {
    expect(isOnPublicAddress(onPublicAddress())).toBe(true);
    // Behind a router: STUN saw a public address and it belongs to the router.
    expect(isOnPublicAddress(report({ publicAddress: "209.35.91.246" }))).toBe(
      false,
    );
    expect(isOnPublicAddress(report({ lanAddress: null }))).toBe(false);
  });

  // The bug. The bridge's address is not the one STUN saw and never was the
  // one to compare against it (issue #2111).
  it("does not lose the answer to a second network card", () => {
    expect(isOnPublicAddress(onPublicAddressWithABridge())).toBe(true);
  });
});

describe("joinAddress", () => {
  it("gives the public address and the lobby port together", () => {
    expect(joinAddress(opened())).toBe("209.35.91.246:8200");
  });

  // The router handed back a port other than the one asked for, and the address
  // has to say the port the world actually reaches.
  it("uses the port the router gave, not the one asked for", () => {
    expect(
      joinAddress(
        opened({
          ports: [
            { port: 8200, externalPort: 9100, transport: "tcp" },
            { port: 8452, externalPort: 8452, transport: "udp" },
          ],
        }),
      ),
    ).toBe("209.35.91.246:9100");
  });

  // The self-hosted battle path: the lobby server tells joiners where the host
  // is, so there is no lobby port to name.
  it("gives the address alone when there is no lobby port", () => {
    expect(
      joinAddress(
        opened({
          ports: [{ port: 8452, externalPort: 8452, transport: "udp" }],
        }),
      ),
    ).toBe("209.35.91.246");
  });

  // Showing the local address only, rather than guessing, is what the issue
  // asks for.
  it("gives nothing when STUN could not be reached", () => {
    expect(joinAddress(opened({ publicAddress: null }))).toBeNull();
  });

  it("gives nothing when the ports never opened", () => {
    expect(joinAddress(report({ publicAddress: "209.35.91.246" }))).toBeNull();
  });

  it("gives nothing when the router is itself behind a NAT", () => {
    expect(joinAddress(opened({ doubleNat: true }))).toBeNull();
  });

  // Issue #2085. This host opened nothing because there was nothing to open, so
  // the list of mappings is empty and the port they are listening on is the one
  // they asked for. Reading only the mappings left them with a headline saying
  // they were reachable and no address to send anybody.
  it("gives a machine on its own public address the port it listens on", () => {
    expect(joinAddress(onPublicAddress())).toBe("209.35.91.246:8200");
  });

  // The same host on the other form. A battle on a lobby server asks for the
  // game's UDP port and no lobby port, and the server tells joiners the rest.
  it("gives a machine on its own public address the address alone when it has no lobby port", () => {
    expect(
      joinAddress(
        onPublicAddress({
          wanted: [{ port: 8452, externalPort: 8452, transport: "udp" }],
        }),
      ),
    ).toBe("209.35.91.246");
  });
});

describe("isReachable", () => {
  it("is true only when the ports opened onto the real internet", () => {
    expect(isReachable(opened())).toBe(true);
    expect(isReachable(opened({ doubleNat: true }))).toBe(false);
    expect(isReachable(report())).toBe(false);
  });

  // Issue #2085. The question is whether somebody outside can get in, not
  // whether a mapping was made. A machine already on the internet never made
  // one and is reachable anyway.
  it("counts a machine on its own public address as reachable", () => {
    expect(isReachable(onPublicAddress())).toBe(true);
  });
});

describe("portList", () => {
  it("names the transport with the number, because a router asks for both", () => {
    expect(
      portList([
        { port: 8200, externalPort: 8200, transport: "tcp" },
        { port: 8452, externalPort: 8452, transport: "udp" },
      ]),
    ).toBe("TCP 8200 and UDP 8452");
  });

  it("reads properly with one port", () => {
    expect(
      portList([{ port: 8452, externalPort: 8452, transport: "udp" }]),
    ).toBe("UDP 8452");
  });
});

describe("reachabilityHeadline", () => {
  it("names the protocol that worked and the ports it opened", () => {
    expect(reachabilityHeadline(opened())).toBe(
      "Open. UPnP forwarded TCP 8200 and UDP 8452.",
    );
    expect(reachabilityHeadline(opened({ method: "natPmp" }))).toContain(
      "NAT-PMP",
    );
  });

  it("does not call a double NAT open", () => {
    const said = reachabilityHeadline(opened({ doubleNat: true }));
    expect(said).not.toContain("Open.");
    expect(said).toContain("nobody outside can reach you");
  });

  // Two hosts, one report. Coilbox observed that nothing opened the ports and
  // did not observe a router, so the headline says the first and not the second
  // (issue #2114).
  it("says nothing opened the ports rather than naming a device it did not find", () => {
    expect(reachabilityHeadline(report())).toBe(
      "Nothing would open the ports.",
    );
    expect(reachabilityHeadline(onCloudInstance())).toBe(
      "Nothing would open the ports.",
    );
  });

  it("tells a machine on its own public address that it is already reachable", () => {
    expect(reachabilityHeadline(onPublicAddress())).toBe(
      "Open. This machine is on the internet at 209.35.91.246, so there was nothing to forward.",
    );
  });

  it("does not blame the router of a host who has none", () => {
    expect(reachabilityHeadline(onPublicAddress())).not.toContain("router");
  });
});

describe("reachabilityAdvice", () => {
  // The failure path is the one most people hit, and both port numbers plus the
  // address to forward to are what makes it actionable.
  it("names both ports and the machine to forward them to", () => {
    const said = reachabilityAdvice(report());
    expect(said).toContain("TCP 8200 and UDP 8452");
    expect(said).toContain("192.168.1.45");
    expect(said).toContain("UPnP or NAT-PMP");
  });

  /**
   * The issue. Two hosts read this one sentence and coilbox cannot tell them
   * apart, so it has to be true for both (issue #2114).
   *
   * The home host's way out is UPnP or a forwarding page. The cloud host's is a
   * firewall rule in their provider's console, and every word of the old advice
   * was a router setting they have not got. The reports are identical, so the
   * advice names both rather than picking one and being wrong about half of
   * them.
   */
  it("names the cloud firewall as well as the router setting, since it cannot tell which host is reading", () => {
    const said = reachabilityAdvice(onCloudInstance()) ?? "";
    expect(said).toContain("UPnP or NAT-PMP");
    expect(said).toContain("firewall or security group");
    expect(said).toContain("TCP 8200 and UDP 8452");
    // And the identical report from a home connection reads the same, which is
    // the whole reason this wording exists.
    expect(reachabilityAdvice(report({ lanAddress: "172.31.14.9" }))).toBe(
      said,
    );
  });

  // A machine on no network at all still gets instructions worth reading.
  it("leaves out the address when this machine is on no network", () => {
    const said = reachabilityAdvice(report({ lanAddress: null }));
    expect(said).toContain("TCP 8200 and UDP 8452");
    expect(said).not.toContain("undefined");
    expect(said).not.toContain("null");
  });

  it("says a double NAT is not fixable on the router", () => {
    const said = reachabilityAdvice(
      opened({ doubleNat: true, routerAddress: "100.88.1.2" }),
    );
    expect(said).toContain("carrier grade NAT");
    expect(said).toContain("100.88.1.2");
  });

  it("points an open port with no known address at the local one", () => {
    expect(reachabilityAdvice(opened({ publicAddress: null }))).toContain(
      "192.168.1.45",
    );
  });

  it("has nothing to advise when everything worked", () => {
    expect(reachabilityAdvice(opened())).toBeNull();
  });

  // The point of the issue: every word of the refusal advice is a router
  // setting, and this host has no router to set it on.
  it("asks a machine on its own public address to change nothing", () => {
    expect(reachabilityAdvice(onPublicAddress())).toBeNull();
  });
});

describe("isReachabilityProblem", () => {
  it("counts the two ways of being reachable as success", () => {
    expect(isReachabilityProblem(opened())).toBe(false);
    expect(isReachabilityProblem(onPublicAddress())).toBe(false);
  });

  it("counts every other outcome as a problem", () => {
    expect(isReachabilityProblem(report())).toBe(true);
    expect(isReachabilityProblem(opened({ doubleNat: true }))).toBe(true);
    expect(isReachabilityProblem(opened({ publicAddress: null }))).toBe(true);
  });
});
