# Distribution profile: layout options

## Goal

Let a distribution profile lock the app-frame chrome — breadcrumb visibility,
top-bar history buttons, popover menu-button branding, and centered top-bar
content — without a fork or a code change. These are the new `LayoutConfig`
knobs `@picoframe/frame@0.2.0` added (plus the `topbar.center` slot from
`@picoframe/plugin-sdk@0.0.9`); a bundler shipping Coilbox alongside a game can
now narrow and brand the chrome the same way it already reskins theme/nav.

## Context

The distribution profile (`.coilbox/profile.json`) is read once at startup by
the schema-agnostic `tauri-plugin-coilbox-profile` crate and parsed by
`src/profile/profile.ts` into a module singleton (`getProfile()`). The frame's
layout is configured through the `layout` prop on `<AppFrame>` in
`src/main.tsx`, which is currently **hardcoded**:

```ts
layout={{ sidebar: { popover: { default: true, userConfigurable: true } } }}
```

The profile does not feed it today. This change threads profile values into that
one object.

`frame@0.2.0` added to `LayoutConfig`:

- `breadcrumb.hidden` — static bool, hides the breadcrumb region entirely.
- `history.buttons` — `Configurable<boolean>`, shows/hides the top-bar
  back/forward buttons.
- Popover menu-button branding (static): `menuIcon`, `menuIconOpen`, `menuLabel`,
  `menuLabelVisible`, `menuLabelContent`.

`plugin-sdk@0.0.9` added the `topbar.center` `SlotId`; the frame's `TopBar`
renders `<Slot id="topbar.center">` (verified in `dist/layout/TopBar.js`),
absolutely centered in the bar.

Two `Configurable` semantics matter: a bare value **locks** an option (fixed, no
user control); the `{default, userConfigurable}` object form **exposes** it as a
user-overridable setting. Per the scope decision, all profile layout knobs are
**locks** (bare values) — authoritative like `title`/`hide`, so a distribution's
chrome stays put.

## Schema

Add to `src/profile/profile.ts`:

```ts
export interface ProfileLayout {
  /** Hide the breadcrumb region entirely. → layout.breadcrumb.hidden */
  hideBreadcrumb?: boolean;
  /** Lock the top-bar back/forward buttons on/off. → layout.history.buttons */
  historyButtons?: boolean;
  /** Popover-mode menu-button branding (only visible when the sidebar is in
   * popover mode, which Coilbox defaults to). */
  menu?: {
    /** Accessible name + tooltip. → menuLabel */
    label?: string;
    /** Render the label/logo beside the icon. Defaulted to true by the builder
     * when `label` or `image` is set (see "Menu-button visibility"). */
    labelVisible?: boolean;
    /** Curated lucide icon name (via resolveLinkIcon). → menuIcon */
    icon?: string;
    /** Curated lucide icon name shown while open. → menuIconOpen */
    iconOpen?: string;
    /** `.coilbox`-relative path (or data:/http[s]) to a logo image, resolved to
     * a data URI and wrapped in <img>. → menuLabelContent. Wins over `label`
     * text as the visible content; `label` remains the accessible name. */
    image?: string;
  };
  /** Centered top-bar content. `image` wins over `text` when both are set. */
  center?: { text?: string; image?: string };
}

export interface Profile {
  // …existing fields…
  layout?: ProfileLayout;
}
```

## Menu-button visibility (non-obvious frame coupling)

In `TopBar`, `showMenuLabel = popover && menuLabelVisible` gates the *entire*
labeled-button branch, and `menuLabelContent` (the logo image) only renders
inside that branch. So a `menu.image` logo or a visible `menu.label` is invisible
unless `menu.labelVisible` is also true. To avoid a "my logo isn't showing" trap,
the builder **defaults `labelVisible` to `true` when `menu.label` or
`menu.image` is set** and the profile did not set `labelVisible` explicitly.
Menu branding is also only visible while the sidebar is in popover mode (Coilbox's
default) — documented, not enforced.

## Wiring

### New module `src/profile/layout.tsx` (mirrors `links.ts`)

Pure builders, so they're unit-testable off a `Profile`:

- `resolveProfileImage(path): Promise<string | null>` — generalises the
  path→dataURI logic from `resolveSplashSrc` (a `data:`/`http(s):` value is used
  verbatim; anything else is read via the `profile_asset` command). `resolveSplashSrc`
  is left untouched (surgical scope); it may delegate later.
- `buildLayoutConfig(profile, images): LayoutConfig` — maps `profile.layout` onto
  the frame `LayoutConfig`, **merged onto** the existing default
  `sidebar.popover` config rather than replacing it. Booleans become bare-value
  locks (`breadcrumb.hidden`, `history.buttons`). `menu.icon`/`iconOpen` resolve
  via the existing `resolveLinkIcon`. `menu.image`/`center.image` arrive
  pre-resolved (`images: { menu: string | null; center: string | null }`) and
  wrap in `<img>`. Applies the `labelVisible` default above.
- `buildCenterSlot(profile, centerImage): SlotContribution | null` — returns a
  `topbar.center` slot contribution rendering the centered image (wins) or text,
  or `null` when neither is set.

Because `menu.image` and `center.image` need async asset resolution, the builder
splits sync (booleans, icon names, text) from an async pre-resolve step for the
two image paths.

### `src/main.tsx`

- Await resolution of `menu.image` + `center.image` alongside the existing
  `resolveSplashSrc()` await, before render.
- Replace the hardcoded `layout={{…}}` with
  `layout={buildLayoutConfig(profile, images)}`.

### `topbar.center` slot contribution

The center content is a **slot contribution**, not part of `LayoutConfig`. The
`profile` frame-plugin (`src/profile/index.ts`) contributes the
`buildCenterSlot(...)` result to `"topbar.center"`. Absent center config ⇒ no
contribution ⇒ vanilla top bar.

## Validation (fail-soft)

Matching the profile module's posture (warn and ignore, never throw):

- Unknown `menu.icon`/`iconOpen` name → `resolveLinkIcon` already falls back to
  `ExternalLink`.
- A `menu.image`/`center.image` that fails to load → resolves to `null`; the
  builder omits that piece (menu falls back to text label; center falls back to
  text, then to no contribution).
- Absent/empty `layout` ⇒ `buildLayoutConfig` returns just the default popover
  config ⇒ vanilla Coilbox chrome unchanged.

## Testing

- **Unit** (`layout.test.ts`, `buildLayoutConfig`/`buildCenterSlot` pure over a
  `Profile`):
  - absent `layout` → default popover config only, no center slot.
  - `hideBreadcrumb`/`historyButtons` → correct bare-value locks.
  - `menu.icon`/`iconOpen` known → mapped icon; unknown → `ExternalLink`.
  - `labelVisible` default: set `menu.label` (or `image`) without `labelVisible`
    → resolves true; explicit `false` is respected.
  - image precedence: `menu.image` present → `menuLabelContent` is the `<img>`,
    `menu.label` is the accessible name; `center.image` + `center.text` →
    image wins.
  - image failure (`null`) → falls back to text / omitted.
- **Live smoke** (Tauri MCP): a sample `profile.json` exercising all four knobs
  → breadcrumb hidden, history buttons gone, popover menu shows the branded
  logo, centered content renders.

## Docs

Add a `layout` section to `docs/distribution-profile.md`: the schema, the
supported lucide icon-name list (cross-referencing `links`), the popover-mode
and `labelVisible` visibility constraints, and the image-wins precedence rules.

## Out of scope

- Exposing any layout knob as a user-overridable setting (`{default,
  userConfigurable}` form) — all profile layout options are locks.
- Rich/interactive `topbar.center` content beyond text-or-image.
- True brand icons (lucide ships none).
- Any Rust/crate or capability change — the crate passes `profile.json` through
  verbatim; images use the existing `profile_asset` command already granted to
  `splash`.
