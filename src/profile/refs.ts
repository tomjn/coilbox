import { defineCommand } from "@picoframe/plugin-sdk";

/**
 * The `@`-reference scheme (issue #274): a single `@<namespace>/<rest>` token that a
 * distribution's profile.json fields and custom markdown can use to compose content.
 * The first segment after `@` is a namespace discriminator, so there's no ambiguity
 * between (say) a file named `route` and the `route` namespace:
 *
 * - `@.coilbox/<rel-path>` — a file under the portable `.coilbox/` root. Anything that
 *   would resolve outside the root (`..`, absolute, empty) is rejected here and, as a
 *   backstop, by the Rust `is_safe_rel` guard.
 * - `@route/<app-route>` — an in-app route, e.g. `@route/singleplayer` → `/singleplayer`.
 * - `@widget/<name>[/<arg>]` — a live Coilbox component embedded in place.
 *
 * This module owns only the *parsing* and the file bindings. Each consumer
 * (welcome fields, markdown includes, link resolution, widget rendering) interprets the
 * parsed ref for its own context.
 */

/** A parsed `@`-reference. `null` from {@link parseRef} means "not a valid ref". */
export type Ref =
  | { kind: "file"; path: string }
  | { kind: "route"; to: string }
  | { kind: "widget"; name: string; arg?: string };

/**
 * Whether a `.coilbox`-relative path is safe to read: non-empty, not absolute, no
 * drive prefix, no `..`/empty segment. Mirrors the Rust `is_safe_rel` fence so a bad
 * ref is caught before the command call (Rust re-checks as the authoritative backstop).
 */
export function isSafeRel(path: string): boolean {
  if (!path) return false;
  if (path.startsWith("/") || path.startsWith("\\")) return false;
  if (/^[A-Za-z]:/.test(path)) return false;
  return !path.split(/[/\\]/).some((seg) => seg === "" || seg === "..");
}

/**
 * Parse an `@<namespace>/<rest>` token into a {@link Ref}, or `null` when it isn't a
 * valid reference (unknown namespace, empty rest, or an unsafe file path). Surrounding
 * whitespace is trimmed.
 */
export function parseRef(token: string): Ref | null {
  const t = token.trim();
  if (!t.startsWith("@")) return null;
  const slash = t.indexOf("/");
  if (slash === -1) return null;
  const namespace = t.slice(1, slash);
  const rest = t.slice(slash + 1);

  if (namespace === ".coilbox") {
    return isSafeRel(rest) ? { kind: "file", path: rest } : null;
  }
  if (namespace === "route") {
    return rest ? { kind: "route", to: `/${rest}` } : null;
  }
  if (namespace === "widget") {
    const inner = rest.indexOf("/");
    const name = inner === -1 ? rest : rest.slice(0, inner);
    if (!name) return null;
    const arg = inner === -1 ? "" : rest.slice(inner + 1);
    return arg ? { kind: "widget", name, arg } : { kind: "widget", name };
  }
  return null;
}

const profileFileCmd = defineCommand<
  { path: string },
  { text: string; ok: boolean }
>("coilbox-profile", "profile_file");

/** Read a `.coilbox`-relative file as raw text via the Rust `profile_file` command. */
export function readProfileFile(
  path: string,
): Promise<{ text: string; ok: boolean }> {
  return profileFileCmd({ path });
}

const profileOpenCmd = defineCommand<
  { path: string },
  { action: "open" | "reveal" }
>("coilbox-profile", "profile_open");

/**
 * Act on a click on a link to a `.coilbox`-relative bundled file (issue #1786): a
 * picture, document, clip or page opens in whatever program the OS opens its file
 * type with, and anything else is shown in the file manager. Which of the two
 * happened comes back as `action`.
 *
 * Rust decides, and this side never sees a filesystem path. The `.coilbox` folder
 * sits beside the executable, so its location is only known once the app has found
 * itself, and the choice of what may be opened belongs next to the check that the
 * file is inside that folder at all. Rejects when the path escapes the folder, the
 * file is not there, or the install is not portable.
 */
export function openProfileFile(
  path: string,
): Promise<{ action: "open" | "reveal" }> {
  return profileOpenCmd({ path });
}

/**
 * Resolve a profile string field that may hold a `@.coilbox/...` file reference. An
 * inline (non-`@`) value passes through verbatim (back-compatible with the old inline
 * fragments). A value beginning with `@` is treated as a file-ref attempt and resolved
 * via `read`: a malformed/escaping ref or a failed read yields a visible `error` string
 * (fail-loud — the issue's "will error out") rather than silently injecting the literal
 * token or blanking. `read` is injected so the pure resolution is unit-testable.
 */
export async function resolveFileRef(
  value: string,
  read: (path: string) => Promise<{ text: string; ok: boolean }>,
): Promise<{ text: string; error?: string }> {
  if (!value.trim().startsWith("@")) return { text: value };
  const ref = parseRef(value);
  if (ref?.kind !== "file") {
    return { text: "", error: `Invalid file reference: ${value.trim()}` };
  }
  const { text, ok } = await read(ref.path);
  if (!ok) return { text: "", error: `Could not read ${value.trim()}` };
  return { text };
}
