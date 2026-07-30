/**
 * Find every piece name a Lua unit script declares with `piece(...)`.
 *
 * The generator's own tests use this to assert that every piece it names
 * actually exists on the unit (see `luaScript.test.ts`). It lives here,
 * rather than inside the test, so a future script editor can run the same
 * check against a script it did not generate.
 *
 * Matches the double-quoted, parenthesised form the generator emits
 * (`piece("name")`), the unparenthesised single-quoted form a converted BOS
 * script uses (`piece 'name'`), and the long-bracket form (`piece [[name]]`).
 */
export function declaredPieces(lua: string): string[] {
  const re = /piece\s*\(?\s*(?:"([^"]+)"|'([^']+)'|\[\[([^\]]+)\]\])\s*\)?/g;
  return [...lua.matchAll(re)].map((match) => match[1] ?? match[2] ?? match[3]);
}
