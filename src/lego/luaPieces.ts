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
 * script uses (`piece 'name'`), the long-bracket form (`piece [[name]]`), and
 * a call naming several at once (`piece("base", "turret")`).
 */
export function declaredPieces(lua: string): string[] {
  return pieceNameLiterals(lua).map((literal) => literal.name);
}

/** One piece name as a script writes it, with where its text starts and ends
 *  (the quotes or brackets excluded). */
export interface PieceNameLiteral {
  name: string;
  start: number;
  end: number;
}

const PIECE_CALL =
  /\bpiece\s*(?:\(([^)]*)\)|("[^"]+"|'[^']+'|\[\[[^\]]+\]\]))/g;
const STRING_LITERAL = /"([^"]+)"|'([^']+)'|\[\[([^\]]+)\]\]/g;

/** Every piece name a script's `piece(...)` calls name, in order, with its
 *  place in the text so it can be rewritten. */
export function pieceNameLiterals(lua: string): PieceNameLiteral[] {
  const found: PieceNameLiteral[] = [];
  for (const call of lua.matchAll(PIECE_CALL)) {
    const args = call[1] ?? call[2];
    const argsAt = call.index + call[0].indexOf(args);
    for (const literal of args.matchAll(STRING_LITERAL)) {
      const name = literal[1] ?? literal[2] ?? literal[3];
      const open = literal[0].startsWith("[[") ? 2 : 1;
      const start = argsAt + literal.index + open;
      found.push({ name, start, end: start + name.length });
    }
  }
  return found;
}

/**
 * The piece names a script declares that the unit does not have.
 *
 * In the order the script names them, each one once. The engine fails at load
 * on the first of these, so a script editor can say which name is wrong before
 * the unit ever reaches a game.
 */
export function missingPieces(lua: string, pieces: Iterable<string>): string[] {
  const present = new Set(pieces);
  return [...new Set(declaredPieces(lua))].filter((name) => !present.has(name));
}

/**
 * The 1-indexed line of the first `piece(...)` call naming `name`, so a
 * missing-piece warning can point somewhere rather than just naming the piece.
 *
 * Line 1 for a name that names nowhere, which should not happen for anything
 * {@link missingPieces} itself returned.
 */
export function lineNamingPiece(lua: string, name: string): number {
  const literal = pieceNameLiterals(lua).find((entry) => entry.name === name);
  return literal ? lua.slice(0, literal.start).split("\n").length : 1;
}

/**
 * The script with piece names swapped by `mapping` (script name to new name),
 * wherever a `piece(...)` call names them. Nothing else in the text changes,
 * so a variable keeps its name and only the piece it asks the model for moves.
 */
export function renameScriptPieces(
  lua: string,
  mapping: Record<string, string>,
): string {
  let out = "";
  let at = 0;
  for (const literal of pieceNameLiterals(lua)) {
    const to = mapping[literal.name];
    if (to === undefined || to === literal.name) continue;
    out += lua.slice(at, literal.start) + to;
    at = literal.end;
  }
  return out + lua.slice(at);
}
