/**
 * A small predicate language for finding units by their stats, not just their
 * name (issue #2656): "hp > 3000", "speed < 50 and cost > 200", or a plain
 * word that falls back to a name search the way the unit list always has.
 *
 * The same predicate defines rule-based membership for a collection
 * (`collections.ts`), so a collection can be "every unit cheaper than 200
 * metal" and stay current as values change, rather than a fixed list somebody
 * has to update by hand.
 *
 * Grammar, case-insensitive throughout:
 *
 *   query      := orGroup ("or" orGroup)*
 *   orGroup    := term+                 -- terms are ANDed together. The word
 *                                           "and" between them is accepted
 *                                           and does nothing, since that is
 *                                           already the default
 *   term       := comparison | word
 *   comparison := field (">"|"<"|">="|"<="|"="|"!=") value
 *   value      := number | "quoted text" | bareword
 *
 * A run of bare words with no comparison between them is one name phrase,
 * matched as a whole against the unit's key and display name, so "advanced
 * aircraft plant" stays one search rather than three words ANDed apart.
 *
 * A field name is resolved against a small alias table first (`hp`, `speed`,
 * `cost`, `metal`, `energy`, `buildtime`, `los`...), then against the
 * engine's own field name for a unit definition, case-insensitively. Both
 * spellings a game may still carry are tried in order, oldest last, mirroring
 * `derivedStats.ts`'s `health`/`maxDamage` and `metalCost`/`buildCostMetal`
 * pairs: `src/content/unitFieldNotes.ts` is what says which is which. A name
 * that resolves to nothing the engine declares for a unit is a parse error,
 * reported inline rather than silently matching nothing.
 *
 * Parsing never throws. A malformed query comes back as `{ ok: false, error
 * }` with a message meant to be shown next to the search box.
 */
import { engineFields } from "@/content/unitFields";

export type CompareOp = ">" | "<" | ">=" | "<=" | "=" | "!=";

/** One field a query names, alongside every real spelling a game might use
 *  for it, oldest last. */
interface FieldTerm {
  kind: "field";
  /** The identifier as the query typed it, for error messages only. */
  label: string;
  keys: string[];
  op: CompareOp;
  value: number | string;
}

/** A run of bare words, matched as a substring against the unit's key and
 *  display name. */
interface NameTerm {
  kind: "name";
  phrase: string;
}

type QueryTerm = FieldTerm | NameTerm;

/** Groups are ANDed terms. The query matches a unit that satisfies any group,
 *  which is the OR between them. An empty query (nothing was typed) matches
 *  every unit. */
export type ParsedQuery = QueryTerm[][];

export type ParseResult =
  | { ok: true; query: ParsedQuery }
  | { ok: false; error: string };

/**
 * Aliases for the fields somebody actually types. Each resolves to the real
 * engine keys to try, in the order `readPath` callers already try them
 * elsewhere in the workshop.
 */
const FIELD_ALIASES: Record<string, string[]> = {
  hp: ["health", "maxDamage"],
  health: ["health", "maxDamage"],
  speed: ["speed", "maxVelocity"],
  cost: ["metalCost", "buildCostMetal"],
  metal: ["metalCost", "buildCostMetal"],
  metalcost: ["metalCost", "buildCostMetal"],
  energy: ["energyCost", "buildCostEnergy"],
  energycost: ["energyCost", "buildCostEnergy"],
  buildtime: ["buildTime"],
  time: ["buildTime"],
  los: ["sightDistance"],
  sight: ["sightDistance"],
  sightdistance: ["sightDistance"],
  sightrange: ["sightDistance"],
};

/** Every top level key the engine declares for a unit definition, lowercased
 *  for a case-insensitive lookup, alongside the case the engine writes it in. */
function unitFieldKeys(): Map<string, string> {
  const out = new Map<string, string>();
  for (const field of engineFields("unit")) {
    if (field.section === "") out.set(field.key.toLowerCase(), field.key);
  }
  return out;
}

/** Built once. The registry this reads is a module-level constant generated
 *  from the engine, so there is nothing here that changes between calls. */
let unitFieldKeyCache: Map<string, string> | undefined;
/**
 * Resolve a field name typed by a person to the real engine keys to try, in
 * the same order and with the same alias table {@link parseUnitQuery} uses.
 * Exported so a batch edit's field picker (issue #2655) resolves a field the
 * same way a search or a rule does, rather than keeping a second table of
 * spellings.
 */
export function resolveField(
  identifier: string,
): { ok: true; keys: string[] } | { ok: false; error: string } {
  const lower = identifier.toLowerCase();
  const alias = FIELD_ALIASES[lower];
  if (alias) return { ok: true, keys: alias };
  unitFieldKeyCache ??= unitFieldKeys();
  const engineKey = unitFieldKeyCache.get(lower);
  if (engineKey) return { ok: true, keys: [engineKey] };
  return {
    ok: false,
    error: `Unknown field "${identifier}". Try hp, speed, cost, metal, energy, buildtime, los, or a unit field's own name.`,
  };
}

type Token =
  | { type: "word"; value: string }
  | { type: "quoted"; value: string }
  | { type: "op"; value: CompareOp }
  | { type: "and" }
  | { type: "or" };

const TOKEN_RE =
  /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|>=|<=|!=|=|>|<|[^\s"'<>=!]+/g;

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  for (const match of input.matchAll(TOKEN_RE)) {
    const [text, dquoted, squoted] = match;
    if (dquoted !== undefined) {
      tokens.push({ type: "quoted", value: dquoted });
    } else if (squoted !== undefined) {
      tokens.push({ type: "quoted", value: squoted });
    } else if (
      text === ">=" ||
      text === "<=" ||
      text === "!=" ||
      text === "=" ||
      text === ">" ||
      text === "<"
    ) {
      tokens.push({ type: "op", value: text });
    } else if (text.toLowerCase() === "and") {
      tokens.push({ type: "and" });
    } else if (text.toLowerCase() === "or") {
      tokens.push({ type: "or" });
    } else {
      tokens.push({ type: "word", value: text });
    }
  }
  return tokens;
}

const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

/** Parse a query typed into the search box into groups of terms, or an
 *  inline error for the box to show. */
export function parseUnitQuery(input: string): ParseResult {
  const tokens = tokenize(input);
  const groups: QueryTerm[][] = [];
  let current: QueryTerm[] = [];
  let phrase: string[] = [];

  const flushPhrase = () => {
    if (phrase.length > 0) {
      current.push({ kind: "name", phrase: phrase.join(" ") });
      phrase = [];
    }
  };

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token.type === "or") {
      flushPhrase();
      if (current.length === 0) {
        return { ok: false, error: 'Expected something before "or".' };
      }
      groups.push(current);
      current = [];
      i++;
      continue;
    }
    if (token.type === "and") {
      flushPhrase();
      i++;
      continue;
    }
    if (token.type === "op") {
      return {
        ok: false,
        error: `"${token.value}" needs a field name before it.`,
      };
    }
    const next = tokens[i + 1];
    if (token.type === "word" && next?.type === "op") {
      flushPhrase();
      const valueToken = tokens[i + 2];
      if (
        !valueToken ||
        valueToken.type === "op" ||
        valueToken.type === "and" ||
        valueToken.type === "or"
      ) {
        return {
          ok: false,
          error: `"${token.value} ${next.value}" needs a value after it.`,
        };
      }
      const resolved = resolveField(token.value);
      if (!resolved.ok) return resolved;
      const isNumber =
        valueToken.type === "word" && NUMBER_RE.test(valueToken.value);
      if (
        (next.value === ">" ||
          next.value === "<" ||
          next.value === ">=" ||
          next.value === "<=") &&
        !isNumber
      ) {
        return {
          ok: false,
          error: `"${token.value} ${next.value}" needs a number, not "${valueToken.value}".`,
        };
      }
      current.push({
        kind: "field",
        label: token.value,
        keys: resolved.keys,
        op: next.value,
        value: isNumber
          ? Number(valueToken.value)
          : valueToken.value.toLowerCase(),
      });
      i += 3;
      continue;
    }
    phrase.push(token.value);
    i++;
  }
  flushPhrase();

  if (current.length === 0) {
    if (groups.length > 0) {
      return { ok: false, error: 'Expected something after "or".' };
    }
    return { ok: true, query: [] };
  }
  groups.push(current);
  return { ok: true, query: groups };
}

/** What a query is evaluated against: one unit's own key, its display name,
 *  and its resolved fields (the game's read plus the project's own
 *  overrides), so a search and a rule collection both reflect a project's own
 *  edits rather than only the game's defaults. */
export interface UnitQueryContext {
  key: string;
  name: string;
  /** The game's def for this unit (with any project-added clone already
   *  folded in the same way `UnitList`'s own `units` prop is). */
  def: Record<string, unknown> | undefined;
  /** The project's own overrides for this unit, keyed by field path, checked
   *  before `def` for each candidate key. */
  overrides?: Record<string, unknown>;
}

function findKeyCI(
  table: Record<string, unknown>,
  lower: string,
): string | undefined {
  return Object.keys(table).find((key) => key.toLowerCase() === lower);
}

function fieldValue(ctx: UnitQueryContext, keys: string[]): unknown {
  for (const key of keys) {
    if (ctx.overrides && Object.hasOwn(ctx.overrides, key)) {
      return ctx.overrides[key];
    }
    if (ctx.def) {
      const found = findKeyCI(ctx.def, key.toLowerCase());
      if (found !== undefined) return ctx.def[found];
    }
  }
  return undefined;
}

function coerceNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function evaluateTerm(term: QueryTerm, ctx: UnitQueryContext): boolean {
  if (term.kind === "name") {
    const needle = term.phrase.toLowerCase();
    return (
      ctx.key.toLowerCase().includes(needle) ||
      ctx.name.toLowerCase().includes(needle)
    );
  }
  const raw = fieldValue(ctx, term.keys);
  if (raw === undefined) return false;
  if (typeof term.value === "number") {
    const n = coerceNumber(raw);
    if (n === undefined) return false;
    switch (term.op) {
      case ">":
        return n > term.value;
      case "<":
        return n < term.value;
      case ">=":
        return n >= term.value;
      case "<=":
        return n <= term.value;
      case "=":
        return n === term.value;
      case "!=":
        return n !== term.value;
    }
  }
  const s = String(raw).toLowerCase();
  if (term.op === "=") return s === term.value;
  if (term.op === "!=") return s !== term.value;
  // Ordering against a non-numeric value never parses (see parseUnitQuery),
  // so this is unreachable, but a stray term should not throw.
  return false;
}

/** Whether `ctx` matches `query`. An empty query (nothing was typed) matches
 *  everything, the same as the unit list's old plain-substring search did. */
export function evaluateUnitQuery(
  query: ParsedQuery,
  ctx: UnitQueryContext,
): boolean {
  if (query.length === 0) return true;
  return query.some((group) => group.every((term) => evaluateTerm(term, ctx)));
}
