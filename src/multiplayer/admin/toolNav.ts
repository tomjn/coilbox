/**
 * Which Server admin tool is on screen (issue #2918). Pure, and free of the
 * tool components, so a section can import `TOOL_PARAM` without importing
 * every other section through the registry in `tools.tsx`.
 */

/** The URL param that names the tool, beside `?server=` and `?player=`. */
export const TOOL_PARAM = "tool";

/** What the choice needs to know about a tool. */
export interface AdminToolEntry {
  id: string;
  /** Shown only to uberserver admins, in the nav's own "Admin only" group. */
  adminOnly?: boolean;
}

/** The tools the viewer may open: all of them for an admin, the moderation
 * ones for a moderator. */
export function visibleTools<T extends AdminToolEntry>(
  tools: readonly T[],
  isAdmin: boolean,
): T[] {
  return tools.filter((tool) => isAdmin || !tool.adminOnly);
}

/** Moderation tools and admin-only tools, in registry order. */
export function groupTools<T extends AdminToolEntry>(
  tools: readonly T[],
): { moderation: T[]; admin: T[] } {
  return {
    moderation: tools.filter((tool) => !tool.adminOnly),
    admin: tools.filter((tool) => tool.adminOnly),
  };
}

/**
 * The tool to show, from the URL. `?ban=` is the lookup's Ban button handing a
 * name to the Bans form, so it wins even though the page is still on Players.
 * Then `?tool=`, when it names a tool on offer. Then `?player=`, the chat
 * member menu's link, which carries no tool. Otherwise the first tool.
 * `tools` must be non-empty.
 */
export function chosenToolId(
  params: URLSearchParams,
  tools: readonly AdminToolEntry[],
): string {
  const offered = (id: string | null) =>
    id !== null && tools.some((tool) => tool.id === id);
  if (params.has("ban") && offered("bans")) return "bans";
  const named = params.get(TOOL_PARAM);
  if (offered(named)) return named as string;
  if (params.has("player") && offered("players")) return "players";
  return tools[0].id;
}

/** The search params that open `id`, keeping the connection and the looked-up
 * name. A pending `?ban=` is dropped, since it would pull the page back to
 * Bans. */
export function toolSearch(
  params: URLSearchParams,
  id: string,
): URLSearchParams {
  const next = new URLSearchParams(params);
  next.set(TOOL_PARAM, id);
  next.delete("ban");
  return next;
}
