# Multiplayer Login Popover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the multiplayer lobby connect UI into a popover opened from an icon button in the breadcrumb bar (`topbar.right` slot); the button doubles as a live connection-status indicator and log-out control, and it becomes the single entry point for connecting.

**Architecture:** A new topbar-slot component (`LobbyStatusButton`) renders an icon-only button with a status dot and anchors a controlled Radix `Popover`. The popover's open state lives in the existing app-level `MultiplayerContext` so any not-connected CTA anywhere in the app can open it via `openLoginPopover()`. The connect UI (server picker + Connect) relocates from `LobbyPage` into the popover; `LobbyPage` keeps its console/battles/users/chat.

**Tech Stack:** React 19, TypeScript, `radix-ui` (unified package), Tailwind, lucide-react, picoframe plugin SDK (`FramePlugin.slots`).

**Testing note:** This project has **no frontend test runner** (`package.json` scripts are only `dev`/`build`/`tauri`/`lint`/`typecheck`; no vitest/jest/testing-library). Adding one is out of scope. Verification for every task is therefore: `bun run typecheck` passes, `bunx biome ci .` passes, and (final task) a manual smoke run via `bun tauri dev`. This is an intentional deviation from TDD because no test harness exists.

**Reference patterns already in the repo:**
- Topbar slot contribution: `src/updater/index.ts:18` and `src/updater/UpdateBadge.tsx`.
- Radix UI primitive wrapper convention: `src/components/ui/tooltip.tsx`, `src/components/ui/select.tsx` (unified `radix-ui` import + `data-slot` + `cn()`).
- Connection context: `src/multiplayer/store.tsx` (`useMultiplayer()`).

---

## Task 1: Add the `Popover` UI primitive

No popover component exists yet. Add one following the exact convention of `src/components/ui/tooltip.tsx` (unified `radix-ui` import, `data-slot`, `cn`). This mirrors what `npx shadcn@latest add @picoframe/popover` would produce; writing it directly keeps the task deterministic and offline.

**Files:**
- Create: `src/components/ui/popover.tsx`

- [ ] **Step 1: Create the file**

```tsx
import { Popover as PopoverPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";

function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-md outline-none animate-in fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger };
```

- [ ] **Step 2: Verify it typechecks**

Run: `bun run typecheck`
Expected: PASS (no errors). This confirms `radix-ui` exports `Popover` and that `@/lib/utils` `cn` resolves.

- [ ] **Step 3: Verify lint**

Run: `bunx biome ci .`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/popover.tsx
git commit -m "feat(ui): add Popover primitive wrapping radix-ui"
```

---

## Task 2: Add popover open-state to `MultiplayerContext`

Extend the existing app-level context with a boolean + open/close actions so any component can open the topbar popover. Also auto-close the popover on a successful connect.

**Files:**
- Modify: `src/multiplayer/store.tsx`

- [ ] **Step 1: Extend the context interface**

In `interface MultiplayerContextValue` (starts at line 100), add these three members after `forgetChannel` (line 115):

```ts
  /** Whether the topbar login/status popover is open. */
  loginPopoverOpen: boolean;
  /** Open the topbar login/status popover (used by not-connected CTAs app-wide). */
  openLoginPopover: () => void;
  /** Close the topbar login/status popover. */
  closeLoginPopover: () => void;
```

- [ ] **Step 2: Add the state + callbacks in the provider**

In `MultiplayerProvider`, immediately after the `const [busy, setBusy] = useState(false);` line (line 129), add:

```ts
  const [loginPopoverOpen, setLoginPopoverOpen] = useState(false);
  const openLoginPopover = useCallback(() => setLoginPopoverOpen(true), []);
  const closeLoginPopover = useCallback(() => setLoginPopoverOpen(false), []);
```

- [ ] **Step 3: Auto-close the popover after a successful connect**

In the `connect` callback, the success path ends with `setActiveKey(serverKey);` (line 258). Add a line right after it, still inside the `try` before `finally`:

```ts
      setActiveKey(serverKey);
      setLoginPopoverOpen(false);
```

- [ ] **Step 4: Expose the new members in the context value**

In the `<MultiplayerContext.Provider value={{ ... }}>` object (lines 278-288), add after `forgetChannel,`:

```ts
        loginPopoverOpen,
        openLoginPopover,
        closeLoginPopover,
```

- [ ] **Step 5: Verify typecheck**

Run: `bun run typecheck`
Expected: PASS. (`useState`/`useCallback` are already imported at the top of the file.)

- [ ] **Step 6: Verify lint**

Run: `bunx biome ci .`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/multiplayer/store.tsx
git commit -m "feat(multiplayer): add login-popover open state to context"
```

---

## Task 3: Create the `LobbyStatusButton` topbar component

The icon-only button with a status dot, anchoring the controlled popover. The popover body has three states (disconnected/connecting, connected). This is the new home of the connect UI relocated from `LobbyPage`.

**Files:**
- Create: `src/multiplayer/LobbyStatusButton.tsx`

- [ ] **Step 1: Create the file**

```tsx
import { Button } from "@picoframe/frame";
import { Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useLobbyServers } from "../lobby-servers/config";
import { useMultiplayer } from "./store";

type DotStatus = "off" | "connecting" | "on" | "error";

const DOT_CLASS: Record<DotStatus, string> = {
  off: "bg-muted-foreground/50",
  connecting: "bg-amber-500 animate-pulse",
  on: "bg-green-500",
  error: "bg-destructive",
};

const LABEL: Record<DotStatus, string> = {
  off: "Multiplayer: log in",
  connecting: "Multiplayer: connecting",
  on: "Multiplayer: connected",
  error: "Multiplayer: connection error",
};

/**
 * topbar.right slot: an icon button that shows lobby connection status via a dot
 * and opens a popover to connect / view status / log out. Hidden entirely when no
 * server is configured and nothing is connected. The open state is controlled by
 * MultiplayerContext so not-connected CTAs elsewhere can open this same popover.
 */
export default function LobbyStatusButton() {
  const [cfg] = useLobbyServers();
  const {
    mirror,
    activeKey,
    busy,
    loginPopoverOpen,
    openLoginPopover,
    closeLoginPopover,
  } = useMultiplayer();

  const hasServers = cfg.servers.length > 0;
  if (!hasServers && activeKey == null) return null;

  let status: DotStatus = "off";
  if (activeKey != null) {
    status = mirror.phase === "ready" ? "on" : "connecting";
  } else if (busy) {
    status = "connecting";
  } else if (mirror.error || mirror.phase === "denied") {
    status = "error";
  }

  return (
    <Popover
      open={loginPopoverOpen}
      onOpenChange={(o) => (o ? openLoginPopover() : closeLoginPopover())}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={LABEL[status]}
          className="relative flex size-8 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Users className="size-4" />
          <span
            className={cn(
              "absolute right-1 top-1 size-2 rounded-full ring-2 ring-background",
              DOT_CLASS[status],
            )}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <LoginPanel onNavigate={closeLoginPopover} />
      </PopoverContent>
    </Popover>
  );
}

function LoginPanel({ onNavigate }: { onNavigate: () => void }) {
  const [cfg] = useLobbyServers();
  const servers = cfg.servers;
  const { mirror, activeKey, busy, connect, disconnect } = useMultiplayer();

  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => servers.find((s) => s.id === selectedId),
    [servers, selectedId],
  );

  // Auto-select the first server once the directory loads (or when the current
  // selection is gone), so Connect is usable without a manual pick.
  useEffect(() => {
    if (servers.length > 0 && !servers.some((s) => s.id === selectedId)) {
      setSelectedId(servers[0].id);
    }
  }, [servers, selectedId]);

  async function onConnect() {
    if (!selected) {
      setError("Pick a server first.");
      return;
    }
    setError(null);
    try {
      await connect(selected);
    } catch (e) {
      setError(String(e));
    }
  }

  async function onDisconnect() {
    setError(null);
    try {
      await disconnect();
    } catch (e) {
      setError(String(e));
    }
  }

  if (activeKey != null) {
    const username = mirror.state?.myUsername ?? selected?.username ?? "Connected";
    const ready = mirror.phase === "ready";
    return (
      <div className="flex flex-col gap-3">
        <div>
          <p className="text-sm font-medium">{username}</p>
          <p className="truncate text-xs text-muted-foreground">
            {ready ? activeKey : `Connecting… (${mirror.phase ?? "…"})`}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/lobby"
            onClick={onNavigate}
            className="inline-flex h-8 flex-1 items-center justify-center rounded-md border border-border text-sm font-medium hover:bg-muted"
          >
            Lobby
          </Link>
          <Link
            to="/chat"
            onClick={onNavigate}
            className="inline-flex h-8 flex-1 items-center justify-center rounded-md border border-border text-sm font-medium hover:bg-muted"
          >
            Chat
          </Link>
        </div>
        <Button onClick={onDisconnect} disabled={busy} className="h-8">
          Log out
        </Button>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium">Connect to multiplayer</p>
      <Select value={selectedId} onValueChange={setSelectedId} disabled={busy}>
        <SelectTrigger className="w-full" aria-label="Lobby server">
          <SelectValue placeholder="Select a server" />
        </SelectTrigger>
        <SelectContent>
          {servers.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name} ({s.host}:{s.port})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        onClick={onConnect}
        disabled={busy || servers.length === 0}
        className="h-8"
      >
        {busy ? "Connecting…" : "Connect"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {mirror.error && (
        <p className="text-xs text-destructive">Disconnected: {mirror.error}</p>
      )}
      <Link
        to="/settings/lobby-servers"
        onClick={onNavigate}
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        Manage servers
      </Link>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `bun run typecheck`
Expected: PASS. Confirms the context now exposes `loginPopoverOpen`/`openLoginPopover`/`closeLoginPopover` (Task 2) and that `PopoverTrigger asChild` accepts a single `<button>` child.

- [ ] **Step 3: Verify lint**

Run: `bunx biome ci .`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/multiplayer/LobbyStatusButton.tsx
git commit -m "feat(multiplayer): add topbar lobby status button + login popover"
```

---

## Task 4: Register the button in the topbar slot

Wire `LobbyStatusButton` into the plugin's `topbar.right` slot, mirroring the updater plugin.

**Files:**
- Modify: `src/multiplayer/index.ts`

- [ ] **Step 1: Import the component**

At the top of `src/multiplayer/index.ts`, after the existing lucide import (line 2), add:

```ts
import LobbyStatusButton from "./LobbyStatusButton";
```

- [ ] **Step 2: Add the slot contribution**

In the `multiplayerPlugin` object, add a `slots` property (place it right before the `Provider:` line, line 54). Order 100 puts it at the far right of the topbar action area (right of the updater badge at order 0):

```ts
  slots: [{ slot: "topbar.right", order: 100, Component: LobbyStatusButton }],
```

- [ ] **Step 3: Verify typecheck**

Run: `bun run typecheck`
Expected: PASS (`slots` is a valid `FramePlugin` field per `@picoframe/plugin-sdk` types).

- [ ] **Step 4: Verify lint**

Run: `bunx biome ci .`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/multiplayer/index.ts
git commit -m "feat(multiplayer): mount lobby status button in topbar.right"
```

---

## Task 5: Strip connection controls from `LobbyPage`

Remove the inline server picker + Connect/Disconnect + status section (now owned by the popover). Keep everything else (battles, users, battle chat, console). Replace the connection section with a small not-connected hint that opens the popover.

**Files:**
- Modify: `src/multiplayer/pages/LobbyPage.tsx`

- [ ] **Step 1: Replace the imports and top-of-component hooks**

Replace lines 1-12 (the import block) with:

```tsx
import { Button, Input } from "@picoframe/frame";
import { useState } from "react";
import { mpJoinBattle, mpLeaveBattle, mpSay } from "../bindings";
import { useMultiplayer } from "../store";
```

Then replace the `useLobbyServers`/`useMultiplayer` lines and the now-orphaned connection state. Specifically replace lines 22-43 (from `export default function LobbyPage() {` through the auto-select `useEffect` block) with:

```tsx
export default function LobbyPage() {
  // Connection + mirror live in the app-level provider so they survive navigation.
  const { mirror, activeKey, openLoginPopover } = useMultiplayer();

  const [error, setError] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");
```

This drops `useLobbyServers`, `Select*` imports, `useEffect`, `useMemo`, `busy`, `connect`, `disconnect`, `selectedId`, and `selected` — all only used by the removed section.

- [ ] **Step 2: Delete the `onConnect` and `onDisconnect` functions**

Delete the two functions at lines 57-77 (`async function onConnect()` and `async function onDisconnect()`) entirely. The `join`, `leave`, and `sendChat` functions below them stay.

- [ ] **Step 3: Replace the connection-controls JSX**

Replace the `{/* Connection controls */}` `<section>` plus the "no servers configured" note (lines 117-159) with a single not-connected hint:

```tsx
      {!activeKey && (
        <section className="flex flex-col items-start gap-3">
          <p className="text-sm text-muted-foreground">
            You are not connected to a lobby server.
          </p>
          <Button onClick={openLoginPopover}>Connect…</Button>
        </section>
      )}
```

Leave the `{error && ...}` and `{mirror.error && ...}` lines (originally 160-163) intact — `error` is still set by `join`/`leave`/`sendChat`.

- [ ] **Step 4: Verify typecheck**

Run: `bun run typecheck`
Expected: PASS with no "declared but never used" errors. If any appear, an import/variable from the removed section was missed — remove it.

- [ ] **Step 5: Verify lint**

Run: `bunx biome ci .`
Expected: PASS (biome also flags unused imports).

- [ ] **Step 6: Commit**

```bash
git add src/multiplayer/pages/LobbyPage.tsx
git commit -m "refactor(multiplayer): move lobby connect controls out of LobbyPage"
```

---

## Task 6: Rewire not-connected CTAs to open the popover (app-wide audit)

Every "not connected → go connect" prompt should open the topbar popover instead of navigating to `/lobby`.

**Files:**
- Modify: `src/multiplayer/pages/ChatPage.tsx`
- Audit: entire `src/`

- [ ] **Step 1: Audit for other CTAs**

Run: `grep -rn 'to="/lobby"' src/ ; grep -rn "Go to the Lobby\|not connected\|Not connected" src/`
Expected: matches in `ChatPage.tsx` (the CTA) and `LobbyPage.tsx` (the hint added in Task 5, which already uses `openLoginPopover` — leave it). If any OTHER component renders a "go to lobby to connect" CTA, apply the same rewire pattern shown below to it.

- [ ] **Step 2: Rewire the ChatPage CTA**

In `src/multiplayer/pages/ChatPage.tsx`, add `openLoginPopover` to the context destructure (line 20):

```tsx
  const { mirror, activeKey, markSeen, forgetChannel, openLoginPopover } =
    useMultiplayer();
```

Replace the not-connected block's `<Link to="/lobby" ...>Go to the Lobby to connect</Link>` (lines 55-60) with:

```tsx
        <Button onClick={openLoginPopover}>Connect…</Button>
```

- [ ] **Step 3: Remove the now-unused `Link` import**

`Link` (imported at line 4) is only used by that CTA. Delete the line:

```tsx
import { Link } from "react-router";
```

(`Button` is already imported at line 1.)

- [ ] **Step 4: Verify typecheck**

Run: `bun run typecheck`
Expected: PASS with no unused-import error for `Link`.

- [ ] **Step 5: Verify lint**

Run: `bunx biome ci .`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/multiplayer/pages/ChatPage.tsx
git commit -m "feat(multiplayer): ChatPage connect CTA opens login popover"
```

---

## Task 7: Full verification + manual smoke

**Files:** none (verification only)

- [ ] **Step 1: Full lint + typecheck (CI parity)**

Run: `bunx biome ci .`
Expected: PASS.

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 2: Manual smoke via the app**

Run: `bun tauri dev`

Verify each:
1. **No servers configured** (fresh profile, or with `lobbyServers.directory` empty): the topbar button is **absent**.
2. **Add a server** at `/settings/lobby-servers`: the topbar button **appears** with a grey dot. Clicking it opens the popover showing the server picker + Connect.
3. **Connect**: dot goes **amber (pulsing)** during login, then **green** at `ready`. The popover auto-closes on success; reopening shows the connected panel with the username and a Log out button.
4. **Log out** from the popover: calls disconnect, dot returns to **grey**, button stays present.
5. **ChatPage while disconnected**: navigate to `/chat` — its "Connect…" button opens the **same** topbar popover (anchored top-right).
6. **LobbyPage while disconnected**: shows the "Connect…" hint (no inline picker); its button opens the popover. Console/battles/users still render when connected.
7. **Bad password** (if testable): dot shows **red** and the popover surfaces the disconnect reason.

Record actual observed results. If any step fails, fix before proceeding — do not mark complete on unverified behavior.

- [ ] **Step 3: Final confirmation**

Only after Steps 1-2 pass, the feature is complete. No commit needed (verification only). Report the manual-smoke results honestly, including any step not exercised (e.g. bad-password path if no test account).

---

## Self-review notes

- **Spec coverage:** button in topbar slot (Task 3/4), appears only when a server is configured or connected (Task 3 visibility guard), status dot (Task 3), popover with picker+Connect / connected+Log out (Task 3), open-from-anywhere mechanism (Task 2) + app-wide CTA rewire (Task 6), LobbyPage kept but connect UI removed (Task 5), logout = disconnect only (Task 3 `onDisconnect` → `disconnect()`), new popover primitive (Task 1). All spec sections mapped.
- **Type consistency:** context members `loginPopoverOpen` / `openLoginPopover` / `closeLoginPopover` are defined in Task 2 and consumed with identical names in Tasks 3, 5, 6. `LoginPanel` prop is `onNavigate` throughout Task 3.
- **No test framework:** verification is typecheck + biome + manual smoke by design (documented in header).
