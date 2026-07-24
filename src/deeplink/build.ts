/**
 * Pure builder for `coilbox://` deep links (issue #498) - the exact inverse of
 * `parse.ts`. Turns a typed `DeepLinkAction` into the URL string that
 * `parseDeepLink` accepts, so every link this app generates is guaranteed to
 * round-trip through the same grammar the inbound handler enforces (issue
 * #388). No side effects and no app state: callers own the clipboard write and
 * any confirmation UI.
 *
 * Kept next to `parse.ts` deliberately, so the two are read and changed
 * together whenever the grammar moves.
 */

import {
  DEEP_LINK_SCHEME,
  type DeepLinkAction,
  MAX_CODE_LENGTH,
  MAX_FIELD_LENGTH,
  MAX_URL_LENGTH,
  OPEN_SCREENS,
} from "./parse";

export type BuildDeepLinkResult =
  | { ok: true; url: string }
  | { ok: false; reason: string };

const invalid = (reason: string): BuildDeepLinkResult => ({
  ok: false,
  reason,
});

/** A field is only worth putting in a link if it round-trips through
 * `parse.ts`'s own field reader: non-empty, trimmed, and within its size cap. */
function validField(value: string): boolean {
  const trimmed = value.trim();
  return trimmed !== "" && trimmed.length <= MAX_FIELD_LENGTH;
}

/**
 * Build a `coilbox://` URL for a validated deep-link action. Never throws:
 * an action that can't be expressed as a link that would parse back to itself
 * (a missing server/battle, an id-less id-needing screen, an oversized field)
 * resolves to `{ ok: false }` with a human-readable reason, so a caller can
 * hide the share affordance rather than hand out a broken link.
 */
export function buildDeepLink(action: DeepLinkAction): BuildDeepLinkResult {
  switch (action.kind) {
    case "join":
      return buildJoin(action);
    case "import":
      return buildImport(action);
    case "open":
      return buildOpen(action);
  }
}

function buildJoin(
  action: Extract<DeepLinkAction, { kind: "join" }>,
): BuildDeepLinkResult {
  if (!validField(action.server)) {
    return invalid("This battle has no server to join.");
  }
  if (!validField(action.battle)) {
    return invalid("This battle has no id to join.");
  }
  if (action.password !== undefined && !validField(action.password)) {
    return invalid("This battle's password is too long for a link.");
  }
  const params = new URLSearchParams({
    server: action.server,
    battle: action.battle,
  });
  if (action.password) params.set("password", action.password);
  return { ok: true, url: `${DEEP_LINK_SCHEME}://join?${params.toString()}` };
}

function buildImport(
  action: Extract<DeepLinkAction, { kind: "import" }>,
): BuildDeepLinkResult {
  const { source } = action;
  if (source.type === "code") {
    const trimmed = source.code.trim();
    if (trimmed === "") return invalid("There is nothing to share yet.");
    if (trimmed.length > MAX_CODE_LENGTH) {
      return invalid("This is too large to share as a link.");
    }
    const params = new URLSearchParams({ code: trimmed });
    return {
      ok: true,
      url: `${DEEP_LINK_SCHEME}://import?${params.toString()}`,
    };
  }

  const trimmedUrl = source.url.trim();
  if (trimmedUrl === "") return invalid("There is no URL to share.");
  if (trimmedUrl.length > MAX_URL_LENGTH) {
    return invalid("This URL is too long for a link.");
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmedUrl);
  } catch {
    return invalid("That URL is invalid.");
  }
  if (parsed.protocol !== "https:") {
    return invalid("Import URLs must be https.");
  }
  const params = new URLSearchParams({ url: parsed.toString() });
  return { ok: true, url: `${DEEP_LINK_SCHEME}://import?${params.toString()}` };
}

function buildOpen(
  action: Extract<DeepLinkAction, { kind: "open" }>,
): BuildDeepLinkResult {
  const spec = OPEN_SCREENS[action.screen];
  if (spec.needsId && !action.id) {
    return invalid(`Opening "${action.screen}" needs an id.`);
  }
  if (action.id !== undefined && !validField(action.id)) {
    return invalid("This id is invalid for a link.");
  }
  const params = new URLSearchParams({ screen: action.screen });
  if (action.id) params.set("id", action.id.trim());
  return { ok: true, url: `${DEEP_LINK_SCHEME}://open?${params.toString()}` };
}

/** Build an `import?code=` link for a container code - the shape every
 * challenge, setup pack and preset share flow produces (issue #498). Returns
 * `null` rather than a broken link when there is no code to carry. */
export function buildImportCodeLink(code: string): string | null {
  const result = buildDeepLink({
    kind: "import",
    source: { type: "code", code },
  });
  return result.ok ? result.url : null;
}

/** Build a `join?server=&battle=` link for a hosted battle (issue #498).
 * Returns `null` rather than a broken link when the server or battle id can't
 * be resolved. */
export function buildJoinLink(
  server: string | null | undefined,
  battle: string | null | undefined,
): string | null {
  if (!server || !battle) return null;
  const result = buildDeepLink({ kind: "join", server, battle });
  return result.ok ? result.url : null;
}
