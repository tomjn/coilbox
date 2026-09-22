/**
 * A Lua unit script gets its call-ins by exact name, so a definition that is
 * close but not exact never runs, and nothing says so at load: the script
 * loads fine and the call-in its author meant simply never fires.
 *
 * Two ways that happens in practice, and the two this checks for: a name that
 * differs from the engine's only in case, and a COB-style numbered weapon name
 * such as `AimWeapon1`, which is how the compiled script named a weapon's own
 * instance and has no meaning to a Lua one. A Lua script gets one
 * `script.AimWeapon`, with the weapon number as its own first argument.
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

/** The call-ins a `.cob` numbers per weapon, which a Lua one never does: it
 *  gets one call-in per name, and the weapon number arrives as an argument
 *  instead. `AimShield` is left out: a unit has one shield, so nothing in the
 *  engine or a real game numbers it. */
const NUMBERED_IN_COB = [
  "QueryWeapon",
  "AimWeapon",
  "AimFromWeapon",
  "FireWeapon",
  "EndBurst",
  "Shot",
  "BlockShot",
  "TargetWeight",
];

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
 * the wrong case, or a COB-style number the engine never reads off a Lua one.
 *
 * Says nothing about a name that matches nothing at all: that is either a
 * script's own helper or a call-in this list does not know, and guessing
 * which would be worse than staying quiet.
 */
export function lintLuaCallins(lua: string): CallinLintProblem[] {
  const problems: CallinLintProblem[] = [];

  for (const { name, line } of definitions(lua)) {
    if (ENGINE_CALLINS.includes(name)) continue;

    const numbered = name.match(/^(.*?)(\d+)$/);
    const numberedBase = numbered
      ? NUMBERED_IN_COB.find(
          (callin) => callin.toLowerCase() === numbered[1].toLowerCase(),
        )
      : undefined;
    if (numberedBase) {
      problems.push({
        line,
        severity: "warning",
        message: `A Lua unit script gets one \`script.${numberedBase}\` with the weapon number as its first argument. \`${name}\` is never called.`,
      });
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
