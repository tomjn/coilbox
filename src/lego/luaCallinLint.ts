/**
 * A Lua unit script gets its call-ins by exact name, so a definition that is
 * close but not exact never runs, and nothing says so at load: the script
 * loads fine and the call-in its author meant simply never fires.
 *
 * Two ways that happens in practice, and the two this checks for: a name that
 * differs from the engine's only in case, and a numbered weapon call-in on a
 * script that has no `AimWeapon1`.
 *
 * The numbered rule needs the reason spelled out, because the engine and the
 * framework above it disagree and only one of them is the whole story. The
 * engine calls one `script.AimWeapon(weaponNum, heading, pitch)`
 * (`LuaUnitScript.cpp`), which on its own would make `AimWeapon1` dead. But
 * every game using Lua unit scripts loads springcontent's `unit_script.lua`,
 * and that builds a dispatcher over `AimWeapon1..N` and installs it as
 * `AimWeapon` for the engine to find. So numbered names are a real and
 * supported convention.
 *
 * The catch is the condition it does that under: only when `AimWeapon` is
 * absent and `AimWeapon1` is present (or the same pair for `AimShield`). A
 * script with `QueryWeapon1` and no `AimWeapon1` gets no dispatcher for any of
 * them, and every numbered call-in on it is dead. That is the case worth
 * warning about, and `coilbox-bos2lua`'s `emit.rs` already warns about it on
 * the conversion side.
 *
 * The engine's own names, from `rts/Sim/Units/Scripts/LuaScriptNames.cpp`.
 * `Create` is the one exception: it is not in that array at all.
 * `CLuaUnitScript::Create()` is a hardcoded no-op ("Lua code can just call it
 * after Spring.UnitScript.CreateScript(...)"), so the call is a convention the
 * unit script framework makes itself rather than a name the engine dispatches
 * by. It is kept in this list because that convention is what real games and
 * this app's own preview both rely on, and a script defining it is not wrong
 * to.
 */

const ENGINE_CALLINS = [
  "Create",
  "Destroy",
  "StartMoving",
  "StopMoving",
  "StartSkidding",
  "StopSkidding",
  "ChangeHeading",
  "Activate",
  "Killed",
  "Deactivate",
  "WindChanged",
  "ExtractionRateChanged",
  "RockUnit",
  "MoveRate",
  "setSFXoccupy",
  "HitByWeapon",
  "QueryLandingPads",
  "Falling",
  "Landed",
  "BeginTransport",
  "QueryTransport",
  "TransportPickup",
  "StartUnload",
  "EndTransport",
  "TransportDrop",
  "StartBuilding",
  "StopBuilding",
  "QueryNanoPiece",
  "QueryBuildInfo",
  "MoveFinished",
  "TurnFinished",
  "ScaleFinished",
  "QueryWeapon",
  "AimWeapon",
  "AimShield",
  "AimFromWeapon",
  "FireWeapon",
  "EndBurst",
  "Shot",
  "BlockShot",
  "TargetWeight",
];

/** The call-ins `unit_script.lua` will dispatch per weapon, its own
 *  `weapon_funcs` list verbatim. */
const NUMBERED_PER_WEAPON = [
  "QueryWeapon",
  "AimFromWeapon",
  "AimWeapon",
  "AimShield",
  "FireWeapon",
  "Shot",
  "EndBurst",
  "BlockShot",
  "TargetWeight",
];

/** The two names that switch that dispatch on, checked in the framework as
 *  `(not callins.AimWeapon and callins.AimWeapon1) or (not callins.AimShield
 *  and callins.AimShield1)`. Without one of them nothing numbered is read. */
const DISPATCH_KEYS = ["AimWeapon1", "AimShield1"];

export interface CallinLintProblem {
  /** 1-indexed, matching where the definition's line sits in the script. */
  line: number;
  severity: "warning";
  message: string;
}

/** Every `script.Name = ...` or `function script.Name(...)` definition, with
 *  its 1-indexed line. A script's own function, called only from inside the
 *  script, matches neither pattern and is rightly none of this lint's
 *  business. */
function definitions(lua: string): { name: string; line: number }[] {
  const found: { name: string; line: number }[] = [];
  const asFunction = /function\s+script\.([A-Za-z_]\w*)\s*\(/;
  // Not `==`: a comparison against a call-in is reading it, not defining it.
  const asAssignment = /script\.([A-Za-z_]\w*)\s*=(?!=)/;
  lua.split("\n").forEach((text, index) => {
    const match = asFunction.exec(text) ?? asAssignment.exec(text);
    if (match) found.push({ name: match[1], line: index + 1 });
  });
  return found;
}

/**
 * Lint a Lua unit script's own call-in definitions against the engine's real
 * names, and warn about the two ways a definition can be wrong and silent:
 * the wrong case, or a numbered weapon call-in on a script that never turns
 * the framework's per-weapon dispatch on.
 *
 * Says nothing about a name that matches nothing at all: that is either a
 * script's own helper or a call-in this list does not know, and guessing
 * which would be worse than staying quiet.
 */
export function lintLuaCallins(lua: string): CallinLintProblem[] {
  const problems: CallinLintProblem[] = [];
  const defined = definitions(lua);
  const names = new Set(defined.map((entry) => entry.name));
  const dispatches = DISPATCH_KEYS.some((key) => names.has(key));

  for (const { name, line } of defined) {
    if (ENGINE_CALLINS.includes(name)) continue;

    const numbered = name.match(/^(.*?)(\d+)$/);
    const numberedBase = numbered
      ? NUMBERED_PER_WEAPON.find(
          (callin) => callin.toLowerCase() === numbered[1].toLowerCase(),
        )
      : undefined;
    if (numberedBase) {
      // The dispatch is all or nothing across every numbered name, so one
      // script either reads them all or reads none of them.
      if (!dispatches) {
        problems.push({
          line,
          severity: "warning",
          message: `\`unit_script.lua\` only reads numbered weapon call-ins when the script defines \`AimWeapon1\` or \`AimShield1\`, and this one defines neither, so \`${name}\` is never called.`,
        });
      }
      continue;
    }

    const nearMiss = ENGINE_CALLINS.find(
      (callin) => callin.toLowerCase() === name.toLowerCase(),
    );
    if (nearMiss) {
      problems.push({
        line,
        severity: "warning",
        message: `The engine calls \`script.${nearMiss}\`, not \`script.${name}\`, so this never runs.`,
      });
    }
  }

  return problems;
}
