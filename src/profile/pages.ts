import type { NavGroup, NavItem } from "@picoframe/plugin-sdk";
import { defineCommand } from "@picoframe/plugin-sdk";
import { resolveLinkIcon } from "./links";
import { parseRef, readProfileFile } from "./refs";

/**
 * Custom distribution pages (issue #255): a bundler drops Markdown files into the
 * portable `.coilbox/pages/` folder and each becomes an in-app screen. Frontmatter at
 * the top of each file sets its route, breadcrumb title, sidebar icon/group and an
 * optional background image. The Rust `coilbox-profile` plugin only lists + reads the
 * files (schema-agnostic, like the rest of the profile); this module owns the
 * frontmatter schema and turns the files into frame routes + nav items.
 */

/** One markdown file as returned by the `profile_pages` command. */
export interface PageFile {
  /** `.coilbox`-relative path, e.g. `pages/about.md`. */
  path: string;
  /** Raw file text (frontmatter + body). */
  content: string;
}

/** Parsed frontmatter values — flat scalars only (strings, booleans, numbers). */
export type Frontmatter = Record<string, string | number | boolean>;

/** A resolved custom page: a route, its nav presentation, and the markdown body. */
export interface ProfilePage {
  /** Route path (no leading slash), always under `pages/`, e.g. `pages/about`. */
  route: string;
  /** Breadcrumb + nav label. */
  title: string;
  /** Curated lucide icon name for the sidebar item (see docs). */
  icon?: string;
  /** `.coilbox`-relative (or `data:`/`http(s):`) background image for the page. */
  background?: string;
  /** Whether to show a sidebar item for this page (frontmatter `nav`, default true). */
  nav: boolean;
  /** Sidebar group heading; omitted → a top-level (unlabelled) group. */
  group?: string;
  /** Sort order within its nav group and among routes. */
  order: number;
  /** Markdown body (frontmatter stripped). */
  body: string;
}

const pagesLoadCmd = defineCommand<
  Record<string, never>,
  { pages: PageFile[] }
>("coilbox-profile", "profile_pages");

/**
 * Parse a leading `---`-delimited YAML-ish frontmatter block into flat scalars and
 * return it with the remaining body. Deliberately tiny (no YAML dependency): one
 * `key: value` per line, `#` comments and blank lines skipped, surrounding quotes
 * stripped, `true`/`false` → boolean and bare numbers → number. Nested structures
 * aren't supported — the page schema only needs scalars. A file with no frontmatter
 * yields `{ data: {}, body: <whole file> }`.
 */
export function parseFrontmatter(raw: string): {
  data: Frontmatter;
  body: string;
} {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(raw);
  if (!m) return { data: {}, body: raw };
  const data: Frontmatter = {};
  for (const line of m[1].split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const idx = t.indexOf(":");
    if (idx <= 0) continue;
    const key = t.slice(0, idx).trim();
    const val = t.slice(idx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      data[key] = val.slice(1, -1);
    } else if (val === "true" || val === "false") {
      data[key] = val === "true";
    } else if (val !== "" && !Number.isNaN(Number(val))) {
      data[key] = Number(val);
    } else {
      data[key] = val;
    }
  }
  return { data, body: raw.slice(m[0].length) };
}

/** Include-recursion cap: a runaway/deeply-nested include chain stops here. */
const MAX_INCLUDE_DEPTH = 8;

/**
 * Expand `@.coilbox/*.md` include directives (issue #274): a line whose sole content is
 * a markdown file reference is replaced by that file's text, recursively — Claude-style
 * transclusion so pages can share fragments. Only a *lone* `@.coilbox/....md` line is an
 * include (an inline `@`-ref mid-sentence is left as text); non-`.md` refs are ignored.
 *
 * Fails loud, never hangs: a missing/unsafe file or a cycle (A→B→A) becomes a visible
 * error/cycle marker line instead of a blank or an infinite loop. The `seen` set tracks
 * the current include chain — seeded by the caller with the host page's own path — and a
 * fresh copy is passed down each branch, so the same fragment included twice in different
 * places is fine; only genuine recursion is flagged. `read` is injected for testability.
 */
export async function expandIncludes(
  body: string,
  read: (path: string) => Promise<{ text: string; ok: boolean }>,
  seen: Set<string> = new Set(),
  depth = 0,
): Promise<string> {
  const out: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const ref = parseRef(line.trim());
    if (ref?.kind !== "file" || !/\.md$/i.test(ref.path)) {
      out.push(line);
      continue;
    }
    if (seen.has(ref.path)) {
      out.push(`> **Include error:** cycle detected at \`${line.trim()}\``);
      continue;
    }
    if (depth >= MAX_INCLUDE_DEPTH) {
      out.push(
        `> **Include error:** include nesting too deep at \`${line.trim()}\``,
      );
      continue;
    }
    const { text, ok } = await read(ref.path);
    if (!ok) {
      out.push(`> **Include error:** could not read \`${line.trim()}\``);
      continue;
    }
    const nextSeen = new Set(seen).add(ref.path);
    out.push(await expandIncludes(text, read, nextSeen, depth + 1));
  }
  return out.join("\n");
}

/** A route slug: lowercase segments of `[a-z0-9]`, joined by `-` or `/` (for nesting). */
const SLUG = /^[a-z0-9]+(?:[/-][a-z0-9]+)*$/;

/** Derive a slug from a file path: `pages/About Us.md` → `about-us`. */
function slugFromPath(path: string): string {
  const file = path.split("/").pop() ?? path;
  return file
    .replace(/\.md$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Turn the raw markdown files into resolved pages. Each page's route lives under
 * `pages/<slug>` — namespaced so an author-chosen path can never collide with a
 * built-in route and break the app. The slug is the frontmatter `path` (sans any
 * leading slash / `.md`) or, failing that, the filename. Invalid or duplicate slugs
 * are dropped with a warning (fails soft, like the rest of the profile). Sorted by
 * `order` so nav + route order is stable and author-controllable.
 */
export function buildProfilePages(files: PageFile[]): ProfilePage[] {
  const pages: ProfilePage[] = [];
  const seen = new Set<string>();
  files.forEach((file, i) => {
    const { data, body } = parseFrontmatter(file.content);
    const raw =
      typeof data.path === "string" && data.path.trim()
        ? data.path.trim()
        : slugFromPath(file.path);
    const slug = raw.toLowerCase().replace(/^\/+/, "").replace(/\.md$/i, "");
    if (!SLUG.test(slug)) {
      console.warn(
        `profile: skipping page with invalid path "${raw}" (${file.path})`,
      );
      return;
    }
    const route = `pages/${slug}`;
    if (seen.has(route)) {
      console.warn(
        `profile: skipping page with duplicate path "${slug}" (${file.path})`,
      );
      return;
    }
    seen.add(route);
    pages.push({
      route,
      title:
        typeof data.title === "string" && data.title.trim()
          ? data.title.trim()
          : slug,
      icon: typeof data.icon === "string" ? data.icon : undefined,
      background:
        typeof data.background === "string" && data.background.trim()
          ? data.background.trim()
          : undefined,
      nav: data.nav !== false,
      group:
        typeof data.group === "string" && data.group.trim()
          ? data.group.trim()
          : undefined,
      order: typeof data.order === "number" ? data.order : 100 + i,
      body,
    });
  });
  return pages.sort((a, b) => a.order - b.order);
}

/** Base sort order for profile page nav groups — below feature nav, above links. */
const PAGES_GROUP_ORDER = 900;

/**
 * Build sidebar nav groups from the pages that opt in (frontmatter `nav` !== false).
 * Pages sharing a `group` label collect under one heading (first-seen order); those
 * without one sit in a single top-level (unlabelled) group. Returns [] when no page
 * wants a sidebar item, so a distribution can ship purely link-from-elsewhere pages.
 */
export function buildPageNav(pages: ProfilePage[]): NavGroup[] {
  const navPages = pages.filter((p) => p.nav);
  if (navPages.length === 0) return [];

  const order: string[] = [];
  const byGroup = new Map<string, { label?: string; items: NavItem[] }>();
  for (const page of navPages) {
    const key = page.group ?? "";
    let bucket = byGroup.get(key);
    if (!bucket) {
      bucket = { label: page.group, items: [] };
      byGroup.set(key, bucket);
      order.push(key);
    }
    bucket.items.push({
      id: `profile.page.${page.route}`,
      label: page.title,
      to: `/${page.route}`,
      icon: resolveLinkIcon(page.icon),
      order: page.order,
    });
  }

  return order.map((key, gi) => {
    const bucket = byGroup.get(key);
    return {
      id: `profile-pages-${gi}`,
      label: bucket?.label,
      order: PAGES_GROUP_ORDER + gi,
      items: bucket?.items ?? [],
    };
  });
}

// Module singleton: populated by loadProfilePages() in main.tsx before the plugin
// list is finalized, then read synchronously by applyProfilePages (same load-once
// pattern as the profile itself).
let loadedPages: ProfilePage[] = [];

/**
 * Load and resolve the distribution's custom pages once at startup. Fails soft: any
 * transport error leaves the page list empty, so vanilla Coilbox (and any non-portable
 * install) is untouched.
 */
export async function loadProfilePages(): Promise<ProfilePage[]> {
  try {
    const { pages } = await pagesLoadCmd({});
    // Expand `@.coilbox/*.md` includes before building pages, so each page's body is
    // fully resolved and rendering stays synchronous. The cycle guard is seeded with the
    // page's own file path so a page that includes itself is caught immediately.
    const expanded = await Promise.all(
      (pages ?? []).map(async (f) => ({
        path: f.path,
        content: await expandIncludes(
          f.content,
          readProfileFile,
          new Set([f.path]),
        ),
      })),
    );
    loadedPages = buildProfilePages(expanded);
  } catch (e) {
    console.warn("profile: failed to load custom pages", e);
    loadedPages = [];
  }
  return loadedPages;
}

/** The resolved custom pages (empty until `loadProfilePages()` resolves). */
export function getProfilePages(): ProfilePage[] {
  return loadedPages;
}
