# Proving a host is reachable by connecting to them from outside

Answers issue #2119. The recommendation is not to build the client half yet, and the reasons are measurements rather than opinions, so they are written down here instead of being rediscovered.

## Problem

Coilbox decides whether anybody outside can reach a host from two things, and neither is a connection from outside. `crates/tauri-plugin-coilbox-direct/src/portmap.rs` asks the router to open a port and believes the answer. `stun.rs` asks a public server what address the packet arrived from. Both are inference, and there are hosts each gets wrong.

- A cloud instance behind a one to one NAT holds only its private address, so nothing answers a port mapping request and coilbox reports a refusal. Issue #2114 made the words truthful. The verdict is still pessimistic on purpose.
- A router that made a mapping something else in the path drops. The router said yes and meant it. Coilbox reports `open` and the host finds out when nobody joins.

Only an inbound connection settles either. This note is about where one could come from.

## What a probe has to prove

Two different things, and one measurement does not carry the other.

**UDP is the one that matters.** The engine binds one UDP port, 8452 by default, and every joiner's game traffic arrives on it. `battlePorts()` in `src/direct/reachability.ts` asks for that port alone when the battle is hosted on a real lobby server, because coilbox itself listens on nothing in that case.

**TCP only matters for a coilbox room.** `roomPorts()` adds TCP for the in-process lobby server. A host who never runs a coilbox room never needs it.

A TCP connect proving 8200 is open says nothing about UDP 8452. Port mappings are made per protocol, firewall rules are written per protocol, and a NAT keeps separate state for each. So a probe has to do both, or say which one it did.

There is an asymmetry in what a failure means, and it decides the whole design.

- **TCP gives a reliable negative.** The kernel retransmits the SYN on its own. A connect that fails after that is evidence the path is shut.
- **UDP gives no negative at all.** One datagram that does not arrive is a datagram that was lost. Repeating it shrinks the chance without removing it, and there is no measured loss rate here to put a number on how far. So a UDP probe that succeeds is proof, and a UDP probe that fails is only ever "nothing reached the port", never "you are unreachable".

That is why a probe can raise a verdict and must never lower one. It also means the probe does not fix the second failure above. A router whose mapping does not work would report `nothing arrived`, which is worth showing the host and is not grounds for coilbox to overrule the mapping.

## Where an inbound connection could come from

### The STUN servers coilbox already uses cannot do it

This was the free answer, and it is dead. It was measured on 2026-08-30 rather than assumed.

RFC 5780 lets a client ask a STUN server to answer from a second address using CHANGE-REQUEST. A reply arriving from an address the socket has never spoken to is exactly the measurement wanted, because no NAT has a mapping for it. A server advertises the ability by putting OTHER-ADDRESS in an ordinary binding response.

Asking each of the four servers in `stun::SERVERS`:

| Server | OTHER-ADDRESS |
| --- | --- |
| `stun.cloudflare.com:3478` | absent |
| `stun.l.google.com:19302` | absent |
| `stun.nextcloud.com:3478` | `46.225.95.169:443` |
| `stun.sipgate.net:3478` | no answer within 2s |

The one that answers is not a second address. `stun.nextcloud.com` resolves to `46.225.95.169`, and RESPONSE-ORIGIN on the same reply was `46.225.95.169:3478`, so OTHER-ADDRESS is that same machine on port 443. A reply from a second port on the same address passes an address restricted NAT with no port forwarding at all, so it would report every host reachable. All three CHANGE-REQUEST variants went unanswered anyway.

### The TURN relay has no server behind it today

Issue #2119 suggests a TURN allocation, which is a real address on the internet. The trick works: allocate, permit the host's own reflexive address, send an indication back to it.

Coilbox cannot get an allocation. Credentials arrive in a `TURNCREDENTIALS` line from the lobby, and only from a server that advertised the relay flag `r` in its compatibility flags (`coilbox_lobby_protocol::command::RELAY_COMPAT_FLAG`). The test `a_server_says_whether_it_has_a_relay_in_its_compatibility_flags` in `reduce.rs` calls `COMPFLAGS u sp b` "what every server answers today", so no live server mints one. Relay hosting is the client half of a server feature that does not exist yet.

Even once it does, the credential is per battle and the reachability check runs from the hosting form, which a host reaches without a lobby session, and a LAN room never has a server for.

### The relay agent is not on the internet

Worth saying once more because the name invites the mistake. `crates/coilbox-relay-agent` is a sidecar process on the host's own machine. Its allocation is on the internet. It is not.

### Another coilbox client cannot be trusted with it

A reachable peer could send the datagram for free. It needs a rendezvous, it needs a reachable peer to be online at that moment, it hands a stranger the address being probed, and it lets any client aim a packet at any address a rendezvous will name. Every problem the hub design below solves, made worse by there being no operator to rate limit anybody.

### The hub is the only candidate left, and the server half does not exist

`crates/tauri-plugin-coilbox-hub` talks to a Next.js app at `https://coilbox-hub.vercel.app`, in the sibling repository `tomjn/coilbox-hub`. It is coilbox operated, and a distribution can point it elsewhere with the `hubUrl` profile key. Its seven API routes are listed in that crate. None of them takes an address from the client, and there is no route that sends anything anywhere on a caller's behalf.

Two things about it are already right for this.

It is a different machine from the STUN servers, so a datagram from it has no NAT mapping in front of it without a real port forward or endpoint independent filtering. The second address problem solves itself.

It already knows how to read a client's address without being lied to. `lib/assets/uploadIp.ts` in the hub reads `x-real-ip` first, and its own comment says why: the platform sets that header to one address and nothing else can add to it, where `x-forwarded-for` is a list a caller can start.

## The ask, if it is ever built

Two route handlers on the hub, and the rules that keep them from being a port scanner.

```
POST /api/v1/reachability/udp   { "port": 8452, "nonce": "<32 hex chars>" }  -> 204
POST /api/v1/reachability/tcp   { "port": 8200, "nonce": "<32 hex chars>" }  -> 204
```

The UDP handler sends three datagrams carrying the nonce to the caller's own address on the named port. The TCP handler opens one connection to it, writes the nonce, and closes. Both answer 204 and nothing else.

Five rules, and each one is load bearing.

1. **The address is never in the body.** It comes from the request, through the hub's existing `clientIp`. A caller can name a port and cannot name a machine.
2. **The outcome is never returned.** Both handlers answer 204 whatever happened, including a refused connection. The only thing that learns whether the port was open is the socket the host is already holding, and it learns it by receiving the nonce. This is what stops a caller behind carrier grade NAT scanning a neighbour who shares their address. A single nonce sent into the dark tells the sender nothing.
3. **The nonce is the client's.** It has to be unguessable, or a host on a shared address could claim somebody else's arriving datagram.
4. **Rate limited per address.** Traffic aimed at an address by somebody who merely reaches the internet through it is worth capping whatever else is true.
5. **No answer means no answer.** A hub that is asleep, unreachable, disabled by a distribution profile, or answering an error leaves the report exactly as it is today.

## What the client half would be

Recorded so the shape is known, not to be built against a service that does not exist.

`stun::public_address` binds the game UDP port when it can and drops the socket when it returns. A probe needs that socket held open across the hub request and the wait, so the probe belongs next to the STUN round trip in `reachability::open`, not after it. When the port could not be bound, `bind()` falls back to an ephemeral one and the probe would be measuring the wrong port, so it must not run at all.

TCP is harder than it looks. Nothing is listening on the room's TCP port when the hosting form runs its check, so coilbox would have to bind it and accept one connection early, or run the TCP probe only once the room is up.

The report would carry a fourth answer alongside the router's and STUN's, three valued: `arrived`, `nothing arrived`, `not attempted`. `not attempted` is the default and every word the host reads under it is today's word.

## What it degrades to

`reachabilityState` in `src/direct/reachability.ts` keeps its five states and its order. A probe result is a confirmation laid over them, never a sixth state.

- **Not attempted.** Identical to today, including the deliberately pessimistic refusal wording issue #2114 shipped and `reachability.test.ts` pins.
- **Arrived, on a state that reads as a failure.** The host is reachable and the inference was wrong. This is the cloud instance the issue is about, and it is the only case worth building for.
- **Arrived, on a state that already reads as open.** Nothing changes except that the panel can stop hedging.
- **Nothing arrived.** Says so and stops. It does not overrule a mapping, for the reason in the asymmetry above.

## Recommendation

Do not build the client half yet. Three of the four routes are measurably unavailable, and the fourth needs a server that does not exist, on hosting nobody has priced.

The single thing that would settle it is an experiment nobody has run: put a throwaway route on the hub that opens a UDP socket and sends one datagram, deploy it, and see whether the datagram leaves. Vercel functions are HTTP request handlers on AWS Lambda, and whether `dgram` egress works there is not something reading this repository can answer. If it works, the marginal cost is function invocations on hosting that already exists. If it does not, the probe needs a process that is always listening at a fixed address, which is a different product and a bill with no figure attached to it.

The population it would help has no number either. Coilbox has no telemetry, so how many hosts are on a cloud instance behind a one to one NAT is a guess, and the answer decides whether a service is worth operating.

Until then coilbox says what it measured and does not claim the rest, which is where issue #2114 left it.
