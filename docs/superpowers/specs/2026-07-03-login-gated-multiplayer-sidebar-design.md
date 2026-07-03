# Login-gated multiplayer sidebar

**Date:** 2026-07-03
**Branch:** feat/multiplayer-lobby
**Status:** design approved, pending spec review

## Problem

The multiplayer plugin currently contributes three always-visible sidebar items
(Lobby, Chat, Battles) regardless of connection state. Login lives in a topbar
popover. We want the sidebar to reflect connection state:

- On first app open (never connected this session), the sidebar shows only a
  **Login** entry for multiplayer.
- After the first successful connect, **Chat** and **Battles** appear and the
  **Login** entry disappears; the user is redirected to Battles.
- On logout/disconnect, the **Login** entry returns (for reconnect) while Chat
  and Battles remain visible.
- Login affordances read **"Reconnect"** once the user has connected at least
  once this session.
- Once Chat/Battles appear they stay for the rest of the session (until the app
  is closed).

## The reconciled visibility model

| Sidebar item | Visible when | Kind |
| --- | --- | --- |
| **Login** (renamed from Lobby) | `!connected` | toggles both ways |
| **Chat** | `revealed` (`hasConnectedThisSession`) | sticky — never re-hides in a session |
| **Battles** | `revealed` | sticky |

A full session:

```
fresh open           -> [Login]
connect              -> redirect to Battles; [Chat, Battles]
logout / disconnect  -> [Login, Chat, Battles]   (Login returns; Chat/Battles stick)
reconnect            -> [Chat, Battles]
```

- `connected` = `activeKey != null` (existing store signal).
- `revealed` = session-sticky flag, set `true` whenever `activeKey` becomes
  non-null (including reload-reattach), never reset by disconnect/logout.
  In-memory only, so quitting the app naturally resets it (matches "until the
  app is closed").

## Frame capability used (no frame changes)

`@picoframe/frame@0.0.11` + `@picoframe/plugin-sdk@0.0.5` (already published and
now pinned in `package.json`) ship exactly what this needs:

- `NavItem.useVisible?: () => boolean` — a hook evaluated in the item's own
  render inside the sidebar, so it may call `useContext`/`useMultiplayer()`.
  Returns `false` to hide the item.
- `NavGate({ use, redirectTo, children })` — route guard mirroring a
  `useVisible` predicate; renders children when `use()` is true, else redirects
  (replacing history) to `redirectTo`.

`AppFrame` renders plugin `Provider`s around the routed tree, and the sidebar
lives in the `<AppLayout>` root layout route inside that tree, so
`useVisible`/`NavGate` predicates can read `MultiplayerProvider` context.

Rule of hooks constraint (from the SDK docs): a given nav item `id` must keep a
stable shape — always define `useVisible` or never. Each of Login/Chat/Battles
consistently defines its own, so this holds.

## Changes

### 1. Store — `src/multiplayer/store.tsx`

Extend `MultiplayerContextValue` with:

- `connected: boolean` = `activeKey != null`.
- `revealed: boolean` = session-sticky reveal flag.

Implementation: hold `revealed` in provider state; set it `true` in an effect
whenever `activeKey` transitions to non-null (covers connect and reload
reattach). Never cleared by `disconnect`/reset.

Export two predicate hooks (used by nav `useVisible`):

- `useMpRevealed = () => useMultiplayer().revealed`
- `useMpDisconnected = () => !useMultiplayer().connected`

### 2. Nav + routes — `src/multiplayer/index.ts`

- `multiplayer.lobby` item: label `"Login"`, keep `to: "/lobby"`, add
  `useVisible: useMpDisconnected`, use a log-in icon.
- Route for `path: "lobby"`: keep the path, set `crumb: "Login"`.
- `multiplayer.chat` item: add `useVisible: useMpRevealed`.
- `multiplayer.battles` item: add `useVisible: useMpRevealed`.
- Sidebar order unchanged (Chat then Battles once revealed).

### 3. Route hard-gates — `NavGate`

Wrap each page's default export:

- Login page (`/lobby`): `<NavGate use={() => !connected} redirectTo="/battles">`.
  This also delivers **redirect-to-Battles on login**: when `connected` flips
  true while on `/lobby`, NavGate bounces to Battles.
- Chat page: `<NavGate use={() => revealed} redirectTo="/lobby">`.
- Battles page: `<NavGate use={() => revealed} redirectTo="/lobby">`.

### 4. Login page — repurpose `LobbyPage`

The Lobby page (already stripped to a not-connected CTA by recent refactors)
becomes the login screen. Extract/export the existing `LoginPanel` from
`LobbyStatusButton.tsx` and render it page-sized as the page body, rather than
duplicating connect logic. Remove the old `openLoginPopover` "Connect…" CTA —
the page itself is now the login UI. Because the page's `NavGate` redirects when
connected, the panel only ever renders its connect/server-list state here.

### 5. "Reconnect" labelling — shared `LoginPanel`

In `LoginPanel`, when `revealed && !connected`, the per-server connect buttons
read **"Reconnect"** (else "Connect"). Since the panel is shared between the
Login page and the topbar popover, this covers both — satisfying "any login
buttons show a reconnect button similar to the existing login button".

### 6. Topbar `LobbyStatusButton` — kept

Retained as a global connection-status dot with quick connect/reconnect/logout
from any page. Inherits the shared reconnect labelling via `LoginPanel`. Its
existing self-hide logic (hidden when no servers configured and nothing
connected) is unchanged.

## Out of scope / explicit non-goals

- No picoframe frame changes.
- No `/lobby` -> `/login` path rename (decided: keep `/lobby`; only the item
  label and crumb read "Login").
- No forced redirect when connecting via the topbar popover from an unrelated
  page — the redirect-to-Battles requirement is the login-*screen* flow, handled
  by its `NavGate`.
- No persistence of `revealed` across app restarts.

## Verification

- Fresh dev launch: sidebar shows only **Login** under Multiplayer; `/chat` and
  `/battles` typed into the URL redirect to `/lobby`.
- Connect: redirected to Battles; sidebar shows Chat + Battles, Login gone.
- Logout: Login returns; Chat + Battles remain; Login button reads "Reconnect".
- Reconnect: back to Chat + Battles, Login gone.
- `bunx biome ci .`, `bun run typecheck` green.
