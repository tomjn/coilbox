/**
 * The roles a lifted piece brings with it (issue #3270).
 *
 * A turret lifted from a game is more than a mesh: it turns, and its barrel
 * recoils. Roles are what the animation presets read, so a lifted module that
 * carries them can be driven in the unit it is dropped into without a line of
 * the game's script.
 *
 * Two sources, in this order.
 *
 * 1. The game's script. `inferRoles` asks it what its pieces are for, and its
 *    answers are used as they stand.
 * 2. Piece names, for a piece the script said nothing about: a compiled script
 *    with no source, a unit with no script, or a weapon the script does not
 *    reach. Only a few plain names count, and a name is not used for a role the
 *    script has already given to another piece.
 *
 * Roles only ever travel with a piece into a unit for its own game, which the
 * lift refusal (#3263) already enforces. The game's script text is never
 * copied.
 */

import {
  type AppliedPreset,
  countRoles,
  isRole,
  presetById,
  roleLabel,
  unmetRequirements,
} from "./animPresets";
import type { RoleProposal } from "./inferRoles";
import type { LegoProject } from "./model";

/** Roles a unit has one piece for, which a name alone must not hand out twice. */
const NAMED_ONCE: [RegExp, string][] = [
  [/^turret$/, "turret"],
  [/^barrel$/, "barrel"],
  [/^(flare|muzzle)$/, "flare"],
  [/^aim(point)?$/, "aim"],
];

/** A role any number of pieces can share. */
const NAMED_MANY: [RegExp, string][] = [[/^wheel\d*$/, "wheel"]];

/**
 * The presets a lifted turret comes with: the ones the generated weapon module
 * applies, kept only where the module has the roles they need. The module's
 * presets merge into a unit by the rules of #3296.
 */
const LIFT_PRESETS = ["turret.track", "recoil"];

/**
 * The module with roles on its pieces and the presets those roles run.
 *
 * A role a piece already has is kept. A proposal naming a piece the module does
 * not hold, or a role the builder does not know, is dropped.
 */
export function withLiftedRoles(
  module: LegoProject,
  proposals: RoleProposal[],
): LegoProject {
  const byName = new Map<string, string>();
  for (const { pieceName, role } of proposals) {
    if (isRole(role) && !byName.has(pieceName)) byName.set(pieceName, role);
  }
  const scripted = new Set(byName.values());

  const named = namedRoles(
    module.pieces.filter((piece) => !piece.role && !byName.has(piece.name)),
    scripted,
  );

  const pieces = module.pieces.map((piece) => {
    if (piece.role) return piece;
    const role = byName.get(piece.name) ?? named.get(piece.id);
    return role ? { ...piece, role } : piece;
  });

  const counts = countRoles(pieces);
  const animations: AppliedPreset[] = [...(module.animations ?? [])];
  for (const presetId of LIFT_PRESETS) {
    const preset = presetById(presetId);
    if (!preset || animations.some((a) => a.presetId === presetId)) continue;
    if (unmetRequirements(preset, counts).length > 0) continue;
    animations.push({ presetId, params: {} });
  }

  return {
    ...module,
    pieces,
    ...(animations.length > 0 ? { animations } : {}),
  };
}

/** Piece id to the role its name suggests, for the pieces handed in. */
function namedRoles(
  pieces: { id: string; name: string }[],
  taken: Set<string>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [pattern, role] of NAMED_ONCE) {
    if (taken.has(role)) continue;
    const matches = pieces.filter((piece) =>
      pattern.test(piece.name.toLowerCase()),
    );
    if (matches.length === 1) out.set(matches[0].id, role);
  }
  for (const [pattern, role] of NAMED_MANY) {
    if (taken.has(role)) continue;
    for (const piece of pieces) {
      if (pattern.test(piece.name.toLowerCase())) out.set(piece.id, role);
    }
  }
  return out;
}

/** The roles on a module, by label and once each, or null when it has none. */
export function liftedRolesSummary(module: LegoProject): string | null {
  const roles = [
    ...new Set(
      module.pieces.flatMap((piece) => (piece.role ? [piece.role] : [])),
    ),
  ];
  return roles.length > 0 ? roles.map(roleLabel).join(", ") : null;
}
