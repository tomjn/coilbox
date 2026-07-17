# Profile Sidebar Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a distribution profile add external links (e.g. a Discord invite) to Coilbox's sidebar and home launcher, driven by a `links` array in `.coilbox/profile.json`, with no fork and no Rust change.

**Architecture:** A new pure module `src/profile/links.ts` turns `Profile.links` into picoframe `NavGroup[]` (grouping by a free-text label, resolving icon names, dropping malformed/unsafe entries). Because `main.tsx` imports the plugin list *before* awaiting `loadProfile()`, the nav can't be built at plugin-construction time — instead `applyProfileLinks(plugins)` injects the groups into the `profile` plugin in `main.tsx`, right after the profile resolves, mirroring the existing `applyProfileSettingsHiding` call.

**Tech Stack:** TypeScript, React, picoframe `@picoframe/plugin-sdk` (`NavGroup`/`NavItem`/`IconComponent`), lucide-react, vitest, Tauri opener (already permitted via `opener:default`).

---

## Spec deviation (intentional)

The spec said `profilePlugin` "gains `nav: buildProfileNav(getProfile())`". That would run at `app.plugins.ts` module-eval — which happens at `main.tsx:5`, *before* `await loadProfile()` at `main.tsx:29` — so `getProfile()` would return the empty profile and no links would show. This plan instead injects the groups in `main.tsx` after the profile loads, via `applyProfileLinks`, exactly like `applyProfileSettingsHiding` already does. Everything else matches the spec.

## File structure

- **Modify** `src/profile/profile.ts` — add the `LinkConfig` interface and `Profile.links?` field.
- **Create** `src/profile/links.ts` — `resolveLinkIcon`, `buildProfileNav`, `applyProfileLinks`; the curated icon map.
- **Create** `src/profile/links.test.ts` — unit tests for the pure functions.
- **Modify** `src/main.tsx` — wrap the plugin list with `applyProfileLinks`.
- **Modify** `docs/distribution-profile.md` — document the `links` field + icon names.

---

## Task 1: Schema — `LinkConfig` + `Profile.links`

**Files:**
- Modify: `src/profile/profile.ts`

- [ ] **Step 1: Add the `LinkConfig` interface**

In `src/profile/profile.ts`, immediately after the `WelcomeConfig` interface (around line 26), add:

```ts
/** An external link a profile adds to the sidebar (and home launcher). */
export interface LinkConfig {
  /** Sidebar label, e.g. "Discord". */
  label: string;
  /** External URL, opened in the system browser. Must be http(s)/mailto/tel. */
  href: string;
  /** Curated lucide icon name (see docs); unknown or omitted → ExternalLink. */
  icon?: string;
  /** Display label of the sidebar group; omitted → the default "Links" group. */
  group?: string;
}
```

- [ ] **Step 2: Add the `links` field to `Profile`**

In the `Profile` interface, after the `welcome?` field (around line 56), add:

```ts
  /** External links added to the sidebar/launcher, e.g. a Discord invite. */
  links?: LinkConfig[];
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck` Expected: PASS (no errors).

- [ ] **Step 4: Commit**

```bash
git add src/profile/profile.ts
git commit -m "feat: add LinkConfig to distribution profile schema"
```

---

## Task 2: `links.ts` core — icon resolution + `buildProfileNav`

**Files:**
- Create: `src/profile/links.ts`
- Test: `src/profile/links.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/profile/links.test.ts`:

```ts
import { ExternalLink, MessagesSquare } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { buildProfileNav, resolveLinkIcon } from "./links";
import type { Profile } from "./profile";

const base: Profile = { version: 1 };

describe("resolveLinkIcon", () => {
  it("maps a known name", () => {
    expect(resolveLinkIcon("discord")).toBe(MessagesSquare);
  });
  it("is case-insensitive", () => {
    expect(resolveLinkIcon("Discord")).toBe(MessagesSquare);
  });
  it("falls back to ExternalLink for an unknown name", () => {
    expect(resolveLinkIcon("nope")).toBe(ExternalLink);
  });
  it("falls back to ExternalLink when omitted", () => {
    expect(resolveLinkIcon(undefined)).toBe(ExternalLink);
  });
});

describe("buildProfileNav", () => {
  it("returns [] with no links", () => {
    expect(buildProfileNav(base)).toEqual([]);
    expect(buildProfileNav({ ...base, links: [] })).toEqual([]);
  });
  it("returns [] when links is not an array", () => {
    // @ts-expect-error testing malformed profile.json
    expect(buildProfileNav({ ...base, links: "x" })).toEqual([]);
  });
  it("puts an ungrouped link in the default 'Links' group", () => {
    const nav = buildProfileNav({
      ...base,
      links: [{ label: "Discord", href: "https://discord.gg/x" }],
    });
    expect(nav).toHaveLength(1);
    expect(nav[0].label).toBe("Links");
    expect(nav[0].items).toHaveLength(1);
    expect(nav[0].items[0].label).toBe("Discord");
    expect(nav[0].items[0].href).toBe("https://discord.gg/x");
  });
  it("merges links that share a group label", () => {
    const nav = buildProfileNav({
      ...base,
      links: [
        { label: "Discord", href: "https://discord.gg/x", group: "Community" },
        { label: "Forum", href: "https://forum.example", group: "Community" },
      ],
    });
    expect(nav).toHaveLength(1);
    expect(nav[0].label).toBe("Community");
    expect(nav[0].items).toHaveLength(2);
  });
  it("resolves icons with a fallback", () => {
    const nav = buildProfileNav({
      ...base,
      links: [
        { label: "Discord", href: "https://discord.gg/x", icon: "discord" },
        { label: "Site", href: "https://example.com" },
      ],
    });
    expect(nav[0].items[0].icon).toBe(MessagesSquare);
    expect(nav[0].items[1].icon).toBe(ExternalLink);
  });
  it("skips entries missing label or href", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const nav = buildProfileNav({
      ...base,
      links: [
        { label: "Good", href: "https://ok.example" },
        // @ts-expect-error missing href
        { label: "NoHref" },
        // @ts-expect-error missing label
        { href: "https://x.example" },
      ],
    });
    expect(nav[0].items).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
  it("drops unsupported href schemes", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const nav = buildProfileNav({
      ...base,
      links: [
        { label: "Bad", href: "javascript:alert(1)" },
        { label: "Good", href: "https://ok.example" },
      ],
    });
    expect(nav[0].items).toHaveLength(1);
    expect(nav[0].items[0].label).toBe("Good");
    warn.mockRestore();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bunx vitest run src/profile/links.test.ts` Expected: FAIL — cannot resolve `./links` (module does not exist yet).

- [ ] **Step 3: Implement `src/profile/links.ts`**

Create `src/profile/links.ts`:

```ts
import type { IconComponent, NavGroup, NavItem } from "@picoframe/plugin-sdk";
import {
  Bell,
  BookOpen,
  Calendar,
  ExternalLink,
  Gamepad2,
  Globe,
  Hash,
  Heart,
  Info,
  LifeBuoy,
  Link,
  Mail,
  MessageCircle,
  MessagesSquare,
  Newspaper,
  Rss,
  Star,
  Trophy,
  Users,
} from "lucide-react";
import type { Profile } from "./profile";

/**
 * Curated map of profile-facing icon names to lucide components. Kept small and
 * imported by name (no full-set passthrough) so the bundle stays lean. lucide 1.x
 * ships no brand marks, so brand-ish names resolve to the nearest generic glyph
 * (e.g. `discord` → MessagesSquare). Every value is a real export of the installed
 * lucide-react. Unknown or omitted names fall back to ExternalLink.
 */
const ICONS: Record<string, IconComponent> = {
  discord: MessagesSquare,
  forum: MessagesSquare,
  forums: MessagesSquare,
  chat: MessageCircle,
  message: MessageCircle,
  globe: Globe,
  website: Globe,
  web: Globe,
  docs: BookOpen,
  book: BookOpen,
  wiki: BookOpen,
  news: Newspaper,
  blog: Newspaper,
  rss: Rss,
  feed: Rss,
  heart: Heart,
  donate: Heart,
  support: LifeBuoy,
  help: LifeBuoy,
  users: Users,
  community: Users,
  mail: Mail,
  email: Mail,
  contact: Mail,
  link: Link,
  game: Gamepad2,
  play: Gamepad2,
  calendar: Calendar,
  events: Calendar,
  star: Star,
  info: Info,
  hash: Hash,
  channel: Hash,
  bell: Bell,
  updates: Bell,
  trophy: Trophy,
};

/** Resolve a profile icon name to a lucide component; ExternalLink when unknown. */
export function resolveLinkIcon(name?: string): IconComponent {
  if (!name) return ExternalLink;
  return ICONS[name.toLowerCase()] ?? ExternalLink;
}

/** Schemes the Tauri opener will open (matches `opener:default`'s allow-list). */
const ALLOWED_SCHEME = /^(https?:\/\/|mailto:|tel:)/i;

/** Default group label for links that don't set `group`. */
const DEFAULT_GROUP_LABEL = "Links";

/** Base sort order for profile link groups — high, so they sit below feature nav. */
const PROFILE_GROUP_ORDER = 1000;

/**
 * Build sidebar nav groups from a profile's `links`. Groups by the free-text `group`
 * label (first-seen order preserved); links without one collect under "Links".
 * Fails soft like the rest of the profile module: entries missing `label`/`href`, or
 * with an href scheme the opener won't open, are dropped with a warning rather than
 * throwing. Returns [] when there are no valid links, so vanilla Coilbox is untouched.
 */
export function buildProfileNav(profile: Profile): NavGroup[] {
  const links = profile.links;
  if (!Array.isArray(links) || links.length === 0) return [];

  const order: string[] = [];
  const byGroup = new Map<string, NavItem[]>();

  links.forEach((link, i) => {
    if (
      !link ||
      typeof link.label !== "string" ||
      typeof link.href !== "string"
    ) {
      console.warn("profile: skipping link missing label/href", link);
      return;
    }
    if (!ALLOWED_SCHEME.test(link.href)) {
      console.warn(
        `profile: skipping link with unsupported href scheme: ${link.href}`,
      );
      return;
    }
    const groupLabel = link.group?.trim() || DEFAULT_GROUP_LABEL;
    const items = byGroup.get(groupLabel) ?? [];
    if (items.length === 0) {
      byGroup.set(groupLabel, items);
      order.push(groupLabel);
    }
    items.push({
      id: `profile.link.${i}`,
      label: link.label,
      href: link.href,
      icon: resolveLinkIcon(link.icon),
    });
  });

  return order.map((label, gi) => ({
    id: `profile-links-${gi}`,
    label,
    order: PROFILE_GROUP_ORDER + gi,
    items: byGroup.get(label) ?? [],
  }));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx vitest run src/profile/links.test.ts` Expected: PASS — all cases green.

- [ ] **Step 5: Typecheck + lint the new file**

Run: `bun run typecheck` Expected: PASS. Run: `bunx biome check src/profile/links.ts src/profile/links.test.ts` Expected: PASS (no errors). If biome reports formatting, run `bunx biome format --write src/profile/links.ts src/profile/links.test.ts` and re-run.

- [ ] **Step 6: Commit**

```bash
git add src/profile/links.ts src/profile/links.test.ts
git commit -m "feat: build profile sidebar nav from links (icon map + grouping)"
```

---

## Task 3: `applyProfileLinks` + wire into `main.tsx`

**Files:**
- Modify: `src/profile/links.ts`
- Modify: `src/main.tsx`
- Test: `src/profile/links.test.ts`

- [ ] **Step 1: Write the failing test for `applyProfileLinks`**

Append to `src/profile/links.test.ts`:

```ts
import type { FramePlugin } from "@picoframe/plugin-sdk";
import { getProfile } from "./profile";
import { applyProfileLinks } from "./links";

describe("applyProfileLinks", () => {
  const profilePlugin: FramePlugin = { id: "profile", version: "0.0.0", routes: [] };
  const otherPlugin: FramePlugin = { id: "other", version: "0.0.0", routes: [] };

  it("returns the list unchanged when the profile has no links", () => {
    const plugins = [otherPlugin, profilePlugin];
    expect(applyProfileLinks(plugins)).toBe(plugins);
  });

  it("attaches built nav groups to the profile plugin", () => {
    const loaded = getProfile();
    loaded.links = [{ label: "Discord", href: "https://discord.gg/x" }];
    const result = applyProfileLinks([otherPlugin, profilePlugin]);
    const profile = result.find((p) => p.id === "profile");
    expect(profile?.nav).toHaveLength(1);
    expect(profile?.nav?.[0].items[0].label).toBe("Discord");
    // untouched plugin passes through by identity
    expect(result.find((p) => p.id === "other")).toBe(otherPlugin);
    loaded.links = undefined;
  });
});
```

Note: `getProfile()` returns the module singleton, which is the empty profile in a unit-test context; the test mutates `.links` on it directly and resets after. This exercises the real `getProfile()` path without a Tauri backend.

- [ ] **Step 2: Run to verify it fails**

Run: `bunx vitest run src/profile/links.test.ts` Expected: FAIL — `applyProfileLinks` is not exported.

- [ ] **Step 3: Implement `applyProfileLinks` in `src/profile/links.ts`**

Add these imports at the top of `src/profile/links.ts` (merge with the existing `@picoframe/plugin-sdk` type import and the `./profile` import):

```ts
import type { FramePlugin } from "@picoframe/plugin-sdk";
import { getProfile } from "./profile";
```

Append at the end of `src/profile/links.ts`:

```ts
/**
 * Inject the profile's sidebar links into the `profile` plugin's nav. Called from
 * `main.tsx` after `loadProfile()` resolves (the plugin list is imported before the
 * profile loads, so the nav can't be built at plugin-construction time). Mirrors
 * `applyProfileSettingsHiding`. No-op — returns the same array — when there are no
 * valid links, so vanilla Coilbox is untouched.
 */
export function applyProfileLinks(plugins: FramePlugin[]): FramePlugin[] {
  const groups = buildProfileNav(getProfile());
  if (groups.length === 0) return plugins;
  return plugins.map((p) =>
    p.id === "profile" ? { ...p, nav: [...(p.nav ?? []), ...groups] } : p,
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx vitest run src/profile/links.test.ts` Expected: PASS — all cases green.

- [ ] **Step 5: Wire into `main.tsx`**

In `src/main.tsx`, add the import (next to the existing `applyProfileSettingsHiding` import from `./profile/hidden` on line 8):

```ts
import { applyProfileLinks } from "./profile/links";
```

Then change the plugin-assembly line (currently `main.tsx:43`):

```ts
const appPlugins = applyProfileSettingsHiding(plugins);
```

to:

```ts
const appPlugins = applyProfileLinks(applyProfileSettingsHiding(plugins));
```

- [ ] **Step 6: Typecheck + lint**

Run: `bun run typecheck` Expected: PASS. Run: `bunx biome check src/profile/links.ts src/profile/links.test.ts src/main.tsx` Expected: PASS (format with `bunx biome format --write` if needed, then re-run).

- [ ] **Step 7: Commit**

```bash
git add src/profile/links.ts src/profile/links.test.ts src/main.tsx
git commit -m "feat: wire profile sidebar links into the app nav"
```

---

## Task 4: Document the `links` field

**Files:**
- Modify: `docs/distribution-profile.md`

- [ ] **Step 1: Read the current docs to match structure**

Run: open `docs/distribution-profile.md` and find the `welcome` field section (the field docs follow the same heading/example pattern).

- [ ] **Step 2: Add a `links` section**

Add a new section documenting the field, matching the surrounding heading style. Content to include:

```markdown
### `links`

External links added to the sidebar and the home launcher — e.g. a Discord
invite or a wiki. Each entry:

| Field   | Required | Meaning                                                        |
| ------- | -------- | -------------------------------------------------------------- |
| `label` | yes      | Sidebar/launcher text, e.g. `"Discord"`.                       |
| `href`  | yes      | URL opened in the system browser. Must be `http(s)`/`mailto`/`tel`. |
| `icon`  | no       | Icon name from the list below; unknown/omitted → a generic link icon. |
| `group` | no       | Sidebar group heading. Links sharing a `group` merge into one section; omitting it uses a default **Links** group. Group headings sit below the built-in navigation. |

```json
{
  "links": [
    { "label": "Discord", "href": "https://discord.gg/xxxx", "icon": "discord" },
    { "label": "Wiki", "href": "https://wiki.example", "icon": "docs", "group": "Community" },
    { "label": "Donate", "href": "https://example.com/donate", "icon": "heart", "group": "Community" }
  ]
}
```

Malformed entries (missing `label`/`href`, or an href scheme the browser opener won't open) are skipped; the rest still load.

**Icon names:** `discord`, `forum`/`forums`, `chat`/`message`, `globe`/`website`/`web`, `docs`/`book`/`wiki`, `news`/`blog`, `rss`/`feed`, `heart`/`donate`, `support`/`help`, `users`/`community`, `mail`/`email`/`contact`, `link`, `game`/`play`, `calendar`/`events`, `star`, `info`, `hash`/`channel`, `bell`/`updates`, `trophy`. Anything else falls back to a generic external-link icon. (lucide ships no brand marks, so `discord` uses a generic chat glyph.)
```

- [ ] **Step 3: Commit**

```bash
git add docs/distribution-profile.md
git commit -m "docs: document profile links field"
```

---

## Task 5: Full verification + live smoke

**Files:** none (verification only)

- [ ] **Step 1: Full frontend lint suite (the same commands CI runs)**

Run: `bunx biome ci .` Expected: PASS. Run: `bun run typecheck` Expected: PASS.

- [ ] **Step 2: Full test run**

Run: `bun run test` Expected: PASS (existing suites + new `links.test.ts`).

- [ ] **Step 3: Live smoke via a sample profile**

Create a throwaway portable profile to exercise the real path. Determine the app's portable root (a `.coilbox` folder next to the built/dev binary — see the portable-mode docs). Write a `profile.json` there containing:

```json
{
  "version": 1,
  "links": [
    { "label": "Discord", "href": "https://discord.gg/xxxx", "icon": "discord" },
    { "label": "Wiki", "href": "https://en.wikipedia.org", "icon": "docs", "group": "Community" }
  ]
}
```

Run: `bun tauri dev` Then, via the Tauri MCP tools:
- `query_page` (map mode) → confirm a **Links** group with a "Discord" item and a **Community** group with a "Wiki" item appear at the bottom of the sidebar.
- `click` the "Wiki" item → confirm it opens the URL in the system browser (the app itself does not navigate; opener launches the default browser).

Expected: both groups render; clicking opens the browser. If the dev build isn't portable, note that in the report and instead verify by temporarily pointing the profile loader at the sample (or defer live-smoke to the user's `bun tauri dev` session and report it as pending).

- [ ] **Step 4: Report**

State plainly which checks passed and whether the live smoke was performed or deferred. Do not claim the click-opens-browser behaviour unless it was actually observed.

---

## Self-review notes

- **Spec coverage:** schema (Task 1) · grouping + default "Links" group + high order (Task 2) · icon map + fallback (Task 2) · fail-soft validation incl. scheme drop (Task 2) · wiring sidebar+launcher (Task 3) · unit tests (Tasks 2–3) · live smoke (Task 5) · docs (Task 4). The one spec change (main.tsx injection vs. static plugin nav) is documented above with its reason.
- **Type consistency:** `resolveLinkIcon`/`buildProfileNav`/`applyProfileLinks` signatures are identical across their defining task and their call sites; `LinkConfig`/`Profile.links` from Task 1 are consumed unchanged in Task 2.
- **No placeholders:** every code step carries full code; every command carries its expected result.
