import { effectiveTeams, type Participant } from "../play/participants";
import type {
  DifficultyRange,
  Scenario,
  ScenarioDialogue,
  ScenarioGroup,
  ScenarioObjective,
  ScenarioOrder,
  ScenarioParam,
  ScenarioTrigger,
  ScenarioZone,
  TriggerStep,
} from "./model";
import { baseBuildings, MISSION_SCHEMA_VERSION } from "./model";

/**
 * Compile a scenario document to the Lua the mission runtime reads.
 *
 * The output is one `return { ... }` table literal, so the runtime needs a
 * single `VFS.Include` and no parser. It mirrors the document rather than
 * inventing a second vocabulary: what the editor stores under a name is what
 * the runtime reads under that name, so a mission that misbehaves can be
 * diagnosed by reading the compiled file beside the JSON.
 *
 * Bases are the one exception, and they are deliberate. A document holds a
 * layout and the placements of it separately (issue #1310), and the runtime is
 * vendored into games, so a copy that shipped a year ago still reads what it has
 * always read: one `prefabs` list, each entry with its buildings inline. The two
 * halves are put back together here rather than at the far end, which costs the
 * runtime nothing and means the split is free to move again later.
 *
 * Two things the document cannot carry are added here:
 *
 * - Each participant's engine team number, from {@link effectiveTeams}, the
 *   same function the launcher's start script is built from, so the numbers
 *   agree. Without them the runtime cannot spawn anything, because scenario
 *   team ids are participant ids and the engine only knows team indices.
 * - The map and game names, so the runtime can refuse a mission compiled for a
 *   different map rather than dropping its units in the sea.
 *
 * Deterministic by construction: array order is document order, and every
 * user-keyed table (vars, teams, unknown trigger parameters) is emitted in
 * sorted key order. Co-op later needs two machines to compile the same document
 * to the same bytes.
 *
 * This is the emitter only. Reading the file back and asserting every id
 * reference resolves is the validator's job, and it deliberately runs against
 * the emitted Lua rather than against the document.
 */

/** Where a compiled mission lives inside the game archive. */
export function missionPath(scenarioId: string): string {
  return `missions/${scenarioId}/mission.lua`;
}

/* -------------------------------------------------------------------------- *
 * Lua literals.
 * -------------------------------------------------------------------------- */

/** Escapes for characters that cannot appear raw in a quoted Lua string. */
const ESCAPES: Record<string, string> = {
  "\\": "\\\\",
  '"': '\\"',
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
};

/**
 * Quote a string as a Lua literal. Scenario names and dialogue text are user
 * input going straight into Lua source, so this has to hold for anything: a
 * quote or backslash would end the literal, and a raw newline is a syntax error
 * in a short string.
 *
 * Remaining control characters become three-digit `\ddd` escapes. The three
 * digits are not optional padding. `\0` followed by the character `5` would
 * otherwise read back as byte 5.
 *
 * Anything above ASCII is left alone. Lua strings are byte strings and the file
 * is written as UTF-8, so the bytes survive the round trip unchanged, which is
 * what a non-English mission needs.
 */
export function luaString(value: string): string {
  const body = value.replace(
    // biome-ignore lint/suspicious/noControlCharactersInRegex: escaping them is the point
    /[\\"\n\r\t\x00-\x1f\x7f]/g,
    (ch) => ESCAPES[ch] ?? `\\${ch.charCodeAt(0).toString().padStart(3, "0")}`,
  );
  return `"${body}"`;
}

/** Lua's reserved words, which cannot be used as a bare table key. */
const KEYWORDS = new Set([
  "and",
  "break",
  "do",
  "else",
  "elseif",
  "end",
  "false",
  "for",
  "function",
  "if",
  "in",
  "local",
  "nil",
  "not",
  "or",
  "repeat",
  "return",
  "then",
  "true",
  "until",
  "while",
]);

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * A table key. Bare where Lua allows it, bracketed otherwise. Not cosmetic:
 * `repeat` is both a field of a trigger and a Lua keyword, and variable names
 * and game-extension parameter names are author input that can be anything.
 */
function luaKey(key: string): string {
  return IDENTIFIER.test(key) && !KEYWORDS.has(key)
    ? key
    : `[${luaString(key)}]`;
}

/**
 * A number. Non-finite values throw rather than being written out, because
 * `inf` and `nan` are not Lua literals and a mission that silently loses a
 * coordinate is worse than one that refuses to compile. The parser already
 * rejects them, so reaching this means the document bypassed it.
 */
function luaNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`scenario holds a non-finite number: ${value}`);
  }
  return String(value);
}

/* -------------------------------------------------------------------------- *
 * Rendering. An intermediate tree keeps ordering in one place, and a `Map`
 * rather than a plain object because JavaScript hoists integer-like keys, which
 * would reorder a variable named "1".
 * -------------------------------------------------------------------------- */

type LuaTable = Map<string, LuaValue>;
type LuaValue = string | number | boolean | LuaValue[] | LuaTable;

/** Build a table from fixed fields, dropping the ones that are absent. */
function tbl(entries: [string, LuaValue | undefined][]): LuaTable {
  const table: LuaTable = new Map();
  for (const [key, value] of entries) {
    if (value !== undefined) table.set(key, value);
  }
  return table;
}

/** Build a table from an author-keyed record, in sorted key order. */
function sortedTbl<T>(
  record: Record<string, T>,
  render: (value: T) => LuaValue,
): LuaTable {
  const table: LuaTable = new Map();
  for (const key of Object.keys(record).sort()) {
    table.set(key, render(record[key]));
  }
  return table;
}

const isScalar = (v: LuaValue): v is string | number | boolean =>
  typeof v !== "object";

/** Width at which an all-scalar table stays on one line. */
const INLINE_WIDTH = 60;

function render(value: LuaValue, indent: string): string {
  if (typeof value === "string") return luaString(value);
  if (typeof value === "number") return luaNumber(value);
  if (typeof value === "boolean") return String(value);

  const parts = Array.isArray(value)
    ? value.map((item) => render(item, `${indent}  `))
    : [...value].map(
        ([key, item]) => `${luaKey(key)} = ${render(item, `${indent}  `)}`,
      );
  if (parts.length === 0) return "{}";

  // Points, resource pairs and unit counts read far better on one line than as
  // four, so a short all-scalar table stays inline.
  const members = Array.isArray(value) ? value : [...value.values()];
  const inline = `{ ${parts.join(", ")} }`;
  if (members.every(isScalar) && inline.length <= INLINE_WIDTH) return inline;

  return `{\n${parts.map((p) => `${indent}  ${p},`).join("\n")}\n${indent}}`;
}

/* -------------------------------------------------------------------------- *
 * The document, field by field.
 * -------------------------------------------------------------------------- */

const point = (p: { x: number; z: number }): LuaTable =>
  tbl([
    ["x", p.x],
    ["z", p.z],
  ]);

/**
 * The difficulties one placement or trigger applies at, or nothing at all.
 *
 * Nothing at all is what everything already authored emits, which is what keeps
 * this additive: a document that names no range compiles to the bytes it always
 * did, and a runtime that has never heard of difficulty reads a table with no
 * new key in it (issue #2164).
 */
const difficulty = (
  range: DifficultyRange | undefined,
): LuaTable | undefined =>
  range === undefined
    ? undefined
    : tbl([
        ["atLeast", range.atLeast],
        ["atMost", range.atMost],
      ]);

const zone = (z: ScenarioZone): LuaTable =>
  tbl([
    ["id", z.id],
    ["name", z.name],
    ["shape", z.shape],
    ["min", z.shape === "box" ? point(z.min) : undefined],
    ["max", z.shape === "box" ? point(z.max) : undefined],
    ["center", z.shape === "circle" ? point(z.center) : undefined],
    ["radius", z.shape === "circle" ? z.radius : undefined],
  ]);

const order = (o: ScenarioOrder): LuaTable =>
  tbl([
    ["kind", o.kind],
    [
      "waypoints",
      "waypoints" in o ? o.waypoints.map((w) => point(w)) : undefined,
    ],
    ["target", "target" in o ? o.target : undefined],
  ]);

const group = (g: ScenarioGroup): LuaTable =>
  tbl([
    ["id", g.id],
    ["team", g.team],
    [
      "units",
      g.units.map((u) =>
        tbl([
          ["def", u.def],
          ["count", u.count],
        ]),
      ),
    ],
    ["pos", point(g.pos)],
    ["orders", g.orders.map(order)],
    ["dormant", g.dormant],
    ["difficulty", difficulty(g.difficulty)],
  ]);

const objective = (o: ScenarioObjective): LuaTable =>
  tbl([
    ["id", o.id],
    ["kind", o.kind],
    ["text", o.text],
    ["hidden", o.hidden],
  ]);

const dialogue = (d: ScenarioDialogue): LuaTable =>
  tbl([
    ["id", d.id],
    ["speaker", d.speaker],
    ["text", d.text],
    ["portrait", d.portrait],
    ["audio", d.audio],
  ]);

/**
 * A trigger parameter. Known kinds are already the right shape. An unknown
 * type's parameters are whatever JSON the game extension declared, so objects
 * are emitted in sorted key order and arrays keep their order.
 */
function param(value: ScenarioParam): LuaValue {
  if (Array.isArray(value)) return value.map(param);
  if (typeof value === "object") return sortedTbl(value, param);
  return value;
}

const step = (s: TriggerStep): LuaTable =>
  tbl([
    ["type", s.type],
    ["params", sortedTbl(s.params, param)],
    // Only when it is on, so a scenario that negates nothing emits exactly the
    // bytes it always did and a runtime that has never heard of it reads a
    // table with no new key in it.
    ["negate", s.negate === true ? true : undefined],
  ]);

const trigger = (t: ScenarioTrigger): LuaTable =>
  tbl([
    ["id", t.id],
    ["enabled", t.enabled],
    ["repeat", t.repeat],
    ["cooldown", t.cooldown],
    ["difficulty", difficulty(t.difficulty)],
    [
      "conditions",
      tbl([
        ["op", t.conditions.op],
        ["conditions", t.conditions.conditions.map(step)],
      ]),
    ],
    ["actions", t.actions.map(step)],
  ]);

/**
 * Per-team setup, keyed by participant id, with the engine team number the
 * launcher will give that participant.
 *
 * Every participant gets an entry, whether or not the author set anything on
 * it, because the runtime needs the team number to spawn that team's units. An
 * entry with no `team` is left in rather than dropped: it means the id names a
 * spectator or nothing at all, and the validator should say so rather than the
 * mission quietly losing a team.
 */
function teams(scenario: Scenario): LuaTable {
  const raw = (scenario.setup as { participants?: unknown }).participants;
  const participants = (Array.isArray(raw) ? raw : []) as Participant[];
  const { teamIndexById } = effectiveTeams(participants);

  const ids = new Set([
    ...participants.map((p) => p.id),
    ...Object.keys(scenario.teams),
  ]);
  const table: LuaTable = new Map();
  for (const id of [...ids].sort()) {
    const team = scenario.teams[id] ?? {};
    table.set(
      id,
      tbl([
        ["team", teamIndexById.get(id)],
        ["startUnits", team.startUnits],
        [
          "resources",
          team.resources
            ? tbl([
                ["metal", team.resources.metal],
                ["energy", team.resources.energy],
              ])
            : undefined,
        ],
        [
          "income",
          team.income
            ? tbl([
                ["metal", team.income.metal],
                ["energy", team.income.energy],
              ])
            : undefined,
        ],
        ["noCommander", team.noCommander],
      ]),
    );
  }
  return table;
}

function restrictions(scenario: Scenario): LuaTable {
  const { buildable, commands } = scenario.restrictions;
  return tbl([
    [
      "buildable",
      buildable
        ? tbl([
            ["mode", buildable.mode],
            ["units", buildable.units],
          ])
        : undefined,
    ],
    ["commands", commands],
  ]);
}

/** A `setup` string field, when the captured skirmish actually carries one. */
function setupString(value: string): string | undefined {
  return value !== "" ? value : undefined;
}

function mission(scenario: Scenario): LuaTable {
  return tbl([
    ["schemaVersion", MISSION_SCHEMA_VERSION],
    ["runtimeVersion", scenario.runtimeVersion],
    ["id", scenario.id],
    ["name", scenario.name],
    ["description", scenario.description],
    ["game", setupString(scenario.setup.gameName)],
    ["map", setupString(scenario.setup.mapName)],
    ["teams", teams(scenario)],
    ["zones", scenario.zones.map(zone)],
    [
      "actors",
      scenario.actors.map((a) =>
        tbl([
          ["id", a.id],
          ["unitDef", a.unitDef],
          ["team", a.team],
          ["pos", point(a.pos)],
          ["facing", a.facing],
          [
            "state",
            a.state
              ? tbl([
                  ["hp", a.state.hp],
                  ["invulnerable", a.state.invulnerable],
                  ["unselectable", a.state.unselectable],
                  ["name", a.state.name],
                ])
              : undefined,
          ],
          ["difficulty", difficulty(a.difficulty)],
        ]),
      ),
    ],
    ["groups", scenario.groups.map(group)],
    [
      "prefabs",
      scenario.bases.map((p) =>
        tbl([
          ["id", p.id],
          ["team", p.team],
          ["origin", point(p.origin)],
          ["difficulty", difficulty(p.difficulty)],
          [
            "buildings",
            baseBuildings(scenario.blueprints, p).map((b) =>
              tbl([
                ["id", b.id],
                ["def", b.def],
                ["offset", point(b.offset)],
                ["facing", b.facing],
                ["queue", b.queue],
                ["repeat", b.repeat],
              ]),
            ),
          ],
        ]),
      ),
    ],
    ["restrictions", restrictions(scenario)],
    ["vars", sortedTbl(scenario.vars, (v) => v)],
    ["triggers", scenario.triggers.map(trigger)],
    ["objectives", scenario.objectives.map(objective)],
    ["dialogue", scenario.dialogue.map(dialogue)],
    ["script", scenario.script],
  ]);
}

/**
 * Compile a scenario to the contents of its `mission.lua`.
 *
 * The header carries no author text. A newline in a scenario name would end a
 * `--` comment and turn the rest of the line into code, and a comment is not
 * worth an injection route.
 */
export function compileScenario(scenario: Scenario): string {
  return [
    "-- Compiled by coilbox from a scenario document.",
    "-- Do not edit: change the scenario and compile again.",
    `return ${render(mission(scenario), "")}`,
    "",
  ].join("\n");
}

/** Turn a Lua value tree into plain JSON-safe JS: a `Map` becomes an object, an
 * array stays an array, everything else is already a scalar. */
function toJson(value: LuaValue): unknown {
  if (Array.isArray(value)) return value.map(toJson);
  if (value instanceof Map) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of value) out[key] = toJson(item);
    return out;
  }
  return value;
}

/**
 * The shape `validateMission` expects: what a real Lua evaluation of
 * `compileScenario`'s output would hand back, without needing a Lua VM. Built
 * from the exact same {@link mission} field mapping `compileScenario` renders
 * to text, so it cannot structurally disagree with what gets written to disk.
 * Only `render`'s text-encoding step is skipped.
 */
export function scenarioMissionValue(scenario: Scenario): unknown {
  return toJson(mission(scenario));
}
