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
  type EmitInstance,
  type EmitResult,
  type EmitWheel,
  type LuaHook,
  presetById,
} from "./animPresets";
import { driveMotion, rates } from "./drive";
import type { LegoPiece, LegoProject } from "./model";
import {
  hasPieceCollision,
  pieceCollisionInclude,
} from "./pieceCollisionScript";
import { luaString } from "./unitDef";
import { fittedParams } from "./walkFit";
import { scriptWeapons } from "./weaponModule";
import { frontWheels, wheelRadius } from "./wheelFit";

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
 * The callins, in the order they are written, with one set of weapon
 * call-ins for each of `weapons`.
 *
 * `Killed` is deliberately not here: it always explodes the root piece and
 * returns 1 regardless of what is applied, so it keeps its own hardcoded
 * block below. A preset can still contribute to it through `hooks`, same as
 * any other callin, that block just reads the map directly instead of going
 * through this list.
 */
function hookList(weapons: number): { hook: LuaHook; signature: string }[] {
  return [
    { hook: "Create", signature: "script.Create()" },
    { hook: "StartMoving", signature: "script.StartMoving()" },
    { hook: "StopMoving", signature: "script.StopMoving()" },
    { hook: "Activate", signature: "script.Activate()" },
    { hook: "Deactivate", signature: "script.Deactivate()" },
    // Weapon 1's are written even on a unit with no weapon, because the unit
    // script gadget only dispatches numbered weapon call-ins at all once
    // `AimWeapon1` is defined (`luaCallinLint.ts`).
    ...Array.from({ length: Math.max(1, weapons) }, (_, index) => index + 1)
      .flatMap((n) => [
        [`AimWeapon${n}`, "(heading, pitch)"] as const,
        [`AimFromWeapon${n}`, "()"] as const,
        [`QueryWeapon${n}`, "()"] as const,
        [`Shot${n}`, "()"] as const,
      ])
      .map(([hook, args]) => ({ hook, signature: `script.${hook}${args}` })),
    // One name, two shapes. A builder is handed a heading and a pitch worked
    // out from its build target, a factory is handed nothing at all, and the
    // engine calls the same function either way (`LuaScriptNames.h`,
    // `Builder.cpp` and `Factory.cpp`). Anything reading the arguments has to
    // check it got them.
    {
      hook: "StartBuilding",
      signature: "script.StartBuilding(heading, pitch)",
    },
    { hook: "StopBuilding", signature: "script.StopBuilding()" },
    { hook: "QueryNanoPiece", signature: "script.QueryNanoPiece()" },
  ];
}

/** What a callin returns when no preset has anything to say. An aim that
 *  never answers would leave its weapon unable to fire. */
function hookFallback(hook: LuaHook): string[] {
  return /^AimWeapon\d+$/.test(hook) ? ["  return true"] : [];
}

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

/** The roles a preset animates or needs, which its instances are made of. */
export function presetRoles(preset: AnimPreset): string[] {
  return [...preset.animates, ...preset.requires.map((need) => need.role)];
}

/**
 * The pieces carrying any of `roles`, grouped by the module instance they came
 * in (#3302), each group in document order and the groups in the order their
 * first piece appears. Pieces from no module share one group, so a unit with
 * no modules gets one group holding every piece, which is what the presets
 * were handed before instances existed.
 */
export function roleInstances(
  pieces: LegoPiece[],
  roles: string[],
): LegoPiece[][] {
  return roleInstanceGroups(pieces, roles).map((group) => group.pieces);
}

/** `roleInstances` with each group's instance id, "" for the group of pieces
 *  that came from no module. */
export function roleInstanceGroups(
  pieces: LegoPiece[],
  roles: string[],
): { id: string; pieces: LegoPiece[] }[] {
  const wanted = new Set(roles);
  const groups = new Map<string, LegoPiece[]>();
  for (const piece of pieces) {
    if (!piece.role || !wanted.has(piece.role)) continue;
    const key = piece.module?.instance ?? "";
    groups.set(key, [...(groups.get(key) ?? []), piece]);
  }
  return [...groups].map(([id, group]) => ({ id, pieces: group }));
}

/** Whether a group of pieces is one copy of the preset: it holds the role one
 *  copy cannot do without, or any role the preset animates. */
function isCopy(preset: AnimPreset, group: LegoPiece[]): boolean {
  const role = preset.copies?.role;
  return group.some((piece) =>
    role ? piece.role === role : preset.animates.includes(piece.role ?? ""),
  );
}

/**
 * The module instances a preset is written once for, by id and in the order
 * the script numbers them. Empty for a preset that is not written per instance.
 * For the Animation panel's instance picker (#4315).
 */
export function presetInstanceIds(
  project: LegoProject,
  preset: AnimPreset,
): string[] {
  if (preset.copies?.per !== "instance") return [];
  return roleInstanceGroups(project.pieces, presetRoles(preset))
    .filter((group) => isCopy(preset, group.pieces))
    .map((group) => group.id);
}

/**
 * How many times a preset is written into this unit's script: once per weapon
 * or once per module instance, for a preset that can be (`copies`), and once
 * otherwise. For the Animation panel, which names them.
 */
export function presetCopies(project: LegoProject, preset: AnimPreset): number {
  const copies = preset.copies;
  if (!copies) return 1;
  const role = copies.role;
  if (copies.per === "weapon") {
    return scriptWeapons(project).filter((weapon) =>
      role === "barrel" || role === "flare"
        ? weapon[role] !== null
        : weapon.carrier?.role === role,
    ).length;
  }
  return roleInstances(project.pieces, presetRoles(preset)).filter((group) =>
    isCopy(preset, group),
  ).length;
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
      instances: entry.instances,
    }))
    .filter(
      (
        entry,
      ): entry is {
        preset: AnimPreset;
        params: Record<string, number>;
        instances: Record<string, Record<string, number>> | undefined;
      } => entry.preset !== undefined,
    );

  const weapons = scriptWeapons(project);
  const motion = rates(driveMotion(project).motion);
  const use = (piece: LegoPiece | null | undefined) => {
    if (!piece) return undefined;
    used.add(piece.name);
    return localName(piece.name);
  };

  applied.forEach(({ preset, params: saved, instances: own }, index) => {
    // A walk is fitted to the unit's legs and speed here, beneath the game
    // maker's own numbers (`walkFit.ts`). Every other preset is as saved.
    const params = fittedParams(project, preset.id, saved);
    const signal = `SIG_${preset.id.replace(/[^a-z0-9]+/gi, "_").toUpperCase()}`;
    let presetSignal = false;
    // The signals named after the preset's, one per weapon or per instance.
    const namedSignals = new Set<string>();
    const named = (n: number) => {
      const name = `${signal}_${n}`;
      namedSignals.add(name);
      return name;
    };
    const result: EmitResult | null = preset.emit({
      params,
      get signal() {
        presetSignal = true;
        return signal;
      },
      pieces(role) {
        const names = byRole.get(role) ?? [];
        for (const name of names) used.add(name);
        return names.map(localName);
      },
      motion,
      wheels: (): EmitWheel[] => {
        const front = new Set(frontWheels(project));
        return project.pieces
          .filter((piece) => piece.role === "wheel")
          .map((piece) => ({
            // Named only when a preset uses it, so a rear wheel the steering
            // leaves alone does not get a local of its own.
            get piece() {
              used.add(piece.name);
              return localName(piece.name);
            },
            radius: wheelRadius(project, piece.name),
            front: front.has(piece.name),
          }));
      },
      weapons: () =>
        weapons.map((weapon, slot) => ({
          number: slot + 1,
          piece(role) {
            if (role === "barrel" || role === "flare") return use(weapon[role]);
            return weapon.carrier?.role === role
              ? use(weapon.carrier)
              : undefined;
          },
          get signal() {
            return named(slot + 1);
          },
        })),
      instances: () =>
        roleInstanceGroups(project.pieces, presetRoles(preset)).map(
          (group, index): EmitInstance => ({
            id: group.id,
            params: own?.[group.id]
              ? fittedParams(project, preset.id, {
                  ...saved,
                  ...own[group.id],
                })
              : params,
            number: index + 1,
            pieces(role) {
              const names = group.pieces
                .filter((piece) => piece.role === role)
                .map((piece) => piece.name);
              for (const name of names) used.add(name);
              return names.map(localName);
            },
            get signal() {
              if (index > 0) return named(index + 1);
              presetSignal = true;
              return signal;
            },
            name: (base) => (index === 0 ? base : `${base}${index + 1}`),
          }),
        ),
    });
    if (!result) return;

    if (presetSignal) signals.push(`local ${signal} = ${1 << index}`);
    // A string rather than a bit. Spring's bit operations keep 24 bits
    // (`EXACT_INTEGER_MASK` in `rts/Lua/LuaMathExtra.cpp`), too few for a bit
    // per weapon per preset on a unit with many weapons. The gadget's `Signal`
    // matches a mask that is not a number by equality (`unit_script.lua`).
    for (const name of namedSignals) {
      signals.push(`local ${name} = ${luaString(name)}`);
    }
    if (result.functions.length > 0) {
      functions.push(`-- ${preset.label}`, ...result.functions, "");
    }
    for (const [hook, lines] of Object.entries(result.hooks)) {
      hooks.set(hook as LuaHook, [
        ...(hooks.get(hook as LuaHook) ?? []),
        ...(lines ?? []),
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
    "-- Safe to edit: once you change this file, an export leaves it alone.",
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

  for (const { hook, signature } of hookList(weapons.length)) {
    const fallback =
      hook === "QueryNanoPiece" ? nanoFallback : hookFallback(hook);
    const preset = hooks.get(hook) ?? fallback;
    const stance = BUILD_STANCE[hook];
    const lines = [
      ...(stance?.before ? [stance.before] : []),
      ...preset,
      ...(stance?.after ? [stance.after] : []),
    ];
    // The engine hands `StartMoving` whether the unit is reversing, but it is
    // only named where a preset reads it, so a unit without one writes the
    // script it always did.
    const named =
      hook === "StartMoving" && lines.some((line) => /\breversing\b/.test(line))
        ? "script.StartMoving(reversing)"
        : signature;
    out.push(`function ${named}`, ...lines, "end", "");
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
