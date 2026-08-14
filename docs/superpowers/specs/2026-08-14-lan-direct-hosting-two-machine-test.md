# Two machine test: hosting a battle with no server

The manual half of issue #1573. Everything below needs two real machines on one network, which is why no test in the repo can do it.

Design: `2026-08-13-lan-direct-hosting-design.md`. The loopback suite in `crates/tauri-plugin-coilbox-multiplayer/src/direct_loopback.rs` already proves the protocol against the real client, so this script is only about the things a second machine and a real network can break: discovery, the addresses a joiner types, the engine connecting, and what people see when it goes wrong.

Allow about 40 minutes for parts 1 to 4, and another 15 for part 5.

## Before you start

Machine A hosts. Machine B joins. Every step says which one.

1. Both machines on the same network, wired or the same wifi. A guest network on either side will fail part 1, which is worth knowing but is not the test.
2. Both have the same engine version, the same game and the same map installed. Coilbox serves no content, so a mismatch is a separate failure with its own step later.
3. Give the machines different player names. Two clients called Player are refused with a free name suggested, which the loopback suite already covers and which only gets in the way here.
4. Note both builds. Same commit on both, or say which is which in the report.
5. On A, allow the app through the firewall if the OS asks. macOS asks the first time the engine binds its port.

## Reporting

If a step does not do what it says, stop and write down these five things before trying anything else:

- The step number.
- Which machine it happened on.
- The exact words on screen, copied, not paraphrased.
- What the other machine showed at the same moment.
- Whether a retry of the same step behaves the same way.

That is enough to open an issue from. "It did not work" is not, because most of these steps fail in more than one way and the wording is what tells them apart.

## Part 1: the room comes up and is found

### 1. A starts a room

Do: on A, open Battles, press Host on LAN, leave the port at 8200, leave Advertise on the local network ticked, leave Reachable over the internet and Approve joins unticked, press Start room.

Look for: A lands in the battle room, and the sidebar gains an item named after the room.

If it fails: a room that will not start says why in the drawer. "Port 8200 is already in use" means a second coilbox or a room left running, so pick another port and carry it through the rest of the script.

### 2. A reads its own address

Do: on A, go back to Battles and read the line above the battle list.

Look for: the room's address on this network, as `address:port`, with Copy and Copy link beside it, plus a Same machine line for 127.0.0.1. Underneath, "Announced on this network."

If it fails: "Not heard announcing itself yet" that never changes means the beacon is not making it back, which step 3 will confirm. A machine with no network address at all says so instead, and that is a machine that cannot host to anybody.

Then: press Copy link on the network address and keep it. It is a `coilbox://room` link carrying the same address, and step 4 uses it.

### 3. B finds the room without being told anything

Do: on B, open Battles and look at Rooms on your network. Wait five seconds.

Look for: the room, with A's room name, the game, the map and a count.

If it fails: this is the case the design calls access point client isolation, and it is common on hotel and campus wifi. Do not stop. Go to step 4, use the address from step 2, and record part 1 as "not announced, joined by address" in the report. Everything after step 4 still holds.

### 4. B joins

Do: on B, press Join on the room, or Join by address and type the `address:port` from step 2. Put a name in and press Join room.

Look for: B lands in the battle room. A's roster gains B within a second, and B's roster shows both people.

If it fails: "this room has no battle open" means A is not in its own battle, so send A back to step 1. A join that hangs with nothing on screen is the failure the whole design is built around, so capture it carefully: it means a line of the handshake never arrived.

Then, once B has left again: send B the link from step 2 by any means, and have B open it.

Look for: coilbox on B comes to the front with the join form already filled in with A's address and port. B still has to put a name in and press Join room, which is deliberate.

If it fails: on a build installed from a release the scheme is registered with the OS, but a `bun tauri dev` build on B may not be. If nothing happens at all, note which kind of build B is running, and treat it as untested rather than broken.

## Part 2: the room works

### 5. What A changes reaches B

Do: on A, press Change map and pick a different map. Then open Battle options and change one option.

Look for: B's map panel and options follow within a second, without B doing anything.

If it fails: note whether one of the two arrived and the other did not. Options and the map travel on different messages.

### 6. Start boxes

Do: on A, set Start positions to "Choose in-game", then drag a box on the minimap for ally A and another for ally B.

Look for: both boxes appear on B's minimap.

If it fails: check B is not still on "Fixed (map)" in its own reading of the room, which would mean the option in step 5 did not arrive either.

### 7. Bots and chat

Do: on A, add an AI from the picker under the player list. Then type a line in Battle chat. Have B reply.

Look for: the AI appears in B's player list with the same team and colour. Both lines appear on both machines.

### 8. B takes a seat

Do: on B, pick a team and an ally, and set a colour.

Look for: A sees the change on B's row. This one matters more than it looks: A's copy of B's seat is what goes into the start script.

## Part 3: the match

### 9. Start

Do: set Ready on both machines, then press Start on A. Start stays disabled until everyone is ready, and the tooltip on it says which condition is unmet.

Look for: the engine launches on A. Within a few seconds it launches on B by itself, with nobody pressing anything on B.

If it fails on B only: A's ingame bit is what starts B, so a B that sits still means the bit did not arrive. Note whether B's roster shows A as in game.

### 10. The two engines find each other

Do: watch both engine windows for 30 seconds.

Look for: both players in the game, both able to give orders, no "connection attempt failed" and no "waiting for player" that never ends.

If it fails: this is the step nothing in the repo can test, so it is the most valuable failure in the script. Record whether the lobby side worked (it did, or step 9 would have failed), then check A's firewall for a rule on port 8452 UDP. Say which OS is on A.

### 11. Quit

Do: quit the engine on both machines.

Look for: both are back in the coilbox battle room, and neither has been thrown out of the room.

## Part 4: the failures worth checking

Each of these is its own run. Restart from step 1 between them.

### 12. A room nobody can hear

Do: on A, start a room with Advertise on the local network unticked.

Look for: A's room line says "Not announced on this network, so give joiners your address." B's Rooms on your network stays empty and says so, and B can still join with Join by address.

Why: this is the same thing a network that blocks broadcast produces, and the difference between the two on screen is only the wording of A's line.

### 13. A joiner missing the map

Do: on B, either uninstall the map the room is on, or have A pick a map B does not have.

Look for: B's own row says the content is missing, B's Start is blocked with the reason naming the map, and A sees B as out of sync on the roster.

Then: on A, press Start anyway. A is asked to confirm and B is named in the question. Answer yes.

Look for: A's engine launches, B's does not, and B is told the match started without it and why.

If it fails: the thing to capture is silence. B sitting there with no reason on screen is the bug. B being blocked with a clear reason is the pass.

### 14. Approval and refusal

Do: on A, start a room with Approve joins ticked. Have B join.

Look for: B waits with nothing happening and no error. A's battle room shows a line saying somebody is waiting, naming B, with Approve and Reject for that name.

Do: press Reject. Then have B try to join again.

Look for: B is told it was turned away, and the second attempt is refused with "the host has already turned you away from this battle" rather than queueing in front of A again.

### 15. Kick

Do: with B in the room, use the actions on B's row on A and press Kick.

Look for: B is told it was kicked. B trying to rejoin is refused with the same reason, for as long as the room is up.

### 16. A quits mid room, two ways

Do: with B in the room, press Stop room on A. Watch B's screen at the moment you press it.

Look for: a notification on B naming A and saying the room closed, rather than a silent drop. It is a toast, so it is easy to miss if you look away.

Do: start again, and this time quit coilbox on A outright, or pull its network cable.

Look for: B says the connection was lost and is retrying. It will keep retrying, because from B's side an unreachable host and a host that will be back in a moment look the same.

### 17. B drops and comes back

Do: with B in the room and holding a team, ally and colour that are not the defaults, quit coilbox on B and rejoin with the same name.

Look for: B gets the same team, ally and colour back, without A doing anything.

If it fails: note the name B rejoined under. Reclaim is by name, so a different name is a different person by design.

## Part 5: the router

Needs a real home router, and only the host's machine.

### 18. The ports open

Do: on A, start a room with Reachable over the internet ticked.

Look for: a line beginning "Open.", naming what forwarded the ports and which ports, with an address to give people outside the network and a Copy beside it. It takes a few seconds.

If it says the router refused: that is a valid result, not a failed test. Record the router make and model and the router's own words, which are shown under the plain English.

### 19. The failure path

Do: turn UPnP off in the router's admin page. Restart the room on A with Reachable over the internet ticked.

Look for: "Your router would not open the ports", and instructions naming both the room port and 8452, rather than a spinner or silence.

Then: turn UPnP back on.

### 20. Somebody outside actually joins

Only if you have a machine on another network, for example a phone tethering a laptop.

Do: give that machine the address from step 18 and join by address.

Look for: the same result as step 4, and then the same result as step 10.

If it fails at step 10 but not step 4: the room port is open and the game port is not, which is the exact case the design opens two ports to avoid. Say so in the report, because it means the mapping half-worked.

## What a pass looks like

Parts 1 to 3 all green on two machines is what issue #1573 asks for. Part 4 is what makes the milestone worth shipping: every one of those cases has to say something rather than nothing. Part 5 can legitimately come back "router refused", and that result closes the port mapping half of the issue as long as step 19 shows the instructions.
