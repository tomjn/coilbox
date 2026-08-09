# Tachyon protocol support

Tachyon is the modern lobby protocol used by Teiserver, the Beyond All Reason lobby server. Coilbox speaks the legacy TASServer text protocol today. This document is the design for adding Tachyon alongside it, and is the output of the milestone 7 spike, issue #278.

## Summary

Tachyon is a JSON-over-WebSocket protocol with a JSON Schema definition, typed errors, and OAuth 2.0 authentication. It is live on the Beyond All Reason production server right now, at `wss://server4.beyondallreason.info/tachyon`. The same server still runs TASServer on port 8200, and there is no announced sunset for it.

We are adding Tachyon as a second backend, not replacing TASServer. Coilbox ships five lobby servers and only Beyond All Reason runs Tachyon. `LobbyState` stays the single frontend contract, so a Tachyon connection produces the same state struct and the same delta stream that the TASServer connection produces. The wire changes, the contract does not.

Three things make Tachyon awkward for us.

1. There are no named chat channels. Tachyon messaging can only target a player, a party, or a lobby. Our channel list, channel directory, topics, join and leave, and all ChanServ moderation have no Tachyon equivalent, and this is a deliberate design decision upstream rather than a gap waiting to be filled.
2. Clients cannot host battles. Under Tachyon the server allocates a dedicated autohost, and the autohost interface needs operator-issued bot credentials. Our self-hosting path does not carry over.
3. Signing in requires a system browser. The only interactive flow is OAuth 2.0 authorization code with PKCE and a loopback redirect. There is no password grant and no device code flow.

None of the three blocks the work. Each shapes it.

### How to read the citations

Upstream protocol claims cite paths in `beyond-all-reason/tachyon` at tag `v1.23.0` or `beyond-all-reason/teiserver` at master, and are prefixed `tachyon:` or `teiserver:`. Coilbox claims cite repository paths with line numbers.

## What Tachyon is, and how it differs from TASServer

TASServer is a line protocol. A client writes `JOINBATTLE 42 pass 0`, the server writes back lines beginning with verbs, and the client parses each line positionally. Coilbox handles this in `crates/coilbox-lobby-protocol/src/message.rs:338`, where `parse_line` is a single match with 70 verb arms.

Tachyon is a different kind of protocol in five ways.

### Transport is a WebSocket, not a socket

The connection is a WebSocket at `wss://<server>/tachyon`, with `ws://` allowed for localhost only (`tachyon:docs/connection.md`). Messages are UTF-8 JSON text frames. Binary frames are a protocol error, and Teiserver closes the connection with code `1003` when it sees one (`teiserver:lib/teiserver/tachyon/transport.ex`).

Authorisation happens on the HTTP upgrade request, as an `Authorization: Bearer <token>` header. There is no in-band login exchange and no equivalent of our STLS upgrade dance at `crates/tauri-plugin-coilbox-multiplayer/src/tls.rs:50-74`. TLS is negotiated by the HTTP client before the WebSocket exists.

Protocol version is negotiated through the WebSocket subprotocol. The client lists the versions it supports in `Sec-WebSocket-Protocol`, formatted as `{version}.tachyon`, where version is `v{major}[.{minor}]`. The server picks the highest it also supports and echoes it in the response header. A server must accept a higher minor than it knows if the major matches, because minor versions only add optional extensions. The only version that exists today is `v0`, and Teiserver hardcodes the string `v0.tachyon` at `teiserver:lib/teiserver_web/controllers/tachyon.ex` line 54.

Keep-alive uses the WebSocket ping and pong frames. The server pings at least every ten seconds, jittered. Teiserver picks a random interval between 1000 and 9500 milliseconds. Our WebSocket library must answer pings automatically or we will be disconnected.

When something goes wrong, the peer closes with code `1008` and a short plain string in the close frame body explaining why.

### Every message shares one envelope

Four fields are common to all 166 message schemas: `type`, `messageId`, `commandId`, and then either `data` or `status`.

A request looks like this (`tachyon:schema/lobby/join/request.json`).

```json
{
    "type": "request",
    "messageId": "e0f1c2",
    "commandId": "lobby/join",
    "data": { "id": "75bfc493-2b9d-495d-a453-06722fdca2ea" }
}
```

A success response echoes `messageId` and `commandId`.

```json
{
    "type": "response",
    "messageId": "e0f1c2",
    "commandId": "lobby/join",
    "status": "success",
    "data": { "id": "...", "name": "...", "players": {} }
}
```

A failure carries a machine-readable `reason` and an optional human `details` string.

```json
{
    "type": "response",
    "messageId": "e0f1c2",
    "commandId": "lobby/join",
    "status": "failed",
    "reason": "lobby_full",
    "details": "the lobby has 16 of 16 players"
}
```

Events need no reply and carry a `messageId` that correlates with nothing.

```json
{
    "type": "event",
    "messageId": "a91b",
    "commandId": "lobby/updated",
    "data": { "id": "...", "players": { "1234": { "isReady": true } } }
}
```

Note that the repository's own documentation is out of date here. Both `tachyon:README.md` and `tachyon:docs/commands.md` list only `commandId` and `messageId` in the common-properties table, and neither mentions `type` or `details`. The generated schemas require `type` and permit `details`, and the generator that produces them is `tachyon:src/generate-json-schemas.ts` lines 42 to 103. Trust the schemas over the written description.

Requests flow both ways. `battle/start` and `matchmaking/checkAssets` are server-to-client requests that the client must answer. Teiserver enforces a timeout and drops the connection with code `1008` and the message "Response to request with message id ... not received in time" if the client does not reply.

### Errors are typed

Four failure reasons are added to every command automatically: `unauthorized`, `internal_error`, `invalid_request`, and `command_unimplemented`. Individual commands add their own on top. `lobby/join` adds `lobby_full` and `banned`. `lobby/joinBattle` adds `not_in_lobby`, `no_battle`, and `battle_full`. `messaging/send` adds `message_too_long` and `invalid_target`.

This replaces our current situation, where a rejection arrives as a `DENIED` line with free text, and the reason has to be read by a human.

`command_unimplemented` matters for us specifically. Teiserver returns it for the parts of the spec it has not built yet, so a Tachyon client needs to degrade gracefully rather than treat it as a fatal error.

### The protocol is defined by schemas

The protocol is authored in TypeScript with TypeBox under `tachyon:src/schema/`, and generated into JSON Schema draft-07, TypeScript types, and markdown documentation. `tachyon:CONTRIBUTING.md` states that everything under `schema/` and `docs/` is generated and only `src/` should be edited by hand.

Three generated outputs matter to us.

| Artefact | Path | Use to us |
| --- | --- | --- |
| Per-command schemas | `tachyon:schema/<service>/<endpoint>/{request,response,event}.json` | Reference while implementing |
| Shared definitions | `tachyon:schema/definitions/*.json`, 29 files | Reference |
| Single bundle | `tachyon:schema/compiled.json`, 312 KB | The codegen input |

`compiled.json` is self-contained. Its `$ref`s are rewritten to local `#/definitions/...` pointers, so no network resolver is needed. It is a top-level `anyOf` of 166 command schemas plus 29 definitions. Every schema carries a non-standard `tachyon` annotation giving `source`, `target`, and `scopes`, which is how you determine direction programmatically.

```json
{
    "title": "LobbyJoinRequest",
    "tachyon": { "source": "user", "target": "server", "scopes": ["tachyon.lobby"] }
}
```

### Lobby state arrives as merge patches

This is the largest structural difference from TASServer and the biggest single piece of new work.

TASServer sends discrete events. A player joins, a `JOINEDBATTLE` line arrives. Tachyon sends the full lobby state once on `lobby/join`, and then sends JSON merge patches (RFC 7386) as `lobby/updated` events (`tachyon:src/schema/lobby/updated.ts`, `tachyon:docs/schema/lobby.md`).

Arrays are represented as objects keyed by an ordering string, because merge patch cannot address array elements. Removing an entry means setting its key to `null`.

```json
{
    "teams": {
        "01": { "maxPlayers": 1 },
        "02": null
    }
}
```

Membership is the subscription. There is no subscribe call for `lobby/updated`, joining a lobby is what subscribes you. The lobby list works the same way, with `lobby/subscribeList` followed by `lobby/listUpdated` merge patches and an occasional `lobby/listReset` carrying the whole list.

The state shape itself is richer than ours. `lobbyDetails` (`tachyon:src/schema/definitions/lobbyDetails.ts`) carries `allyTeamConfig` with per-ally start boxes and team caps, `players` keyed by user id with `isReady` and an `assetStatus` of `missing`, `downloading`, or `complete`, `spectators` with an optional `joinQueuePosition`, `bots` with a `hostUserId`, `bosses`, `currentBattle`, `currentVote`, and `voteHistory`.

## What the live server supports today

I verified the following against `server4.beyondallreason.info` on 2026-08-08.

- `GET /.well-known/oauth-authorization-server` returns HTTP 200 with a complete RFC 8414 metadata document.
- `GET /tachyon` with the header `Sec-WebSocket-Protocol: v0.tachyon` and no bearer token returns HTTP 401 with the body `{"error":"unauthorized_client","error_description":"{:error, \"invalid bearer token\"}"}`. That is Teiserver's own error path, so the endpoint is live and only the token is missing.
- TCP port 8200 returns the greeting `TASSERVER 0.38-33-ga5f3b28 * 8201 0`. Legacy TASServer is still running in parallel.

The metadata document is worth reading in full because it constrains our auth design.

```json
{
  "issuer": "https://server4.beyondallreason.info",
  "authorization_endpoint": "https://server4.beyondallreason.info/oauth/authorize",
  "token_endpoint": "https://server4.beyondallreason.info/oauth/token",
  "userinfo_endpoint": "https://server4.beyondallreason.info/oauth/userinfo",
  "token_endpoint_auth_methods_supported": ["none", "client_secret_post", "client_secret_basic"],
  "grant_types_supported": ["authorization_code", "refresh_token", "client_credentials"],
  "code_challenge_methods_supported": ["S256"],
  "response_types_supported": ["code", "token"],
  "scopes_supported": ["tachyon.lobby", "admin.map", "admin.engine", "admin.user", "profile", "email", "groups"]
}
```

### What Teiserver has not implemented

Teiserver bundles only the schemas for the commands it handles, under `teiserver:priv/tachyon/schema/`, and answers `command_unimplemented` for the rest. Diffing that directory against `tachyon:schema/` gives the exact gap.

| Missing from the live server | Added to the spec |
| --- | --- |
| The whole `clan` service, 12 requests and 5 events | 2026-02-13, PR #85 |
| `user/report` | 2026-05-07, PR #138 |
| `battle/ended` | 2026-05-24, PR #139 |
| `matchmaking/checkAssets` | 2026-07-12, PR #146 |
| `matchmaking/queueUpdate` | not dated |
| Autohost `installEngine`, `kickPlayer`, `mutePlayer`, `sendCommand`, `specPlayers` | various |

Clan has been in the spec for six months without a server implementation, which is the clearest signal that spec coverage is not the same as server coverage.

Everything else is implemented. All 19 `lobby/*` requests, all 7 `party/*`, all 6 `friend/*`, all of `messaging`, `system`, and `user` except `report`, and all of `matchmaking` except the two above appear as `handle_command` clauses in `teiserver:lib/teiserver/player/tachyon_handler.ex`.

Teiserver's bundled schema copy also lags the upstream spec. Its `privateBattle.json` still declares `ip` as a plain string, while the spec declares it as a UUID. See the risks section, because that difference is a spec bug rather than a Teiserver bug.

### Undocumented server limits

Two Teiserver behaviours are not in the spec but will affect a real client.

- Rate limit. Player connections are limited to 10 messages per second with a burst of 20 (`teiserver:lib/teiserver/player/tachyon_handler.ex`, `init_rate_limiter/1`). Exceeding it closes the connection with code `1008` and the body "Rate limited".
- Request size. An oversized frame closes the connection with code `1008` and the body "Request too big".

Both are hard disconnects, not soft rejections. Our send path needs its own limiter rather than relying on the server to say no politely.

## Authentication

Tachyon authentication is OAuth 2.0 as profiled by RFC 8252, "OAuth 2.0 for Native Apps". That means authorization code grant, PKCE, and a loopback redirect. The specification is `tachyon:docs/authorization.md`, which carries the status line "Document status: Draft (Pending reference implementation)" despite Teiserver having implemented it and production serving it.

### The flow

1. Fetch `https://<server>/.well-known/oauth-authorization-server`. Clients must not hardcode any endpoint except this well-known path, and must honour the `Cache-Control` header if they cache the response.
2. Generate a PKCE code verifier and its `S256` challenge.
3. Start an HTTP listener on an ephemeral port on `127.0.0.1`.
4. Open the system browser at the authorization endpoint with `response_type=code`, `client_id`, `scope=tachyon.lobby`, `redirect_uri=http://127.0.0.1:<port>/oauth2callback`, `code_challenge_method=S256`, and `code_challenge`.
5. The user signs in on the server's own web page. Teiserver offers email and password, and can broker a second OAuth flow to another identity provider.
6. The browser is redirected to `http://127.0.0.1:<port>/oauth2callback?code=...`, which our listener receives.
7. POST to the token endpoint with an `application/x-www-form-urlencoded` body containing `client_id`, `grant_type=authorization_code`, `code`, `code_verifier`, and `redirect_uri`. The specification made the form-encoded POST explicit in commit "Document the token request as a form-encoded POST" on 2026-07-31.
8. The server returns an access token and a refresh token.
9. Open the WebSocket with `Authorization: Bearer <access_token>`.

### No registration and no secret are needed

This is the most useful finding for us. The specification defines a "Generic Public Client" that servers should provide (`tachyon:docs/authorization.md` lines 54 to 68), and Teiserver creates it at setup time in `teiserver:lib/teiserver/tachyon/tasks/setup_apps.ex` lines 15 to 28.

| Parameter | Value |
| --- | --- |
| `client_id` | `generic_lobby` |
| `redirect_uris` | `http://localhost/oauth2callback` |
| `token_endpoint_auth_method` | `none` |
| `grant_types` | `authorization_code`, `refresh_token` |
| `scope` | `tachyon.lobby` |

Coilbox can use `client_id=generic_lobby` with no registration and no client secret. The specification recommends that official lobbies use a dedicated registration, and requires one for scopes beyond `tachyon.lobby`, but we only need `tachyon.lobby`. The reference client does the same, setting `OAUTH_CLIENT_ID = "generic_lobby"` in `bar-lobby:src/main/config/server.ts`.

The registered redirect URI has no port, and Teiserver deliberately ignores the port when both sides are loopback. `teiserver:lib/teiserver/o_auth.ex` lines 72 to 104 treat `localhost`, `127.0.0.1`, `::1`, and `0:0:0:0:0:0:0:1` as equivalent and skip the port comparison. So an ephemeral port works against the generic registration, and we do not need a fixed port.

### Token lifetimes

Teiserver's values, from `teiserver:lib/teiserver/o_auth.ex`.

| Token | Lifetime |
| --- | --- |
| Authorization code | 5 minutes |
| Access token | 30 minutes |
| Refresh token | 100 years |

The refresh token is effectively permanent. The code comment reads "there's no real recourse when the refresh token expires and it's quite annoying, so make it 'never' expire". So a user signs in through the browser once and stays signed in.

### A browser is required

There is no device code flow, no password grant, and no way to collect credentials inside the app. Teiserver's token endpoint accepts exactly three grant types and rejects everything else with `unsupported_grant_type`. The specification also describes a Steam token exchange flow (RFC 8693) for clients running under the Steam client, but Teiserver does not implement it.

This is a real user-experience change. Today the login panel collects a username and password in-app. On a Tachyon server it becomes a "Sign in" button that opens the browser and waits.

### How this maps onto Tauri

Every piece already has a home in coilbox.

- Opening the browser is `tauri-plugin-opener` or the shell open API. The reference client guards this by refusing any URL that does not start with the resolved authorization server origin, and we should copy that guard.
- The loopback listener is a small HTTP server bound to `127.0.0.1:0` on the Rust side, returning a plain "you can close this window" page and shutting down as soon as it has the code. Give it a timeout, one minute is what `bar-lobby:src/main/oauth2/redirect-handler.ts` uses, so a cancelled sign-in does not leave a listener running.
- Token storage is the existing keychain plugin, `crates/tauri-plugin-coilbox-lobby-servers`. We store the refresh token where we store a password today, under the same `{serverId}:{username}` key shape and the same `coilbox-lobby` service, keeping the process-lifetime cache that stops macOS re-prompting.
- The access token is never persisted. It lives in memory for 30 minutes and is refreshed from the stored refresh token.

The existing login state machine is already shaped for this. `crates/tauri-plugin-coilbox-multiplayer/src/login.rs:121-124` contains the comment `// TODO(teiserver): token auth branch here`, and the module documentation at lines 3 to 5 says the machine was built reply-driven so a token branch can slot in.

One wrinkle: under Tachyon there is no login exchange at all. The token is presented on the HTTP upgrade, so by the time the WebSocket opens we are already authenticated. The Tachyon backend's "login" phase is really "acquire a token", and the phase machine collapses from ten states to something closer to four: discovering, awaiting browser, exchanging code, connected.

Our `password_hash` helper at `crates/coilbox-lobby-protocol/src/hash.rs:12` computes `base64(md5(pw))` and is TASServer-only. It stays, unused by the Tachyon path.

## What it costs us

Going surface by surface through coilbox as it stands.

### Survives untouched

- `LobbyState` at `crates/coilbox-lobby-protocol/src/state.rs:176`. It stays the single authoritative struct and the frontend contract.
- The `Delta` type and its 38 variants. Deltas carry locations rather than payloads, so they are already protocol-agnostic.
- `src/multiplayer/bindings.ts` state types, the `mp_snapshot` call, and the replace-whole-state pattern at `src/multiplayer/store.tsx:920`.
- The four nav gating hooks, `useMpRevealed`, `useMpDisconnected`, `useMpInBattle`, and `useBattleRoomLabel`.
- The seven consumers outside `src/multiplayer`, including `home/continue.ts`, `ResumeRail`, `Greeting`, and `AutojoinChannels`. The last of these degrades to a no-op on a Tachyon connection because there are no channels to auto-join.
- `battle_to_host_config` at `crates/tauri-plugin-coilbox-multiplayer/src/lib.rs:1131-1259` and everything downstream of `BattleConfig`. It reads `LobbyState`, not the wire, so it works for a Tachyon battle as long as the state is populated. Its wire-id renumbering and its 0..200 to 0..1 start-rect conversion are TASServer-shaped, so a Tachyon path needs its own mapping into the same `BattleConfig`.
- The 34 vitest files and 461 pure-function cases.
- `tests/login_transcript.rs` and the transcript testing pattern. Tachyon gets its own transcript test in the same shape, feeding recorded JSON frames through parse and reduce and asserting the resulting `LobbyState`.

### Changes shape

- The connection task in `crates/tauri-plugin-coilbox-multiplayer/src/conn.rs`. Today it is `Framed::new(stream, LinesCodec::new())` at line 175. A Tachyon connection is a WebSocket stream, so the transport becomes an enum with two variants behind a common "next message" interface. The `Arc<Mutex<LobbyState>>` with one writer stays exactly as it is.
- The `LobbyEvent` channel and its five kinds. `console` currently carries raw wire lines in both directions for the debug drawer. It keeps doing that, carrying pretty-printed JSON frames instead of newline-delimited text.
- The login phase machine, as described above.
- `LobbyServer` in `src/lobby-servers/config.ts`, which gains a `protocol` field.
- Two host obligations hardcoded in the read loop, `REQUESTBATTLESTATUS` to `MYBATTLESTATUS` at `conn.rs:235` and `JOINBATTLEREQUEST` to `JOINBATTLEACCEPT` at `conn.rs:244`. Neither has a Tachyon equivalent, because the server owns lobby admission. They stay on the TASServer path only.

### Has no Tachyon equivalent

Named chat channels. This is the big one. Coilbox has channel join and leave, topics, history, a channel directory, and per-channel member lists. Tachyon `messaging/send` accepts exactly three target types, `player`, `party`, and `lobby` (`tachyon:src/schema/messaging/send.ts`), with a 512 character limit. The upstream design note is explicit that this is intentional, `tachyon:src/schema/messaging/README.md` says "we're not building whatsapp or discord". Messages are delivered to online users only, with an opaque `marker` cursor for limited replay after a reconnect.

On a Tachyon connection the chat surface is direct messages plus lobby chat. The channel list, the directory, and `AutojoinChannels` are hidden.

Moderation. `src/multiplayer/moderation.ts` builds raw `SAYPRIVATE ChanServ :op/:kick/:mute/:ban` lines, and the server-moderator actions send `GETIP`, `KICK`, and `BAN` verbs. Tachyon has no moderation surface at all beyond `user/report`, which Teiserver has not implemented, and `lobby/kickban`, which is a lobby-scoped action any member can trigger subject to a vote. The whole moderation UI is hidden on a Tachyon connection.

`mpSend`. The raw-line escape hatch is used by `ConsoleDrawer`, `moderation.ts`, `ChatPage`, `ChannelTopicMenu`, and `MemberActionsMenu`. Every one of these breaks under a different wire protocol. The console drawer gets a Tachyon variant that sends a JSON command rather than a line. The other four are part of surfaces that are hidden anyway.

Self-hosting. Covered in its own section below.

### Becomes better

Votes. `crates/coilbox-lobby-protocol/src/vote.rs` scrapes SPADS vote announcements out of battle chat text with regular expressions. Tachyon has first-class votes. `lobbyDetails.currentVote` carries the vote id, a typed `action`, the initiator, a per-voter map of `pending`, `yes`, `no`, or `abstain`, and an expiry. `lobby/voteSubmit` casts a vote. `lobby/voteEnded` reports one of `passed`, `failed`, `cancelled`, or `timeout`. The vote actions are typed too: `start`, `changeMap`, `appointBoss`, and `kickban` (`tachyon:src/schema/definitions/voteActions.ts`).

Our existing vote panel keeps working, fed by real data instead of scraped text. The scraper stays for TASServer.

Asset readiness. Tachyon has `lobby/updateClientStatus` with `isReady` and `assetStatus` of `missing`, `downloading`, or `complete`. We already know whether the user has the map and game, so we can report it accurately, and matchmaking later depends on it.

### Hosting, the known casualty

Under TASServer, coilbox opens a battle with `mp_open_battle` and 13 fields in literal `OPENBATTLE` wire order, then serves as the host.

Under Tachyon, `lobby/create` creates a lobby, not a battle. When a member sends `lobby/startBattle`, the server picks an autohost from its own pool (`teiserver:lib/teiserver/autohost.ex`, `find_autohost/1`), sends it an `autohost/start` request, and receives back a list of IPs and a port. Each player then receives a server-to-client `battle/start` request whose data is `privateBattle`, containing `username`, `password`, `ip`, `port`, `engine.version`, `game.springName`, and `map.springName`. The client launches the engine against that address and replies with a success response.

Becoming an autohost is a separate actor with separate credentials. `tachyon:src/tachyon-constants.ts` defines three actors, `server`, `user`, and `autohost`. Every autohost command is server-to-autohost or autohost-to-server, and there is no user-to-autohost path. Teiserver routes on the token: a token with an `owner_id` gets the player handler, a token with a `bot_id` gets the autohost handler (`teiserver:lib/teiserver_web/controllers/tachyon.ex` lines 63 to 69). Bot tokens come from the `client_credentials` grant with a client id and secret issued by the server operator.

We are not solving this in this milestone. On a Tachyon connection the Host button is hidden, the same way it is already hidden when logged out. `SkirmishPage.tsx` already gates it on being connected, so the gate widens rather than moves.

What solving it would take, for a later milestone:

- A client id and secret issued by the Beyond All Reason server operators for a coilbox autohost.
- A second connection type in the multiplayer plugin using the `client_credentials` grant and the autohost handler.
- Implementations of `autohost/start`, `kill`, `addPlayer`, `kickPlayer`, `mutePlayer`, `specPlayers`, `sendMessage`, `sendCommand`, and `subscribeUpdates`, plus the `autohost/status` and `autohost/update` events.
- Launching `spring-dedicated` or `spring-headless` and reporting the bound IPs and port back in the `autohost/start` response.

Note the ceiling on this. `tachyon:src/schema/autohost/README.md` states that only "slaved" mode is specified, where the server brokers everything, and that "dedicated mode might not be ever realized". A coilbox autohost would be a machine offering itself to the Beyond All Reason server's pool, not a way for a player to host a private game. That may not be the feature people actually want.

## The architecture we are building

Six decisions, already taken.

### 1. Tachyon is additive

Both protocols ship side by side, indefinitely. Coilbox ships five lobby servers and only Beyond All Reason runs Tachyon. Beyond All Reason still runs TASServer on port 8200 with no announced sunset, and Teiserver's own README still describes itself as "currently implementing the Spring protocol but with work being done on a new protocol Tachyon". Switching wholesale would delete working features, chat channels most obviously, for every user on every server.

### 2. `LobbyState` stays the single frontend contract

A Tachyon backend produces the same `LobbyState` and emits the same `Delta` stream. Everything above the connection survives: the state types in `bindings.ts`, the snapshot-on-delta pattern, the reconnect loop, unread and highlight handling, and the nav gating hooks.

Where Tachyon has no equivalent for a `LobbyState` field, that field stays empty. `channels` is an empty map on a Tachyon connection. The struct does not fork, and there is no `LobbyState` enum. An empty collection is a perfectly good representation of "this server has none of these".

The practical consequence is that the two backends share `state.rs`, `status.rs`, and the `Delta` type, and differ in parsing and reduction. `crates/coilbox-lobby-protocol` keeps the TASServer parse and reduce. A new `coilbox-tachyon-protocol` crate holds the Tachyon parse and reduce, and depends on the shared state types.

### 3. `LobbyServer` gains a `protocol` discriminator

`src/lobby-servers/config.ts` has no protocol field today, and the five builtin servers, including `bar` at `server4.beyondallreason.info:8200` and `bar-ssl` at port 8201, are modelled purely as TASServer endpoints.

We add `protocol: "tasserver" | "tachyon"`, defaulting to `"tasserver"`. Existing stored configuration and existing keychain entries keep working with no migration, because an absent field reads as the default. `migration.ts` already establishes the pattern for changing stored server shapes, with a pure `planMigration` that returns described keychain moves rather than performing IO, so if we later need to move keys we have the mechanism.

`serverKey` is derived as `${username}@${host}:${port}` at `src/multiplayer/store.tsx:84`. A Tachyon server's identity is a URL origin rather than a host and port, so a Tachyon entry stores a port of 443 and the key shape survives. That is slightly artificial but it avoids touching every consumer of `serverKey`.

The frontend uses the discriminator to hide surfaces the connected protocol cannot serve: the channel list, the channel directory, moderation menus, and the Host button on Tachyon, and parties and matchmaking on TASServer.

### 4. Schema types are generated in-tree

We vendor `tachyon:schema/compiled.json` into a new `coilbox-tachyon-protocol` crate and generate Rust types with `typify` in `build.rs`, mirroring what the `tachyon-rs-types` crate does.

We do not depend on `tachyon-rs-types`. It is three schema minors behind at 1.20.3 against a spec at 1.23.0, it has 48 total downloads, and its stated repository URL returns 404, so it is deleted or private with no issue tracker. Generating in-tree also lets us patch the `privateBattle.ip` bug described in the risks section.

The known-good toolchain is `schemars` 0.8.22 to parse the draft-07 root schema, `typify` 0.7.0 to build the type space, and `prettyplease` with `syn` to emit. The `tachyon-rs-types` crate uses typify 0.6.1, but 0.7.0 is current, still builds on schemars 0.8.22, and generates clean code. Generated code needs `serde`, `serde_json`, `uuid` for the `format: uuid` on `battleId`, and `regress` for `pattern` constraints such as the `^[0-9a-zA-Z .+-]+$` on `engineVersion`.

Ignore the generated root type. Typify turns the 166-member top-level `anyOf` into a struct with 166 `Option` fields flattened with serde, one per command, which cannot discriminate anything. The per-command types it generates are good, `LobbyJoinRequest` as a struct and `LobbyJoinResponse` as a two-variant enum. We hand-write the envelope and dispatch on the pair `(commandId, type)` into the named per-command types.

The envelope we write by hand looks like this.

```rust
struct Envelope {
    r#type: MessageType,
    message_id: String,
    command_id: String,
    #[serde(flatten)]
    body: RawBody,
}
```

Parse in two passes. Read the envelope, match on `(command_id, type)`, then deserialise `data` into the generated per-command type. An unrecognised `command_id` becomes an `Unknown` variant carrying the raw JSON, mirroring the `ServerMessage::Unknown{raw}` catch-all at `crates/coilbox-lobby-protocol/src/message.rs`. Parsing must be total and must never fail, exactly as it is today.

### 5. New features are new surfaces, gated on the discriminator

Matchmaking and parties are things Tachyon has and TASServer does not. They are new UI, gated on `protocol === "tachyon"`, and they land after core connectivity rather than with it. Clans are in the spec but not on the server, so they are out of scope entirely until Teiserver implements them.

### 6. Hosting is deferred

Covered above. The Host button is hidden on a Tachyon connection, and a later milestone can pick up the autohost work once someone has decided whether a coilbox autohost is a feature worth having.

### How a Tachyon connection produces `LobbyState`

The pipeline mirrors the TASServer one, with one extra step.

1. The WebSocket task reads a text frame.
2. `parse_frame` reads the envelope and produces a `TachyonMessage`, total and infallible.
3. `reduce_at(&mut LobbyState, TachyonMessage, now_ms) -> Vec<Delta>` folds it into the shared state and reports what moved.
4. Each `Delta` goes down the existing `tauri::ipc::Channel<LobbyEvent>` and the React store calls `mp_snapshot`.

The merge patch application sits inside step 3, not step 2. Parsing produces the patch as a typed structure, and reduction applies it, because that is where the deltas can be worked out by comparing before and after.

The patch is applied to the Tachyon lobby type, the generated counterpart of `lobbyDetails`, which the connection holds as the authoritative Tachyon-side lobby. It is not applied to `LobbyState` directly. A patch is shaped exactly like `lobbyDetails` and nothing like our `Battle` struct, so patching `LobbyState` would mean translating every field by hand. Projecting the Tachyon lobby into `LobbyState` is a separate step, and a separate function that can be tested on its own.

Apply merge patches directly against our own typed state, not against a stored `serde_json::Value` mirror. Keeping a shadow JSON document and re-deserialising it on every event would be simpler to write and much harder to reason about, and it would put an untyped copy of the lobby next to the typed one. Instead, each patch type from `tachyon:src/schema/lobby/updated.ts` is a struct of `Option` fields where the RFC 7386 `null` becomes an explicit "remove" case. That distinction, absent field versus present-and-null, is the whole trick, and needs a small helper type since `Option<Option<T>>` with serde does not express it correctly by default.

Write this as a pure function with its own unit tests before wiring anything to a socket. It is the single most bug-prone piece of the work.

## Staged delivery plan

Four stages. Each is shippable in the sense that it leaves the app working, though only stage 2 makes Tachyon useful to a player.

### Stage 1: foundations

Everything below the protocol logic. Nothing user-visible ships.

- A `coilbox-tachyon-protocol` crate with the vendored `compiled.json`, a `build.rs` running typify, the hand-written envelope, and total two-pass parsing with an `Unknown` catch-all. Includes the local patch for the `privateBattle.ip` schema bug.
- A WebSocket transport. Coilbox has zero WebSocket dependencies today, so this adds one, most likely `tokio-tungstenite`. It must set the `Sec-WebSocket-Protocol: v0.tachyon` and `Authorization: Bearer` headers on the upgrade, answer server pings, surface close codes and close-frame bodies as diagnostics, and enforce a client-side send limit below the server's 10 per second with burst 20.
- Request and response correlation. A map from `messageId` to a pending oneshot, with a timeout, plus the inverse path for server-to-client requests like `battle/start` that we must answer before Teiserver drops us.
- The OAuth flow. RFC 8414 discovery with `Cache-Control` respected, PKCE with `S256`, a loopback listener on `127.0.0.1:0` with a one-minute timeout, opening the system browser with an origin guard, the form-encoded token POST, refresh, and refresh-token storage in the existing keychain plugin.
- The `protocol` discriminator on `LobbyServer`, defaulting to `tasserver`, plus a sixth builtin server entry for Beyond All Reason over Tachyon.

Unlocks: nothing for users. Everything for stages 2 to 4.

### Stage 2: core parity

The stage that makes Tachyon usable. The goal is that a user can sign in to Beyond All Reason over Tachyon, see who is online, browse and join a lobby, chat, and launch a battle.

- Connect and handshake, and the collapsed login phase machine.
- Users. `user/self`, `user/updated`, `user/info`, `user/subscribeUpdates`, and `user/unsubscribeUpdates` folded into `LobbyState.users`. `privateUser` carries our own party, friend ids, incoming and outgoing friend requests, ignore list, current lobby, and matchmaking state, so this one event populates a lot.
- Friends. All six `friend/*` requests and all five events.
- The lobby list. `lobby/subscribeList`, `lobby/listUpdated`, and `lobby/listReset` into the battle list.
- The merge patch applier, as a standalone tested unit.
- The lobby room. `lobby/join`, `lobby/updated`, `lobby/left`, and `lobby/leave`.
- Lobby actions. `joinAllyTeam`, `spectate`, `joinQueue`, `updateClientStatus`, `addBot`, `updateBot`, `removeBot`, `update`, `kickban`, `appointBoss`, and `unboss`.
- Votes. `currentVote` and `voteHistory` from lobby state, `lobby/voteSubmit`, and `lobby/voteEnded`, wired into the existing vote panel.
- Messaging. `messaging/subscribeReceived` with the `since` marker, `messaging/send`, and `messaging/received`, mapped onto direct messages and lobby chat.
- Battle launch. Answering the server's `battle/start` request, mapping `privateBattle` into `BattleConfig`, and launching.
- Lobby creation. `lobby/create` and `lobby/startBattle`, which is creating a lobby rather than hosting a battle and needs its own UI copy so the difference is not confusing.
- Protocol gating in the frontend. Hide the channel list, the channel directory, moderation menus, `AutojoinChannels`, and the Host button on a Tachyon connection.
- A Tachyon transcript test in the shape of `tests/login_transcript.rs`.

Unlocks: Tachyon is a usable lobby.

### Stage 3: new surfaces

Features Tachyon has that TASServer does not. Gated on the discriminator.

- Parties. `party/create`, `invite`, `acceptInvite`, `declineInvite`, `cancelInvite`, `kickMember`, and `leave`, plus the `party/invited`, `party/updated`, and `party/removed` events. Party state already arrives in `privateUser`, so stage 2 will have populated some of this.
- Matchmaking. `matchmaking/list`, `queue`, `ready`, and `cancel`, plus the `found`, `foundUpdate`, `lost`, `cancelled`, and `queuesJoined` events. Note that `queueUpdate` and `checkAssets` are in the spec but not on the server, so the search-progress display and party asset checking degrade until Teiserver catches up.

Clans are excluded. The server does not implement them.

Unlocks: the reasons a Beyond All Reason player would prefer coilbox over the official client.

### Stage 4: polish

- Token refresh mid-session, so a 30 minute access token does not end a long session, and reconnect that reuses the stored refresh token without a browser round trip.
- Rate-limit backoff and a queue on the send path, so a burst of UI actions cannot trip the server's limiter.
- A Tachyon console drawer showing pretty-printed JSON frames in both directions, and a send box that takes a command id and a data object rather than a raw line.
- A documented workflow for refreshing the vendored schema, with the tachyon package version pinned and recorded so a bump is a deliberate act.
- Graceful `command_unimplemented` handling, so a server that is behind the spec produces a clear message rather than a broken screen.

### What depends on what

- The schema crate needs nothing. Start here.
- The WebSocket transport needs nothing, and can be built in parallel with the schema crate.
- Request correlation needs the transport and the envelope from the schema crate.
- OAuth needs nothing from the protocol at all, and can be built and tested against the live server on its own.
- Connecting needs OAuth, the transport, and the `protocol` discriminator.
- Everything in stage 2 needs connecting.
- The lobby room needs the merge patch applier.
- The lobby list needs the merge patch applier.
- Lobby actions need the lobby room.
- Votes need the lobby room.
- Battle launch needs request correlation, because `battle/start` is a server-to-client request we must answer.
- Lobby creation needs lobby actions.
- Matchmaking needs parties, because a party member queuing puts the whole party in the queue.
- The transcript test needs the lobby room, so it has something worth asserting.
- Token refresh mid-session needs OAuth and connecting.

## Trade-offs and risks

### The protocol is at v0 and the auth document is a draft

`tachyon:docs/connection.md` says the only supported version is `v0` "during the active development phase of protocol", and `tachyon:docs/authorization.md` carries "Document status: Draft (Pending reference implementation)". The version negotiation rules do promise that minor versions are additive only and that a server must accept a higher minor with the same major, but v0 has no stability guarantee at all. The schema package moved from 1.20.0 to 1.23.0 in four months, with changes including a new `checkAssets` request, unit restrictions on lobbies, and a `battleId` type change.

Mitigation: pin the vendored schema, treat unknown command ids as `Unknown` rather than errors, and treat unrecognised enum values as unknown rather than failing the parse. Plan on a schema refresh being routine work rather than a one-off.

### Teiserver lags the spec, in both directions

The server does not implement clans, `user/report`, `battle/ended`, `matchmaking/checkAssets`, or `matchmaking/queueUpdate`, and its bundled schema copy is older than the spec. So building against the spec can produce code that the server answers with `command_unimplemented`, and building against the server can produce code that the spec says is wrong.

Mitigation: implement against the spec, gate features on what the server actually answers, and handle `command_unimplemented` as a soft degradation everywhere.

### Two spec bugs to work around

`privateBattle.ip` is declared as a reference to `battleId`, which is `{"type": "string", "format": "uuid"}` (`tachyon:src/schema/definitions/privateBattle.ts` line 7). So the schema says the game server's IP address must be a UUID. Teiserver's older bundled copy has a plain string and the live server sends a real IP address. A strict client generated from `compiled.json` will fail to parse `battle/start`, which is the single most important message in the whole protocol for us. This was introduced by the commit "battleId is a uuid" on 2026-06-16. We patch it locally in the vendored schema and report it upstream.

`schema/system/disconnect/request.json` requires `type`, `messageId`, and `commandId` but not `data`, while `data.reason` is required inside `data`. Every other request with a payload requires `data`. Harmless, but it will look like a codegen bug when someone hits it.

### The flattened root codegen trap

Typify turns the top-level `anyOf` into a struct with 166 flattened `Option` fields rather than a tagged enum. It compiles, it serialises, and it is useless. It also generates 68 near-duplicate `TachyonCommandSubtypeNNNReason` enums, one per response, because each failure reason enum is inlined and most of them list the same four reasons. Those numbers move when the schema is re-vendored, so match on a reason by its wire value rather than by generated type name. Anyone opening the generated file for the first time will reasonably assume the codegen failed.

Mitigation: document this at the top of the generated crate, hand-write the envelope, and never reference the generated root type.

### The rate limit and the request timeout are hard disconnects

10 messages per second with a burst of 20, and a request timeout on server-to-client requests. Both end the connection with close code `1008` rather than returning an error. A UI that fires several commands on one click, or a client that is slow to answer `battle/start`, will simply drop off the server.

Mitigation: a send-side limiter with a margin below the server's, and answering server requests from the connection task rather than round-tripping through the frontend.

### The chat channel gap is permanent

This is not a Teiserver backlog item, it is an upstream design decision. `tachyon:src/schema/messaging/README.md` is explicit about not building a chat platform. So a coilbox user on a Tachyon server permanently loses the channel list, the channel directory, topics, and channel moderation.

There is no mitigation, only a decision about presentation. Hiding the surfaces is cleaner than showing empty ones, and matches how the Host button already behaves when logged out. The risk is that a user who switches servers thinks the app broke. A short explanatory note on the chat screen when connected over Tachyon would cost little.

### Adding a WebSocket dependency

The workspace has zero WebSocket dependencies today, and the only HTTP client is reqwest 0.12 in the downloads and content plugins, which the lobby crates cannot reach. Stage 1 adds a WebSocket client, and OAuth adds an HTTP client to the lobby crates. That is new ground in the dependency tree and new work for the release build on three platforms.

Mitigation: prefer a client that reuses whichever TLS backend the workspace already uses, so we do not end up shipping two TLS stacks.

### Two backends is real ongoing cost

Every future lobby feature has to be considered twice, or explicitly declared to be one protocol only. The gating discriminator makes that visible rather than accidental, but it does not make it free.

## Open questions

These are genuinely unresolved. Each is small, and each could change a stage 1 or stage 2 decision.

- Is token revocation implemented? `tachyon:docs/authorization.md` line 73 requires RFC 7009 token revocation and says clients must use it to revoke refresh tokens on sign out. I found no revocation route in Teiserver's router and none in the production metadata document. If it is not implemented, "sign out" can only mean deleting our stored refresh token, which leaves a valid 100-year token on the server. Worth confirming before writing the sign-out path.
- Is the WebSocket endpoint discoverable? The specification carries an open TODO at line 37 asking whether the Tachyon WebSocket endpoint should be advertised in the OAuth metadata under a custom key. It is not today, so the `/tachyon` path is a convention we have to hardcode. If that changes, our server configuration gets simpler.
- Does Chobby speak Tachyon? I found no evidence either way and did not read the Chobby source. It matters only for judging how settled the protocol is.
- Is `beyond-all-reason/tachyon-client` still maintained? It is a TypeScript client library at version 11.0.0, last pushed 2026-03-23, five months stale. The reference client `bar-lobby` has its own in-tree implementation, so the standalone library may be abandoned. It matters only as a reference for reading.
- Is Tachyon gated on the production server? The endpoint responds and rejects an absent token correctly, but I could not authenticate to test a real session. Whether every account can connect, or only accounts with a flag set, needs a real sign-in to answer. This should be the first thing stage 1 proves.
- What is the real port and identity for a Tachyon server entry? Storing 443 in `LobbyServer.port` to preserve the `serverKey` shape works but is artificial. If a cleaner identity is wanted, `migration.ts` gives us the mechanism, at the cost of touching every `serverKey` consumer.
