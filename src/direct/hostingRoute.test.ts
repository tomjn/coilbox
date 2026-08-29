import { describe, expect, it } from "vitest";
import {
  advertisedGamePort,
  battleRouteLabel,
  chosenHostingRoute,
  hostingRoute,
  hostingRouteSummary,
  NAT_TYPE_DIRECT,
  recordHostingRoute,
} from "./hostingRoute";
import type { DirectReachability } from "./reachability";

/** A report with nothing in it, so each test says only what it is about. */
function report(over: Partial<DirectReachability> = {}): DirectReachability {
  return {
    method: null,
    ports: [],
    wanted: [{ port: 8452, externalPort: 8452, transport: "udp" }],
    lanAddress: "192.168.1.45",
    publicAddress: null,
    routerAddress: null,
    doubleNat: false,
    confirmedPort: null,
    problem: null,
    ...over,
  };
}

/** The router refused, which is the outcome most home routers give. */
function refused(over: Partial<DirectReachability> = {}): DirectReachability {
  return report({
    publicAddress: "209.35.91.246",
    problem: "no UPnP gateway answered",
    ...over,
  });
}

/** The port opened and the internet answered. */
function opened(over: Partial<DirectReachability> = {}): DirectReachability {
  return report({
    method: "upnp",
    ports: [{ port: 8452, externalPort: 8452, transport: "udp" }],
    publicAddress: "209.35.91.246",
    routerAddress: "209.35.91.246",
    confirmedPort: 8452,
    ...over,
  });
}

describe("hostingRoute", () => {
  // Rung one. This machine answers on the address the internet sees, so there
  // was never anything to open and no router to ask. The port mapping half
  // reports a refusal here, because there is no gateway to answer it, and that
  // refusal must not push a host who is already on the internet down the ladder.
  it("takes the direct route when this machine's own address is the public one", () => {
    const out = hostingRoute(
      report({ lanAddress: "209.35.91.246", publicAddress: "209.35.91.246" }),
      true,
      true,
    );
    expect(out).toBe("direct");
  });

  // Two nulls are not a match. A machine with no local address and no STUN
  // answer knows nothing about itself, and calling that "direct" would advertise
  // a battle nobody can reach.
  it("does not read two unknown addresses as a public one", () => {
    expect(hostingRoute(report({ lanAddress: null }), false, true)).toBe(
      "unreachable",
    );
  });

  // Rung two.
  it("takes the port mapping when the router opened the port", () => {
    expect(hostingRoute(opened(), true, true)).toBe("portMapped");
  });

  // The ladder is ordered, not scored. A host who needs nothing opened is not
  // relayed because a relay happens to exist.
  it("prefers a route it already has over one it could ask for", () => {
    expect(
      hostingRoute(
        opened({ lanAddress: "209.35.91.246", publicAddress: "209.35.91.246" }),
        true,
        true,
      ),
    ).toBe("direct");
    expect(hostingRoute(opened(), true, true)).toBe("portMapped");
  });

  // The whole reason this milestone exists. The router says yes and means it,
  // and the ISP's own NAT is still in the way, so this must not read as a route.
  it("relays a mapping that is stuck behind the provider's own NAT", () => {
    const out = hostingRoute(
      opened({ routerAddress: "100.88.1.2", doubleNat: true }),
      true,
      true,
    );
    expect(out).toBe("relay");
  });

  // Rung three, in the ordinary case: a home router that would not open a port.
  it("relays when the router refused and the server has a relay", () => {
    expect(hostingRoute(refused(), true, true)).toBe("relay");
  });

  // The end of the ladder. Not every server has a relay, and one that does not
  // leaves nothing to step down to, so this has to be a state of its own rather
  // than a relay that will never happen.
  it("has nowhere to go when the router refused and there is no relay", () => {
    expect(hostingRoute(refused(), false, true)).toBe("unreachable");
  });

  it("has nowhere to go behind the provider's NAT with no relay", () => {
    expect(
      hostingRoute(
        opened({ routerAddress: "100.88.1.2", doubleNat: true }),
        false,
        true,
      ),
    ).toBe("unreachable");
  });

  // The mapping worked and no STUN server would say what address it is behind.
  // A lobby server fills the host's address in from the connection it is already
  // holding, so what STUN was missing is the host's own copy of it, not the
  // route.
  it("keeps the port mapping when the ports opened and STUN did not answer", () => {
    expect(hostingRoute(opened({ publicAddress: null }), true, true)).toBe(
      "portMapped",
    );
  });

  // The toggle that opens ports is off by default and opening a port on
  // somebody's router is not a thing to do because they opened a form. With it
  // off nothing has been measured, so there is no evidence to step down the
  // ladder on, and a host who never asked coilbox to look must not be relayed
  // for it.
  it("says nothing is known when nobody asked the router anything", () => {
    expect(hostingRoute(null, true, true)).toBe("unchecked");
    expect(hostingRoute(null, false, true)).toBe("unchecked");
  });
});

// Issue #2023. The preference is one step of the ladder and no more: it decides
// whether the second rung falls through to the third, and it may not reach any
// of the rungs above, because a host who can be reached directly was never
// going to be relayed and turning the relay off must not cost them the route
// they already had.
describe("hostingRoute with the relay turned off", () => {
  it("stops at unreachable where it would have relayed", () => {
    expect(hostingRoute(refused(), true, false)).toBe("unreachable");
  });

  it("stops at unreachable behind the provider's own NAT", () => {
    expect(
      hostingRoute(
        opened({ routerAddress: "100.88.1.2", doubleNat: true }),
        true,
        false,
      ),
    ).toBe("unreachable");
  });

  // The acceptance criterion in the issue, stated as the thing that could go
  // wrong: somebody turns the relay off and hosting changes for them in some way
  // other than not being relayed.
  it("leaves every other route exactly as it was", () => {
    const reports = [
      null,
      report({ lanAddress: "209.35.91.246", publicAddress: "209.35.91.246" }),
      opened(),
      opened({ publicAddress: null }),
      // Both ends of the ladder as well, so a route that was already
      // "unreachable" is not quietly reached by a different path.
      refused(),
      report({ lanAddress: null }),
    ];
    for (const each of reports) {
      for (const relayAvailable of [true, false]) {
        const withRelay = hostingRoute(each, relayAvailable, true);
        // Only the rung that the preference is on may move, and only downwards.
        const expected = withRelay === "relay" ? "unreachable" : withRelay;
        expect(hostingRoute(each, relayAvailable, false)).toBe(expected);
      }
    }
  });

  // Nothing was measured, so there is nothing to fall through from. A host who
  // has not asked the router anything gets the same answer either way, and a
  // preference that changed this would be answering a question nobody asked.
  it("says nothing is known when nobody asked the router anything", () => {
    expect(hostingRoute(null, true, false)).toBe("unchecked");
  });
});

describe("advertisedGamePort", () => {
  // The bug a router that hands back a different port would cause: the battle
  // is advertised on the port the engine binds, and everybody outside dials a
  // port that is closed.
  it("advertises the router's port when the router picked a different one", () => {
    const remapped = opened({
      ports: [{ port: 8452, externalPort: 8460, transport: "udp" }],
      confirmedPort: null,
    });
    expect(advertisedGamePort("portMapped", remapped, 8452)).toBe(8460);
  });

  it("advertises the port the engine binds when the router kept it", () => {
    expect(advertisedGamePort("portMapped", opened(), 8452)).toBe(8452);
  });

  // A mapping exists in the report on this route and is no use: the provider's
  // NAT is in front of it. Advertising the router's port would name a door in a
  // corridor nobody can walk down.
  it("ignores a mapping on a route that did not take it", () => {
    const stuck = opened({
      ports: [{ port: 8452, externalPort: 8460, transport: "udp" }],
      routerAddress: "100.88.1.2",
      doubleNat: true,
    });
    expect(advertisedGamePort("relay", stuck, 8452)).toBe(8452);
    expect(advertisedGamePort("unreachable", stuck, 8452)).toBe(8452);
  });

  // The report settles 600ms behind the port field, so a host who types a new
  // port and presses Host inside that window is holding a report about the old
  // one. Falling back to what the engine is about to bind is right. Naming the
  // old port's mapping is not.
  it("falls back to the engine's port when the mapping is for another one", () => {
    expect(advertisedGamePort("portMapped", opened(), 8500)).toBe(8500);
  });

  it("advertises the engine's own port when nothing was measured", () => {
    expect(advertisedGamePort("unchecked", null, 8452)).toBe(8452);
    expect(advertisedGamePort("direct", null, 8452)).toBe(8452);
  });

  // Only the game's port. A room maps its own lobby port too, and that is a TCP
  // port a joiner reaches the room on rather than the port the engine binds.
  it("reads the game's UDP mapping and not the room's TCP one", () => {
    const room = opened({
      ports: [
        { port: 8200, externalPort: 8300, transport: "tcp" },
        { port: 8452, externalPort: 8460, transport: "udp" },
      ],
    });
    expect(advertisedGamePort("portMapped", room, 8452)).toBe(8460);
  });
});

describe("NAT_TYPE_DIRECT", () => {
  // Every route coilbox can take ends in an address a joiner dials straight,
  // including the relay, whose address is a genuinely public one. So there is
  // one value, and it is not a choice.
  it("is the plain direct mode", () => {
    expect(NAT_TYPE_DIRECT).toBe(0);
  });
});

describe("hostingRouteSummary", () => {
  it("names the relay when the battle is going through one", () => {
    expect(hostingRouteSummary("relay", { lanRoom: false })).toContain("relay");
  });

  // A room on a LAN is doing its job with no route out at all, so neither of
  // the two outcomes that are failures for a lobby battle may read as failures
  // here.
  it("does not call a LAN room a failure for having no way out", () => {
    for (const route of ["unreachable", "unchecked"] as const) {
      const lan = hostingRouteSummary(route, { lanRoom: true });
      expect(lan).toContain("this network");
      expect(lan).not.toBe(hostingRouteSummary(route, { lanRoom: false }));
    }
  });

  it("has a sentence for every route", () => {
    for (const route of [
      "direct",
      "portMapped",
      "relay",
      "unreachable",
      "unchecked",
    ] as const) {
      expect(
        hostingRouteSummary(route, { lanRoom: false }).length,
      ).toBeGreaterThan(0);
      expect(
        hostingRouteSummary(route, { lanRoom: true }).length,
      ).toBeGreaterThan(0);
    }
  });

  // Issue #2023. There are two ways to end up with no route, and they call for
  // different words. "This server has no relay" is a fact about somebody else's
  // server, and telling a host that when they are the one who said no leaves
  // them looking for a fault that is a checkbox they ticked.
  it("does not blame the server for a relay the host turned off", () => {
    const declined = hostingRouteSummary("unreachable", {
      lanRoom: false,
      relayDeclined: true,
    });
    expect(declined).not.toContain("this server has no relay");
    expect(declined).toContain("relay");
    expect(declined).not.toBe(
      hostingRouteSummary("unreachable", { lanRoom: false }),
    );
  });

  // And the other way round. A host who left the relay on and still has no
  // route is being let down by the server, and saying so is the only thing that
  // tells them trying a different one would help.
  it("still names the missing relay when the host asked for one", () => {
    expect(
      hostingRouteSummary("unreachable", {
        lanRoom: false,
        relayDeclined: false,
      }),
    ).toContain("this server has no relay");
  });

  // A room on a LAN has no relay to decline, so the preference never appears in
  // that form. If some later caller passes it anyway, the room's own sentence
  // wins: it is not a failure and must not start reading as one.
  it("keeps a LAN room's wording whatever the preference says", () => {
    expect(
      hostingRouteSummary("unreachable", {
        lanRoom: true,
        relayDeclined: true,
      }),
    ).toBe(hostingRouteSummary("unreachable", { lanRoom: true }));
  });

  // The cost is said once, at the point the choice is made, which is the
  // checkbox in the hosting form and not here. This sentence describes the route
  // that was taken.
  it("does not repeat the relay's cost in the route it describes", () => {
    expect(hostingRouteSummary("relay", { lanRoom: false })).not.toContain(
      "ping",
    );
  });
});

describe("the word a battle room shows for its route", () => {
  it("names each route somebody could be sitting on", () => {
    expect(battleRouteLabel("direct", { lanRoom: false })?.word).toBe("Direct");
    expect(battleRouteLabel("portMapped", { lanRoom: false })?.word).toBe(
      "Port opened",
    );
    expect(battleRouteLabel("relay", { lanRoom: false })?.word).toBe("Relayed");
    expect(battleRouteLabel("unreachable", { lanRoom: false })?.word).toBe(
      "Not reachable",
    );
  });

  // The reason somebody looks at this at all. The hosting form's sentence leaves
  // the cost to the checkbox that asks about the relay, because that host is
  // choosing. This reader is not, and "why is my ping worse" is the question
  // that brought them here (issue #2071).
  it("says what the relay costs, which the hosting form's sentence does not", () => {
    const detail = battleRouteLabel("relay", { lanRoom: false })?.detail ?? "";
    expect(detail).toContain("ping");
    expect(hostingRouteSummary("relay", { lanRoom: false })).not.toContain(
      "ping",
    );
  });

  // The two direct routes are the good news, so neither may borrow the relay's
  // explanation for a bad ping.
  it("blames nothing for a battle that was never relayed", () => {
    for (const route of ["direct", "portMapped"] as const) {
      expect(battleRouteLabel(route, { lanRoom: false })?.detail).not.toContain(
        "relay",
      );
      expect(battleRouteLabel(route, { lanRoom: false })?.detail).not.toContain(
        "ping",
      );
    }
  });

  // The port check is off by default in both hosting forms, so this is what most
  // battles report. A word for it would be a word on nearly every battle, saying
  // only that nobody looked.
  it("says nothing when nothing was ever checked", () => {
    expect(battleRouteLabel("unchecked", { lanRoom: false })).toBe(null);
    expect(battleRouteLabel(null, { lanRoom: false })).toBe(null);
  });

  // A room on a LAN that the internet cannot reach is a room on a LAN. Calling
  // that "not reachable" would report the feature as a fault.
  it("does not call a LAN room a failure for being a LAN room", () => {
    expect(battleRouteLabel("unreachable", { lanRoom: true })).toBe(null);
  });

  // The good routes still mean the same thing in a room as on a server: someone
  // outside can get in, which is worth knowing either way.
  it("still names a room's route when there is one to name", () => {
    expect(battleRouteLabel("direct", { lanRoom: true })?.word).toBe("Direct");
    expect(battleRouteLabel("portMapped", { lanRoom: true })?.word).toBe(
      "Port opened",
    );
  });
});

describe("the recorded route", () => {
  it("holds the route the last host took, for the pages that come after", () => {
    recordHostingRoute("relay");
    expect(chosenHostingRoute()).toBe("relay");
  });

  // Both forms clear it before they try, so what a failed host leaves behind is
  // nothing rather than the route of the battle before it.
  it("can be dropped, so a failed host describes no route at all", () => {
    recordHostingRoute("portMapped");
    recordHostingRoute(null);
    expect(chosenHostingRoute()).toBe(null);
  });
});
