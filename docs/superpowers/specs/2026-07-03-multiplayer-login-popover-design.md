# Multiplayer login popover (breadcrumb status button)

**Date:** 2026-07-03 **Branch:** feat/multiplayer-lobby **Status:** Design approved, ready for implementation plan

## Summary

Move the multiplayer lobby "login" UI out of the LobbyPage and into a popover opened from an icon button in the breadcrumb bar (the framework `TopBar`'s `topbar.right` slot). The button appears only when a lobby server is configured, doubles as a live connection-status indicator, and provides log-out. It becomes the single entry point for connecting; not-connected CTAs elsewhere in the app open this same popover rather than navigating to the lobby.

This is a step toward retiring the dedicated login screen. LobbyPage itself is retained for now because it hosts other content (server/protocol console, battles, online users, battle chat) that has no other home yet.

## Motivation

Today, connecting requires navigating to `/lobby`, using an inline server picker
+ Connect/Disconnect section, and the connection status is only visible on that page. A persistent breadcrumb-bar control makes connection state visible from anywhere and makes connecting a one-click, in-context action.

## Current state (as of this branch)

- **Topbar slot:** picoframe's `TopBar` renders `<Slot id="topbar.right">`. The updater plugin already mounts a component there (`src/updater/index.ts` -> `UpdateBadge`), which is the pattern this feature follows. Radix popovers portal to `document.body`, so the topbar's `data-tauri-drag-region` on `<header>` does not interfere with the panel.
- **Connection state:** React context in `src/multiplayer/store.tsx` (`MultiplayerProvider` / `useMultiplayer()`), registered app-level in `src/multiplayer/index.ts` so it outlives route changes. Context value exposes `mirror`, `activeKey: string | null` (null = disconnected), `busy: boolean`, and actions `connect(server)`, `disconnect()`, plus channel helpers. The connected username lives at `mirror.state.myUsername`. Phases are `LoginPhase` in `src/multiplayer/bindings.ts` (`awaitGreeting | tlsUpgrade | awaitCompFlags | awaitAccepted | streamingState | ready | denied`).
- **Configured servers:** `useLobbyServers()` in `src/lobby-servers/config.ts` reads the `lobbyServers.directory` setting (`{ servers: LobbyServer[] }`). "A server is configured" == `servers.length > 0`. Credentials live in the OS keychain (there is no password field in the UI).
- **Login UI today:** `src/multiplayer/pages/LobbyPage.tsx`, the "Connection controls" `<section>` (~lines 117-153): server `<Select>`, Connect/Disconnect toggle, status line.
- **Not-connected CTAs:** `src/multiplayer/pages/ChatPage.tsx` (~lines 48-63) renders a "Go to the Lobby to connect" `<Link to="/lobby">` when `!activeKey`.
- **UI primitives:** no popover/dropdown component is installed; `src/components/ui/` has `select.tsx`, `tooltip.tsx`, `checkbox.tsx`, `textarea.tsx`, all wrapping the unified `radix-ui` dependency.

## Design

### Architecture decision: shared popover-open state

The popover is anchored to the topbar button, but must be openable from CTAs elsewhere. The open state therefore crosses component boundaries. **Chosen approach: hold the open flag in the existing `MultiplayerContext`.** The provider is already app-level and is already the single owner of lobby state, so this adds a boolean + two actions and no new wiring. Rejected alternatives: a dedicated context (more boilerplate for one flag) and an event bus (un-idiomatic here, harder to trace).

### 1. Context changes -- `src/multiplayer/store.tsx`

Extend `MultiplayerContextValue` with:

- `loginPopoverOpen: boolean`
- `openLoginPopover(): void`
- `closeLoginPopover(): void`

Backed by `useState`. On a successful transition to a connected state, close the popover automatically (nicety; keep it simple - a `useEffect` on `activeKey` going non-null, or close within the connect flow).

### 2. Topbar slot component -- `src/multiplayer/LobbyStatusButton.tsx`

Registered in `src/multiplayer/index.ts`:

```ts
slots: [{ slot: "topbar.right", order: -10, Component: LobbyStatusButton }]
```

(order -10 places it to the left of the updater badge at order 0.)

- **Visibility:** render nothing unless `useLobbyServers().servers.length > 0 || activeKey != null`. The `activeKey` clause keeps the button (and its log-out) available if the connection is live but the server directory was emptied.
- **Anchor:** icon-only button (lucide icon, e.g. `Users` or `Plug`) with a small **status dot** overlay:
  - grey / muted = disconnected
  - amber, pulsing = connecting (any non-ready, non-denied phase while `busy`)
  - green = connected / `ready`
  - red = error or `denied` Wrap the button in the existing `Tooltip` for a text label.
- Anchors a **controlled** Radix `Popover` whose `open` is bound to `loginPopoverOpen` (`onOpenChange` -> open/close actions).

### 3. Popover panel contents (state-driven)

Reuses today's connect logic (moved out of LobbyPage):

- **Disconnected:** title (e.g. "Multiplayer"), server `<Select>` built from `useLobbyServers()`, `Connect` button honoring `busy`, inline `error` line when present, and a "Manage servers" link to `/settings/lobby-servers`.
- **Connecting:** current `LoginPhase` label + spinner + `Cancel` (calls `disconnect()`).
- **Connected:** server name + `mirror.state.myUsername`, green dot, quick links (Lobby / Chat), and **`Log out` = `disconnect()` only** (keychain and config untouched; reconnect is one click).

The panel may live in the same file as the button or a sibling `LoginPopover.tsx`; keep each file focused.

### 4. LobbyPage -- `src/multiplayer/pages/LobbyPage.tsx`

- **Remove** the "Connection controls" section (server picker + Connect/Disconnect
  + status line, ~lines 117-153).
- **Keep** the page and all other content (server/protocol console, battles, online users, battle chat), still gated on an active connection.
- Replace the page's not-connected empty state with a short hint + a button that calls `openLoginPopover()` (no inline picker).

### 5. App-wide not-connected CTA audit

Rewire every "not connected -> go connect" prompt to call `openLoginPopover()` instead of navigating to `/lobby`.

- Known targets: `ChatPage.tsx` ("Go to the Lobby to connect") and LobbyPage's stripped empty state.
- Grep for `/lobby` links and not-connected branches (`!activeKey`, `!connected`, "connect" prompts) to catch any others before finalizing.

### 6. New UI primitive -- `src/components/ui/popover.tsx`

Add via the sanctioned picoframe registry channel (per project CLAUDE.md):

```
npx shadcn@latest add @picoframe/popover
```

It lands in `src/components/ui/` matching the `select.tsx` / `tooltip.tsx` `data-slot` + `cn()` convention.

## Out of scope

- Removing LobbyPage or the `/lobby` route entirely.
- Username/password entry UI or credential management (stays in `/settings/lobby-servers` + keychain).
- Multi-connection (connecting to more than one server at once): the model remains a single `activeKey`.
- Changing auto-rejoin / remembered-channel behavior.

## Verification

- `bunx biome ci .` and `bun run typecheck` pass (CI parity per CLAUDE.md).
- Manual smoke via `bun tauri dev`:
  1. No servers configured -> button absent.
  2. Add a server -> button appears; click opens popover; dot grey.
  3. Connect -> dot amber (connecting) -> green (ready); username shown in panel.
  4. Log out -> `disconnect()`, dot returns to grey, button still present.
  5. Open a multiplayer screen while disconnected -> its CTA opens the same
     topbar popover.
- If a frontend test harness exists, add a light component test for the status-dot/visibility state mapping; otherwise verification is typecheck + lint + the manual smoke above. (Confirm harness presence during implementation.)

## Open questions

None blocking. Icon choice (`Users` vs `Plug`) and whether the panel is one file or two are implementation details.
