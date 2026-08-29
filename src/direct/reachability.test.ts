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
    problem: "no UPnP gateway answered",
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

  it("calls a router that opened nothing refused", () => {
    expect(reachabilityState(report({ problem: "no gateway" }))).toBe(
      "refused",
    );
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
        opened({ lanAddress: "209.35.91.246", publicAddress: "209.35.91.246" }),
      ),
    ).toBe("direct");
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
    expect(isOnPublicAddress(report({ publicAddress: "209.35.91.246" }))).toBe(
      false,
    );
    expect(isOnPublicAddress(report({ lanAddress: null }))).toBe(false);
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
});

describe("isReachable", () => {
  it("is true only when the ports opened onto the real internet", () => {
    expect(isReachable(opened())).toBe(true);
    expect(isReachable(opened({ doubleNat: true }))).toBe(false);
    expect(isReachable(report())).toBe(false);
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

  it("says the router refused when it did", () => {
    expect(reachabilityHeadline(report())).toBe(
      "Your router would not open the ports.",
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
