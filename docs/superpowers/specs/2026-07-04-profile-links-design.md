# Distribution profile: sidebar links

## Goal

Let a distribution profile add external links (e.g. a Discord invite) to
Coilbox's sidebar navigation, without a fork or a code change — mirroring how
the profile already reskins/narrows the app at runtime. A bundler shipping
Coilbox alongside a game can point players at their community.

## Context

The distribution profile (`.coilbox/profile.json`) is read once at startup by
the schema-agnostic `tauri-plugin-coilbox-profile` crate and parsed by
`src/profile/profile.ts` into a module singleton (`getProfile()`). The `profile`
frontend plugin currently contributes only a read-only settings section and an
Appearance gate; nav hiding lives in `src/profile/hidden.tsx` as static
predicates over `getProfile()`.

Two facts make links cheap:

- picoframe's `NavItem` already supports `href` — "External URL opened in the
  system browser (via the Tauri opener). Mutually exclusive with `to`." No new
  frame capability is needed.
- `opener:default` (already granted in `src-tauri/capabilities/default.json`)
  includes `allow-open-url` for `http(s)`/`mailto`/`tel`, so external links open
  at runtime with **no ACL/capability change**.

Consequently this is a **pure frontend change** under `src/profile/` — the Rust
crate passes `profile.json` through verbatim and needs no edit.

## Schema

Add to `Profile` in `src/profile/profile.ts`:

```ts
/** An external link a profile adds to the sidebar (and home launcher). */
export interface LinkConfig {
  /** Sidebar label, e.g. "Discord". */
  label: string;
  /** External URL, opened in the system browser. Must be http(s)/mailto/tel. */
  href: string;
  /** Curated lucide icon name; unknown or omitted → ExternalLink. */
  icon?: string;
  /** Display label of the sidebar group; omitted → the default "Links" group. */
  group?: string;
}

export interface Profile {
  // …existing fields…
  /** External links added to the sidebar/launcher, e.g. a Discord invite. */
  links?: LinkConfig[];
}
```

## Group behaviour (hybrid free-label)

- `group` is a plain display label, never an internal id. Build one `NavGroup`
  per distinct `group` string; links with no `group` collect under a default
  group labelled **"Links"**.
- All profile link-groups receive a high `order` so they sit **below** the
  built-in feature groups, pinned to the bottom of the sidebar.
- If a bundler happens to reuse a built-in label like "Downloads", it produces a
  separate similarly-named section rather than merging into internals. This is
  the intended trade-off: profiles stay decoupled from internal group ids, which
  are not a stable public contract.

## Icons

A small curated `Record<string, IconComponent>` in `src/profile/` maps ~10–15
names to lucide components via **named imports** (no full-set passthrough, so the
bundle stays lean). Every mapped name is verified to exist in the installed
`lucide-react` version during implementation.

- Candidate names: `message-circle`, `github`, `globe`, `book-open`, `heart`,
  `users`, `youtube`, `twitter`, `link`, `mail`, `newspaper`, `life-buoy`.
  (Final list pinned to what the installed lucide-react actually exports.)
- lucide ships no brand marks, so brand-ish names map to the closest generic
  glyph — e.g. `discord` → `MessageCircle`.
- Unknown or omitted `icon` → `ExternalLink`.

## Wiring

- New pure function `buildProfileNav(profile: Profile): NavGroup[]` in
  `src/profile/` (e.g. `src/profile/links.tsx`), mirroring the static
  `getProfile()` pattern that `hidden.tsx` uses. It groups links, resolves icons,
  and returns nav groups; `[]` when there are no valid links.
- `profilePlugin` (`src/profile/index.ts`) gains `nav: buildProfileNav(getProfile())`.
  The profile is loaded before first render, so reading it at plugin-construction
  time is safe (same guarantee the rest of the module relies on).
- Links render in the sidebar **and** as home-launcher cards — default `NavItem`
  behaviour, no `sidebar` override.
- Absent/empty `links` ⇒ no groups ⇒ vanilla Coilbox unchanged.

## Validation (fail-soft)

Matching the posture of `makeGameMatcher` (warn and ignore, never throw):

- Skip entries missing `label` or `href`, with a `console.warn`.
- Drop entries whose `href` scheme is not `http(s)`/`mailto`/`tel` (the opener
  won't open others, and it avoids surprising schemes).
- A malformed `links` value (not an array) ⇒ no groups.

## Testing

- **Unit** (`buildProfileNav` is a pure function of a `Profile`):
  - empty / absent `links` → `[]`
  - grouping: two links sharing a `group` → one group with both items
  - default-group fallback: no `group` → a group labelled "Links"
  - icon resolution: known name → mapped icon; unknown/omitted → `ExternalLink`
  - validation: missing `label`/`href` skipped; non-http(s) scheme dropped;
    non-array `links` → `[]`
- **Live smoke** (Tauri MCP): a sample `profile.json` with a Discord link →
  the item appears in the sidebar → click opens the browser.

## Docs

Add a `links` section to `docs/distribution-profile.md`: the schema, the
group semantics, and the supported icon-name list.

## Out of scope

- Merging links into built-in feature groups by internal id.
- Per-link `sidebar`/launcher visibility toggles or per-group ordering knobs.
- True brand icons (Discord/GitHub marks).
- Any Rust/crate or capability change.
