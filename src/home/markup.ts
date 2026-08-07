import { readProfileFile, resolveFileRef } from "../profile/refs";

/**
 * Distribution markup on the home page: the `before` and `after` strings on a
 * built-in zone, and the `html` of a custom entry between zones (issue #999).
 *
 * Both keys take the same two forms the welcome's `html` takes, and mean the same
 * thing in both places:
 *
 * - inline markup, e.g. `"<p>Pick a tool</p>"`, used verbatim
 * - `@.coilbox/<path>` , resolved to that file's text
 *
 * One rule rather than one rule per key: a value starting with `@` is a
 * reference, anything else is markup. So the design's inline `before` and its
 * `html` file reference are examples, not a restriction, and a distribution can
 * keep a one-line intro in `profile.json` while a long community feed lives in
 * its own file.
 *
 * Reading a file is asynchronous and rendering is not, so the references are read
 * once at startup (`main.tsx`, next to `resolveWelcome`) and looked up
 * synchronously while rendering. That keeps the layout a pure function of its
 * props, and keeps a distribution's intro sentence from appearing a frame after
 * the zone it introduces.
 */

/** Markup ready to render, or the reason there is none. */
export interface HomeMarkup {
  /** The markup to inject. Absent when the reference could not be read. */
  html?: string;
  /** A visible message for a reference that did not resolve (fail loud). */
  error?: string;
}

/** The markup keys an author may attach to an entry, in the order they render. */
const MARKUP_KEYS = ["before", "html", "after"] as const;

/** Whether a configured value is a `@`-reference rather than inline markup. */
function isRef(value: string): boolean {
  return value.trim().startsWith("@");
}

// Populated by loadHomeMarkup() at startup, keyed by the trimmed reference as the
// author wrote it. Replaced wholesale on each load rather than added to, so a
// profile reload (which re-runs the whole boot pipeline) cannot leave a file
// behind that the edited profile no longer names.
let files = new Map<string, HomeMarkup>();

/** Every distinct `@`-reference the raw `home` key names, in the order found. */
function markupRefs(home: unknown): string[] {
  const zones = (home as { zones?: unknown } | null | undefined)?.zones;
  if (!Array.isArray(zones)) return [];
  const refs = new Set<string>();
  for (const entry of zones) {
    if (typeof entry !== "object" || entry === null) continue;
    for (const key of MARKUP_KEYS) {
      const value = (entry as Record<string, unknown>)[key];
      if (typeof value === "string" && isRef(value)) refs.add(value.trim());
    }
  }
  return [...refs];
}

/**
 * Read the markup files a profile's `home` key references into memory.
 *
 * Walks the raw value rather than the resolved page, so a malformed `zones` list
 * warns once, when the page is resolved, rather than a second time here. The cost
 * is reading a file for an entry that is later dropped, which no one sees.
 *
 * A no-op for a profile with no `home` key, so an unbranded install does no file
 * IO at startup and renders exactly as before.
 *
 * `read` is injected so the resolution is testable without the Rust command.
 */
export async function loadHomeMarkup(
  home: unknown,
  read = readProfileFile,
): Promise<void> {
  const next = new Map<string, HomeMarkup>();
  for (const ref of markupRefs(home)) {
    const { text, error } = await resolveFileRef(ref, read);
    next.set(ref, error ? { error } : { html: text });
  }
  files = next;
}

/**
 * The markup to render for a configured value. Inline markup is its own answer.
 * A reference is looked up in what {@link loadHomeMarkup} read.
 *
 * A reference with no entry means startup never saw it, which in the app can only
 * happen if the profile changed under a rendered page. It reports as a failed read
 * rather than injecting the literal `@.coilbox/...` token into the page.
 */
export function homeMarkup(value: string): HomeMarkup {
  if (!isRef(value)) return { html: value };
  const ref = value.trim();
  return files.get(ref) ?? { error: `Could not read ${ref}` };
}
