# Multiplayer Chat: Channels & DMs

Status: approved design (pending spec review)
Date: 2026-07-02
Branch: `feat/multiplayer-lobby`

## Goal

A polished, iMessage/WhatsApp-style chat experience for the multiplayer lobby:
a conversation **sidebar**, a **main message area** with a **composer** at the
bottom, and a **top bar** naming the current conversation and exposing actions
(e.g. toggle a members list). Conversations are **channels** (joinable, with a
full server channel browser) and **direct messages**.

The chat surface must be built as a **reusable component** so the future battle
GUI can embed the exact same chat interface (in a smaller, non-full-screen box)
and stay visually consistent.

## Decisions (from brainstorming)

- **Layout**: iMessage/WhatsApp - sidebar + main + bottom composer + top bar with
  actions.
- **Placement**: a new top-level **Chat** nav item under Multiplayer, separate
  from the Lobby/battle-browser page.
- **Reuse**: presentational `ChatPane` + a shared `useConversation` hook
  (Approach A). The visual component is store-agnostic and unit-testable; the
  battle GUI reuses it later.
- **Channel joining**: **full channel browser** (server-wide directory) - net-new
  backend work (no `CHANNELS` support exists today).
- **Battle chat**: **not** surfaced in the hub for v1; it stays battle-only (the
  future battle GUI embeds `ChatPane` itself).
- **Notifications**: **unread badges** only for v1 (no mention highlight, no OS
  notifications).
- **Timestamps**: **included** in v1 - messages are stamped at receive time.
- **Disconnected Chat page**: empty state linking to the Lobby page (connection
  management stays on Lobby for v1).

## Current state (what exists)

- `coilbox-lobby-protocol` owns authoritative per-connection `LobbyState`:
  `channels: HashMap<String, ChannelState>` (name, topic, users, `messages`),
  `battles`, `users`. Channel join/leave/say and incoming `SAID` already land in
  state.
- Commands wired in the plugin + `bindings.ts`: `mpSay`, `mpSayPrivate`,
  `mpJoinChannel`, `mpLeaveChannel`.
- `MultiplayerProvider` (`src/multiplayer/store.tsx`) is app-level (above the
  router); it mirrors Rust state by re-fetching a full `mpSnapshot` on every
  `delta` event. The mirror never applies deltas incrementally - correctness over
  cleverness.
- `LobbyPage.tsx` is one flat page (server picker, battle list, user list,
  battle-only chat). No channel switching, no DM surface.

### Gaps this feature must close

1. **DMs have no storage.** `reduce.rs` handles `SAIDPRIVATE` by dropping the
   text and only emitting `Delta::PrivateMessage { from }`. There is no DM
   collection in `LobbyState`.
2. **DMs won't echo.** TASServer broadcasts your own `SAY` back as `SAID` (so
   channel messages appear for free), but does **not** echo `SAYPRIVATE`. Sent
   DMs must be injected into state locally.
3. **No channel directory.** No `CHANNEL`/`ENDOFCHANNELS` parsing, no `CHANNELS`
   command - required for the browser.
4. **No message timestamps.** `ChatMsg` has no time field.

## Architecture

### Backend - `coilbox-lobby-protocol` (pure crate)

**`state.rs`**
- `ChatMsg` gains `at: u64` (unix millis, receive time).
- `LobbyState.dms: HashMap<String, Vec<ChatMsg>>` - one thread per peer username
  (exact-case key; TASServer usernames are case-sensitive).
- `DirChannel { name: String, user_count: u32, topic: Option<String> }`.
- `LobbyState.channel_directory: Vec<DirChannel>`.

**`message.rs`**
- Parse `CHANNEL <name> <usercount> [topic...]` -> `ServerMessage::ChannelInfo`.
- Parse `ENDOFCHANNELS` -> `ServerMessage::EndOfChannels`.

**`command.rs`**
- `Command::ListChannels` -> serializes `CHANNELS`.

**`reduce.rs`** (timestamp threading)
- The reduce entry point takes a `now_ms: u64` argument supplied by the plugin,
  so every `ChatMsg` the reducer builds is stamped deterministically (tests pass
  a fixed value). This replaces clock access inside the pure crate.
- `SaidPrivate { username, message }`: **echo-guard** - if `username ==
  my_username`, skip (we already injected our own copy); otherwise append
  `ChatMsg { channel: None, from: username, text, kind: Private, at: now_ms }` to
  `dms[username]` and keep emitting `Delta::PrivateMessage { from }`.
- New pure `record_outgoing_private(state, peer, text, now_ms) -> Vec<Delta>`:
  append `ChatMsg { from: my_username, kind: Private, at: now_ms, ... }` to
  `dms[peer]`; emit `Delta::PrivateMessage { from: peer }`.
- `begin_channel_list(state)`: clears `channel_directory` (called when a fresh
  `CHANNELS` request is issued).
- `ChannelInfo`: append a `DirChannel` to `channel_directory`.
- `EndOfChannels`: emit new `Delta::ChannelListReceived`.

### Plugin - `tauri-plugin-coilbox-multiplayer`

- **`mp_list_channels(serverKey)`**: call `begin_channel_list`, then send
  `CHANNELS`. New command -> `build.rs` COMMANDS entry + `permissions/default.toml`
  (ACL, per the plugin-command-ACL convention) or it is runtime-blocked.
- **`mp_say_private`**: after a successful send, call `record_outgoing_private`
  on the connection's state and emit a delta so the frontend re-snapshots.
- The reduce call site passes `SystemTime::now()` millis as `now_ms`.

### Frontend - `src/multiplayer`

New `src/multiplayer/chat/`:
- **`ChatPane.tsx`** - presentational, pure. Props:
  `title`, `subtitle?` (topic), `messages: ChatMsg[]`, `members?: User[]`,
  `onSend(text)`, `headerActions?: ReactNode`, `variant: "full" | "embedded"`,
  `emptyState?`. Renders the top bar (title/subtitle + actions slot incl. a
  members toggle), an auto-scrolling message list (author grouping + timestamps),
  and the composer (picoframe `Input` + `Button`, Enter to send). No store
  imports - fully reusable and testable.
- **`useConversation.ts`** - `useConversation(descriptor) -> { title, subtitle,
  messages, members, send }`. `descriptor = {kind:"channel", name} |
  {kind:"dm", peer}` (battle variant added with the battle GUI). Reads the
  mirror; `send()` dispatches `mpSay` (channel) or `mpSayPrivate` (dm).
- **`MemberList.tsx`** - reusable toggleable panel of users + status.
- **`ConversationSidebar.tsx`** - hub-only. Lists joined channels + DM threads,
  each with an unread badge and active highlight; a "Browse channels" button and
  a "New DM" affordance (start a DM by username, or via clicking a user).
- **`ChannelBrowser.tsx`** - picoframe `dialog`. Lists `channelDirectory` with
  Join buttons + a refresh; loading and empty states.
- **`pages/ChatPage.tsx`** - the hub. Composes
  `<ConversationSidebar/> + <ChatPane variant="full"/> + optional <MemberList/>`;
  owns the active-conversation selection. Not-connected -> empty state linking to
  Lobby.

**Store / provider (`store.tsx`)**
- Extend the mirrored `LobbyState` type (`bindings.ts`) with `dms` and
  `channelDirectory`; `ChatMsg` gains `at`.
- Add unread tracking to `MultiplayerProvider` so badges survive navigation:
  a `Map<convId, seenCount>` where `convId = "channel:<name>" | "dm:<peer>"`.
  `unread = messages.length - seen` (clamped >= 0); a `markSeen(convId)` sets
  `seen = current length`. The active conversation is marked seen on view and on
  each new message while active. Count-based, so it is robust against the
  wholesale-snapshot refresh.

**Nav / routes (`index.ts`)**
- Add a `multiplayer.chat` nav item (`to: "/chat"`) next to Lobby, and a `chat`
  route lazy-loading `ChatPage`.

## Data flow

- **Incoming DM**: server -> plugin parse (`now_ms`) -> reducer stores in `dms`
  -> `delta` -> provider re-snapshots -> sidebar thread + unread badge ->
  `ChatPane` renders when active.
- **Send DM**: `ChatPane.onSend` -> `useConversation.send` -> `mpSayPrivate` ->
  plugin sends + `record_outgoing_private` -> `delta` -> snapshot -> message
  appears immediately (no server echo needed).
- **Browse/join**: Browse -> `mpListChannels` -> `begin_channel_list` +
  `CHANNELS` -> `CHANNEL...ENDOFCHANNELS` fills the directory -> `delta` ->
  dialog lists -> Join -> `mpJoinChannel` -> channel appears in the sidebar.

## Error / empty / loading states

- **Not connected**: `ChatPage` empty state with a button linking to Lobby.
- **No conversation selected**: neutral placeholder in the main area.
- **Empty conversation**: `ChatPane` empty state ("No messages yet").
- **Channel browser**: loading indicator while awaiting `ENDOFCHANNELS`; empty
  state if the directory is empty.
- **Send failure**: inline error feedback on the composer.

## Testing

- **Rust unit tests** (follow existing `crates/coilbox-lobby-protocol/tests/`):
  - DM store: incoming `SAIDPRIVATE` stored; outgoing recorded via
    `record_outgoing_private`; **echo-guard** drops a self-sent `SAIDPRIVATE`.
  - Channel directory: `CHANNEL` x N + `ENDOFCHANNELS` -> populated
    `channel_directory` and `Delta::ChannelListReceived`; `begin_channel_list`
    clears it.
  - `Command::ListChannels` serializes to `CHANNELS`.
  - Timestamp threading: reducer stamps `ChatMsg.at` from the passed `now_ms`.
- **Frontend**: `ChatPane` and `useConversation` are isolated and testable with
  mock props/mirror. Primary verification is the CI-equivalent suite plus a live
  smoke:
  - `cargo fmt --all --check`, `cargo clippy --all-targets --all-features -- -D warnings`
  - `bunx biome ci .`, `bun run typecheck`
  - `bun tauri dev`: connect, browse+join a channel, send/receive channel chat,
    open+send a DM, confirm unread badges and the members toggle.

## Out of scope (v1)

- Mention/keyword highlight and OS notifications.
- Battle chat in the hub (battle GUI reuses `ChatPane` separately).
- Persisting chat history across disconnects (in-memory, matches current model).
- Moderation actions, message editing/deletion, emoji/rich text.

## Reuse contract (for the future battle GUI)

The battle GUI renders:

```tsx
<ChatPane variant="embedded" {...useConversation({ kind: "battle", battleId })} />
```

- `ChatPane` never imports the store, so it is identical in both surfaces.
- `variant="embedded"` constrains it to its container (does not claim full
  height) and may hide the sidebar-oriented affordances.
- `useConversation` gains a `battle` descriptor branch (reads the battle's
  `channel` messages/members, `send` -> `mpSay` on that channel) when the battle
  GUI lands.
