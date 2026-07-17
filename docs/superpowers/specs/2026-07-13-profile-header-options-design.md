# Distribution profile: header options (issue #254 remainder)

## Goal

Finish [#254](https://github.com/tomjn/coilbox/issues/254): let a distribution profile control the remaining app-frame header behaviours that #258 did not cover. All are **profile-controlled, not user-controlled** — a distribution's chrome is authoritative. Chunkier-header / header-background-image (the only items needing a `@picoframe/frame` change) are explicitly out of scope.

## Context

#258 (merged) added `ProfileLayout` (`src/profile/profile.ts`) and the `buildLayoutConfig` / slot builders (`src/profile/layout.tsx`), covering breadcrumb-hide, history-button lock, popover menu-button *branding*, and a centered top-bar logo. Those already satisfy "profile not user" (bare-value locks, no user toggle). This spec adds the rest.

Relevant existing wiring:

- `main.tsx` calls `buildLayoutConfig(profile, menuImageSrc)`; the popover option is currently `{ default: true, userConfigurable: true }` — a70f2a0's user-facing toggle.
- The frame reads popover via `useLayoutOption("popover")`; a **bare (locked)** value returns `[default, null]` and ignores any persisted user choice, so dropping `userConfigurable` removes the user toggle with **no frame change**.
- Sidebar collapse persists at `localStorage["picoframe.sidebar.collapsed"]` (frame `AppLayout`), so a "default collapsed" seed is a pre-render write, the same pattern as `forceProfileTheme` / the fullscreen boot-apply.
- `FullscreenControls` (`src/general/fullscreen.tsx`) is contributed to `topbar.right`; it returns `null` when `fullscreenLocked`. Its F11 + OS-sync effects run as hooks before that return.
- The frame exposes `topbar.left` / `topbar.center` / `topbar.right` slots.

## Decisions (confirmed)

- **Vanilla popover default:** persistent sidebar (popover **off**), locked. This reverts a70f2a0's default; a profile opts into popover via `layout.popover: true`.
- **`sidebarCollapsed`:** a **seed** (pre-written only when the key is unset), so a returning user's expand/collapse choice persists.
- **`fullscreenButton: false`:** hides the top-bar button **and** disables F11 (but does not force fullscreen on — that stays `fullscreenLocked`).

## Schema

Add to `ProfileLayout` in `src/profile/profile.ts`:

```ts
/** Text and/or logo for a top-bar slot; `href` makes it a link. */
export interface ProfileLogo {
  text?: string;
  /** `.coilbox`-relative path or inline data:/http(s): (same as splash.image). */
  image?: string;
  /** URL opened in the system browser (http(s)/mailto/tel). Makes the logo a link. */
  href?: string;
}

export interface ProfileLayout {
  // …existing #258 fields: hideBreadcrumb, historyButtons, menu…
  /** Force popover sidebar mode. Locked — no user toggle. Omitted → persistent sidebar. */
  popover?: boolean;
  /** Start with the sidebar collapsed (seed; only meaningful when popover is off). */
  sidebarCollapsed?: boolean;
  /** Show the top-bar fullscreen button (default true). false also disables F11. */
  fullscreenButton?: boolean;
  /** Logo/text in the three top-bar slots. `center` replaces #258's `{text,image}`. */
  left?: ProfileLogo;
  center?: ProfileLogo;
  right?: ProfileLogo;
}
```

`center` widens from `{ text?, image? }` to `ProfileLogo` — additive (adds `href`).

## Wiring

### `buildLayoutConfig` (`src/profile/layout.tsx`)

- Set `sidebar.popover` to a **bare** boolean lock: `profile.layout?.popover === true`. Drop `userConfigurable`. (Menu branding unchanged; it only shows in popover mode.)

### Slot logos (generalise the center builder)

- Rename/generalise `resolveCenterContent` → `resolveLogoContent(logo, image)`: returns `{ image } | { text } | null`, image-wins (unchanged logic).
- `buildLogoSlot(slot, logo, image)`: a `SlotContribution` whose Component renders the image or text, wrapped in a link when `logo.href` passes the scheme allow-list (reuse `links`' `ALLOWED_SCHEME` + the Tauri opener). `null` when there's no content.
- `applyProfileSlots(plugins, images)`: inject the left/center/right slot contributions into the `profile` plugin (generalises `applyProfileCenterSlot`). `images` carries the three pre-resolved logo data URIs.

### Sidebar-collapsed seed

- `applyProfileSidebarSeed()` in the profile module: when `layout.sidebarCollapsed` and `localStorage["picoframe.sidebar.collapsed"]` is unset, write `"true"`. Called from `main.tsx` before render (near `forceProfileTheme`). Fails soft if localStorage is unavailable.

### Fullscreen button (`src/general/fullscreen.tsx`)

- Add `isFullscreenButtonHidden()` reading `layout.fullscreenButton === false`.
- In `FullscreenControls`: compute `const hide = locked || buttonHidden`. Gate the F11 effect (`if (hide) return;`) and the button render (`if (hide) return null;`). The OS-sync effect still runs so the profile's `fullscreen` seed applies.

### `main.tsx`

- Resolve `left`/`center`/`right` images (three `resolveProfileImage` calls; `center` replaces the current single menu/center resolution set).
- `applyProfileSidebarSeed()` before render.
- Replace `applyProfileCenterSlot(...)` with `applyProfileSlots(...)`.

## Testing (TDD)

Extend `src/profile/layout.test.ts` (pure builders):

- `buildLayoutConfig`: `popover` true → locked bare `true`; absent → popover omitted/false, and **never** `userConfigurable`.
- `resolveLogoContent`: image-wins / text-fallback / null (carried over).
- `buildLogoSlot`: correct `slot` id per placement; link wrapper only when `href` passes the allow-list; unsupported scheme → not a link (or dropped).
- `applyProfileSlots`: injects up to three contributions; identity passthrough when none; untouched plugins unchanged.
- Sidebar seed: pure helper `shouldSeedCollapsed(existing, layout)` → true only when `sidebarCollapsed` and no existing value.

`fullscreen.tsx` gating is integration (hook-bound); covered by live smoke, not unit.

## Live smoke

`bun tauri dev` with a portable profile exercising: `popover: true` (menu button
+ branding), `sidebarCollapsed: true`, `fullscreenButton: false` (button gone, F11 inert), and left/right/center logos with an `href` (click opens browser).

## Docs

Expand the `layout` section of `docs/distribution-profile.md`: the new fields, the seed-vs-lock semantics, the popover default change, and the three slot placements with the clickable-`href` note.

## Out of scope

- Chunkier header / header background image (needs a `@picoframe/frame` change).
- Re-adding any removed user toggle.
- Rust/crate/capability changes — images use the existing `profile_asset` transport; links use the already-granted opener allow-list.
