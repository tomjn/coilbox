# LAN and direct hosting: serverless host and join

Resolves the design discussion in issue #204.

## Problem

Hosting a battle today needs a lobby server. Two people on the same network, or two friends who know each other's IP, cannot play without one. skylobby solves this with a WebSocket server inside the host client (`graal/clj/skylobby/direct.clj`) and a `!map` / `!mod` / `!bset` chat layer, because it has no host UI. It has no local network discovery at all.

Coilbox is better placed. It already has the host-powers UI, and its battle room is a projection of `LobbyState`, which is built by folding server-to-client messages through `reduce()`. So the cheapest correct design is to produce those same messages locally.

## Principle

The host runs a TASServer subset in process. Joiners connect with the existing client path, unchanged. The host's own UI connects to it over loopback. One code path for battle room, chat, host powers, start-script generation and launch.

Coilbox never hosts the game itself. The engine does, as it does today: `battle_to_host_config` sets `IsHost=1`, `HostIP=0.0.0.0`, `HostPort`, and joiners get a five-line client script. This work replaces the lobby layer only. Game traffic is untouched.

## Handshake the server must satisfy

Verified against `crates/coilbox-lobby-protocol/src/login.rs` and `crates/tauri-plugin-coilbox-multiplayer/src/conn.rs`.

```
S: TASSERVER 0.38 * 8452 0          exactly 4 fields or the line parses as Unknown
C: LISTCOMPFLAGS
S: COMPFLAGS u sp                   required, or login never leaves awaitCompFlags
C: LOGIN <name> <pwhash> 0 * Coilbox <ver>\t<clientId>\tu sp
S: ACCEPTED <name>                  or DENIED <reason>
S: LOGININFOEND                     required, and the only thing that makes the client ready
```

There is no read or idle timeout in `run_loop`. A server that omits `COMPFLAGS` or `LOGININFOEND` hangs the joiner with no error. These two lines are the highest-risk part of the build.

The client sends its own `PING` every 30 seconds as keepalive and expects no reply. If the server sends `PING <token>` the client answers `PONG <token>`. Unknown commands are ignored silently: replying `FAILED cmd=...` pops a toast, and the client sends `FRIENDLIST`, `FRIENDREQUESTLIST`, `IGNORELIST` and channel joins automatically on ready.

## Room messages

About 20 of the ~80 `ServerMessage` variants:

- `ADDUSER` per member, `REMOVEUSER` on leave
- `BATTLEOPENED` with a `__battle__<id>` channel in the sixth tab field, or battle chat is unavailable
- `OPENBATTLE <id>` to the host, `JOINBATTLE <id> <hash> [channel]` to a joiner, `JOINBATTLEFAILED <reason>` on refusal
- `JOINEDBATTLE <id> <name> [scriptPassword]`, `LEFTBATTLE`, `BATTLECLOSED`
- `CLIENTBATTLESTATUS <name> <statusInt> <colorInt>`, `REQUESTBATTLESTATUS`
- `ADDBOT` / `UPDATEBOT` / `REMOVEBOT`
- `SETSCRIPTTAGS` / `REMOVESCRIPTTAGS`, `ADDSTARTRECT` / `REMOVESTARTRECT`
- `UPDATEBATTLEINFO`, `HOSTPORT`
- `SAIDBATTLE` / `SAIDBATTLEEX`
- `CLIENTSTATUS`

Ordering constraint: `SETSCRIPTTAGS` and `ADDSTARTRECT` carry no battle id and apply only to `current_battle`, so they must follow the join acknowledgement, never precede it.

Starting the match: TASServer has no start message. `BattleRoomPage.tsx` auto-launches a joiner when `users[battle.host].status.ingame` becomes true. So the server sets the host's ingame bit and broadcasts `CLIENTSTATUS`. This already works, so it needs no new client code.

## Components

### 1. `coilbox-lobby-protocol::server` (pure, no IO)

Mirrors the existing split, where the crate owns protocol and the plugin owns sockets.

- `parse_client_line(&str) -> ClientCommand`, the direction `message.rs` does not cover
- server line builders, the direction `command.rs` does not cover
- `RoomState` plus `apply(peer, ClientCommand) -> Vec<Outbound>`, where `Outbound` is unicast or broadcast. Same testable shape as `reduce()`.

`RoomState` holds what the room needs and `LobbyState` does not: peer identity, per-member script passwords, and the approval queue.

### 2. `tauri-plugin-coilbox-direct` (IO)

`TcpListener`, one task per peer, handshake, disconnect cleanup. Commands: start room, stop room, room status, approve join, deny join, kick.

Default lobby port 8200. The engine's game port stays 8452.

### 3. Discovery

UDP beacon every 2 seconds, sent to both a fixed multicast group and the subnet broadcast address, carrying room name, game, map, player count, port and whether it is passworded. A listener on the joining side builds a live list and expires entries after a few missed beacons.

Needs `socket2` for address reuse so two coilboxes on one machine can both listen.

### 4. Reachability

- UPnP-IGD and NAT-PMP mapping for the lobby TCP port and the engine's UDP port. Mapping only one of them gets people into the room and then fails at launch.
- STUN to learn the public address, confirm the mapping took, and show the host a copyable `address:port`.
- Wire the same mapping into the existing self-hosted battle path, where the UI currently tells the host to port-forward by hand.

Hole punching is out. It needs both peers to learn each other's endpoint through a third party, and there is no third party here by definition. Issue #440 owns the relay fallback.

### 5. Frontend

Reaching any of this comes first. The Battles page is where hosting lives, and its nav item was revealed on first connect and then sticky for the session, so on a fresh install with every server down there was no way in. That is the exact case this milestone exists for, so the item is visible whether or not there is a connection, and the page has a logged out state: the direct hosting entry works, and the server battle list says it is not connected and points at Login rather than showing an empty list that reads like nobody is playing. The gate that stays is `isProfileHidden`, so a distribution profile can still hide it.

Once a room starts, the host's own client connects to loopback, which flips the same session flag and brings the rest of the Lobby nav group back by itself.

- "Host on LAN" beside the existing host popover: room name, optional password, port, discovery on or off, internet reachability on or off, approve joins on or off.
- LAN section on the Battles page, fed by the beacon.
- Join by typed `address:port`.
- Join approval prompt and a kick that blocks for the rest of the session.

The battle room needs no changes.

## Identity and access

No accounts. The joiner presents the name from its coilbox profile. The host rejects duplicates and suggests a suffix. Room password optional. A player who drops and reconnects during the same room session reclaims their team, ally and colour by name, matching the auto-rejoin behaviour built for real servers in #192.

Join approval is an opt-in host toggle, default off, so nobody has to watch the screen on a trusted LAN. It matters more once port mapping puts the host on the public internet. `JOINBATTLEACCEPT` and `JOINBATTLEDENY` already exist in the protocol crate, and `mp_join_battle_deny` is already a Tauri command with no caller.

## Failure states

Every one of these gets explicit UI, not a silent failure:

- Lobby port already in use
- Router refuses or lacks UPnP and NAT-PMP: show manual forwarding instructions with both port numbers
- STUN unreachable: show the LAN address only
- Name already taken: suggest a suffix
- Wrong room password
- Joiner missing the map or game: block their launch with the reason, since content sync is out of scope
- Host quits mid-room: joiners get a named disconnect, not a silent drop
- Access point client isolation blocks the beacon: empty LAN list, prompt for a typed address

## Out of scope

- Serving maps and games to joiners over the connection. A LAN party with no internet cannot fix a missing map. Revisit as its own milestone once the transport exists.
- NAT hole punching and relay. See #440.
- Chat commands as a control surface. Coilbox has host UI, so `!map` and friends stay unimplemented.
- Compatibility with skylobby's direct-connect protocol.

## Verification

- Round-trip tests: server builds a line, the existing `parse_line` and `reduce` consume it, assert the resulting `LobbyState`.
- Loopback integration test running the real server against the real connection task, covering login, join, options, boxes, bots, chat and the ingame launch trigger.
- Beacon encode and decode unit tests, including expiry.
- Two-machine LAN test before merge. Needs the user, and cannot be faked locally.
- Port mapping cannot be verified in CI. Manual test on a real router, with the failure path checked by disabling UPnP.
