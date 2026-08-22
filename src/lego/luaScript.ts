/**
 * Generate a Recoil unit script for a built unit.
 *
 * Lua, not BOS. The full set of callins is always written, even with no
 * animation applied, so an early export already loads and runs rather than
 * erroring on a missing hook.
 *
 * Only pieces the script actually references get a local, so a sixty piece
 * unit does not open with sixty declarations. Piece names come from the
 * document, where they are already lower case and identifier-safe.
 */

import {
  type AnimPreset,
  type EmitResult,
  type LuaHook,
  presetById,
} from "./animPresets";
import type { LegoProject } from "./model";
import {
  hasPieceCollision,
  pieceCollisionInclude,
} from "./pieceCollisionScript";
import { luaString } from "./unitDef";

/**
 * Lua's reserved words. A piece called `end` is a legal piece name and an
 * illegal local, so those get a prefix while the piece keeps its real name.
 *
 * Exported so other Lua-emitting code, such as a future script editor, can
 * apply the same rule.
 */
export const RESERVED = new Set([
  "and",
  "break",
  "do",
  "else",
  "elseif",
  "end",
  "false",
  "for",
  "function",
  "goto",
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

export function localName(piece: string): string {
  return RESERVED.has(piece) ? `p_${piece}` : piece;
}

/**
 * The callins, in the order they are written.
 *
 * `Killed` is deliberately not here: it always explodes the root piece and
 * returns 1 regardless of what is applied, so it keeps its own hardcoded
 * block below. A preset can still contribute to it through `hooks`, same as
 * any other callin, that block just reads the map directly instead of going
 * through this list.
 */
const HOOKS: { hook: LuaHook; signature: string }[] = [
  { hook: "Create", signature: "script.Create()" },
  { hook: "StartMoving", signature: "script.StartMoving()" },
  { hook: "StopMoving", signature: "script.StopMoving()" },
  { hook: "Activate", signature: "script.Activate()" },
  { hook: "Deactivate", signature: "script.Deactivate()" },
  { hook: "AimWeapon1", signature: "script.AimWeapon1(heading, pitch)" },
  { hook: "AimFromWeapon1", signature: "script.AimFromWeapon1()" },
  { hook: "QueryWeapon1", signature: "script.QueryWeapon1()" },
  { hook: "Shot1", signature: "script.Shot1()" },
  // One name, two shapes. A builder is handed a heading and a pitch worked out
  // from its build target, a factory is handed nothing at all, and the engine
  // calls the same function either way (`LuaScriptNames.h`, `Builder.cpp` and
  // `Factory.cpp`). Anything reading the arguments has to check it got them.
  { hook: "StartBuilding", signature: "script.StartBuilding(heading, pitch)" },
  { hook: "StopBuilding", signature: "script.StopBuilding()" },
  { hook: "QueryNanoPiece", signature: "script.QueryNanoPiece()" },
];

/** What a callin returns when no preset has anything to say. */
const HOOK_FALLBACK: Partial<Record<LuaHook, string[]>> = {
  AimWeapon1: ["  return true"],
};

/**
 * The line that lets a builder build at all, and where it goes.
 *
 * `CBuilder::StartBuild` refuses to start until the unit is in build stance,
 * and the only thing in the whole engine that ever sets that is a script
 * calling this: `UnitScript.cpp` writes `unit->inBuildStance` from
 * `SetUnitValue(INBUILDSTANCE, ...)` and nothing else does, while `Unit.h`
 * starts it false. A builder whose script never says this queues a build and
 * waits forever, with no error and nothing in the infolog.
 *
 * So it is not a preset. It is written for every unit the way `Killed`'s
 * explode line is, because a unit can be a builder in its definition without
 * having a build arm modelled, and gating it on a role would leave that unit
 * broken in exactly the way this exists to prevent.
 *
 * Position matters. Setting stance runs after whatever a preset put in
 * `StartBuilding`, so an aim preset's `WaitForTurn` has finished and the unit
 * only claims to be in stance once its arm is actually pointing. Clearing it
 * runs before anything in `StopBuilding`, so the unit stops building at once
 * rather than after its arm has finished swinging home.
 */
const BUILD_STANCE: Partial<
  Record<LuaHook, { before?: string; after?: string }>
> = {
  StartBuilding: { after: "  SetUnitValue(COB.INBUILDSTANCE, 1)" },
  StopBuilding: { before: "  SetUnitValue(COB.INBUILDSTANCE, 0)" },
};

/**
 * The script this unit is: its own once the user has taken it over, the one
 * the presets generate until then.
 *
 * Everything that shows or writes a unit script goes through here, so taking
 * ownership changes what the drawer shows, what a test run installs and what
 * an export writes, all at once.
 */
export function unitScript(project: LegoProject): string {
  return project.script ?? buildLuaScript(project);
}

export function buildLuaScript(project: LegoProject): string {
  const used = new Set<string>();
  const byRole = new Map<string, string[]>();
  for (const piece of project.pieces) {
    if (!piece.role) continue;
    byRole.set(piece.role, [...(byRole.get(piece.role) ?? []), piece.name]);
  }

  const functions: string[] = [];
  const hooks = new Map<LuaHook, string[]>();
  const signals: string[] = [];

  const applied = (project.animations ?? [])
    .map((entry) => ({
      preset: presetById(entry.presetId),
      params: entry.params,
    }))
    .filter(
      (
        entry,
      ): entry is { preset: AnimPreset; params: Record<string, number> } =>
        entry.preset !== undefined,
    );

  applied.forEach(({ preset, params }, index) => {
    const signal = `SIG_${preset.id.replace(/[^a-z0-9]+/gi, "_").toUpperCase()}`;
    const result: EmitResult | null = preset.emit({
      params,
      signal,
      pieces(role) {
        const names = byRole.get(role) ?? [];
        for (const name of names) used.add(name);
        return names.map(localName);
      },
    });
    if (!result) return;

    signals.push(`local ${signal} = ${1 << index}`);
    if (result.functions.length > 0) {
      functions.push(`-- ${preset.label}`, ...result.functions, "");
    }
    for (const [hook, lines] of Object.entries(result.hooks)) {
      hooks.set(hook as LuaHook, [
        ...(hooks.get(hook as LuaHook) ?? []),
        ...lines,
      ]);
    }
  });

  const root = project.pieces.find(
    (piece) => piece.id === project.rootPieceId,
  )?.name;
  if (root) used.add(root);

  const declared = project.pieces
    .filter((piece) => used.has(piece.name))
    .map((piece) => piece.name);

  const out: string[] = [
    `-- ${project.unitName}, generated by coilbox's unit builder.`,
    "-- Safe to edit: an export never overwrites this file once it exists.",
    "",
    // The one line that reaches coilbox's own generated file. Kept here rather
    // than in a callin because the script chunk runs once per unit inside
    // CallAsUnitNoReturn, so unitID and piece() are already in scope, and
    // because a line at the top of the file is the least likely thing an
    // edited script loses. Everything behind it can change without this line
    // changing, which is the whole point: an export rewrites that file and
    // never rewrites this one. See `pieceCollisionScript.ts`.
    ...(hasPieceCollision(project)
      ? [
          "-- The collision volumes set on this unit's pieces in coilbox.",
          pieceCollisionInclude(project.unitName),
          "",
        ]
      : []),
    ...declared.map(
      (piece) => `local ${localName(piece)} = piece(${luaString(piece)})`,
    ),
    ...(declared.length > 0 ? [""] : []),
    ...signals,
    ...(signals.length > 0 ? [""] : []),
    ...functions,
  ];

  // `QueryNanoPiece` has to hand back a piece whichever way it is asked, and
  // the honest answer with none marked is the root: that is where the engine
  // puts the spray with no script at all. Not in `HOOK_FALLBACK` because the
  // root's local name is only known once the document has been read.
  const nanoFallback = root ? [`  return ${localName(root)}`] : [];

  for (const { hook, signature } of HOOKS) {
    const fallback =
      hook === "QueryNanoPiece" ? nanoFallback : (HOOK_FALLBACK[hook] ?? []);
    const preset = hooks.get(hook) ?? fallback;
    const stance = BUILD_STANCE[hook];
    const lines = [
      ...(stance?.before ? [stance.before] : []),
      ...preset,
      ...(stance?.after ? [stance.after] : []),
    ];
    out.push(`function ${signature}`, ...lines, "end", "");
  }

  out.push(
    "function script.Killed(recentDamage, maxHealth)",
    ...(hooks.get("Killed") ?? []),
    ...(root ? [`  Explode(${localName(root)}, SFX.SHATTER)`] : []),
    "  return 1",
    "end",
    "",
  );

  // One trailing newline, and no runs of blank lines from empty sections.
  return `${out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`;
}
