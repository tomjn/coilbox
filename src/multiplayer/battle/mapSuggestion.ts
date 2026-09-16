import type { MapItem } from "@/content/bindings";

/** A `!map <name>` line, matched against the maps installed here. */
export interface MapSuggestion {
  /** The text after `!map`, trimmed. */
  query: string;
  /** Distinct installed map names whose name contains `query`, case-insensitively. */
  matches: string[];
}

const MAP_COMMAND = /^!map\s+(.+)$/i;

/**
 * Read a chat line as a `!map <name>` suggestion, and match the name against
 * installed maps the same way the map picker's own search does (issue #350):
 * a case-insensitive substring of the map's name, so a partial name still
 * finds it. Returns null for anything that isn't a `!map` line with a name
 * after it - there is nothing to offer the host in that case.
 */
export function matchMapSuggestion(
  text: string,
  maps: MapItem[],
): MapSuggestion | null {
  const cmd = MAP_COMMAND.exec(text.trim());
  if (!cmd) return null;
  const query = cmd[1].trim();
  if (!query) return null;
  const q = query.toLowerCase();
  const matches = [...new Set(maps.map((m) => m.name))].filter((name) =>
    name.toLowerCase().includes(q),
  );
  return { query, matches };
}
