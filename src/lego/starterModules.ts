/**
 * The modules that ship with the app (issue #3299).
 *
 * A game maker opening the module list on a fresh install finds these there:
 * a wheel, an axle with two wheels, a turret, a leg and a pair of legs, a build
 * arm and three chassis sections. Each is an ordinary module document with its
 * roles, presets, joins, mount, category and tags set, so it works as soon as it
 * is dropped in.
 *
 * They are built here from the loaded parts library rather than read from
 * files. The turret and the build arm then come from `buildWeaponModule` and
 * `buildArmModule`, so they are always what the Weapon and Build arm buttons
 * insert. The rest name parts of the bundled pack by id, and a part id is a
 * content hash, so it survives a rebuild of the pack. A module whose parts the
 * library does not have is left out.
 *
 * Everything in a built in module is fixed, ids and dates included, so it is
 * the same document on every run and a unit that remembers which module a piece
 * came from still finds it after an update. None is ever written to disk. They
 * cannot be renamed, relabelled or deleted, and saving a change to one saves the
 * user's own copy instead (`ownCopy`).
 */

import { buildArmModule, pickArmParts } from "./buildArm";
import { resolveConnections } from "./connectors";
import {
  LEGO_SCHEMA_VERSION,
  type LegoConnection,
  type LegoMount,
  type LegoPiece,
  type LegoProject,
  normalisePieceName,
} from "./model";
import type { LoadedPack } from "./pack";
import { buildWeaponModule, pickWeaponParts } from "./weaponModule";

/** Every built in module's id starts with this. A saved module's is a UUID. */
const BUILT_IN_PREFIX = "builtin.";

/** The date every built in module carries, so its document never changes. */
const AUTHORED = "2026-10-17T00:00:00.000Z";

/** Bundled parts, by id. Each is described by its size in part units. */
const PART = {
  /** 2 across, 1.3 thick, twelve sided about x with a hub on one face. */
  wheel: "2c9119b8312f",
  /** 2 along x, 0.75 square. The axle and the hip. */
  bar: "97fc84ab6a31",
  /** 2.5 along y, 0.73 round. */
  thigh: "3eb13d949664",
  /** 2.5 along y, 0.5 round. */
  shin: "69dcd2a809e1",
  /** 1.5 square, 0.5 high. */
  foot: "ef440930cc49",
  /** 2 wide, 1 high, 3 long. */
  hull: "d2c111537495",
  /** 2.5 wide, 0.5 high, 4 long. */
  deck: "588fc761d4df",
};

export function isBuiltInModule(module: Pick<LegoProject, "id">): boolean {
  return module.id.startsWith(BUILT_IN_PREFIX);
}

/** What one module is made of, before it is a document. */
interface Recipe {
  key: string;
  name: string;
  category: string;
  tags: string[];
  presets: string[];
  /** The pieces, root first. Null when the library lacks a part. */
  pieces: (id: (n: number) => string) => LegoPiece[] | null;
  /** Which piece, by its place in `pieces`, and which of its connectors. */
  mount: { piece: number; connector: string };
}

/** A piece of a recipe, at the origin unless it is joined. */
function piece(
  id: string,
  name: string,
  partId: string,
  fields: Partial<LegoPiece> = {},
): LegoPiece {
  return {
    id,
    name,
    parentId: null,
    partId,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    ...fields,
  };
}

function joined(
  parentId: string,
  connector: string,
  to: string,
): { parentId: string; connection: LegoConnection } {
  return { parentId, connection: { connector, to } };
}

/**
 * A leg hanging from the top of its thigh, the joint the walk turns it about.
 * Each segment's origin is its top face, so the knee and the ankle turn at the
 * joint too. `side` is the role's side, `l` or `r`.
 */
function leg(
  pack: LoadedPack,
  side: "l" | "r",
  ids: { thigh: string; shin: string; foot: string },
  thigh: Partial<LegoPiece>,
): LegoPiece[] {
  const top = (partId: string): [number, number, number] => [
    0,
    pack.byId.get(partId)?.bbox.max[1] ?? 0,
    0,
  ];
  const role = (segment: string) => `leg.${side}1.${segment}`;
  return [
    piece(ids.thigh, `${side}thigh`, PART.thigh, {
      role: role("thigh"),
      pivot: top(PART.thigh),
      ...thigh,
    }),
    piece(ids.shin, `${side}shin`, PART.shin, {
      role: role("shin"),
      pivot: top(PART.shin),
      ...joined(ids.thigh, "+y", "-y"),
    }),
    piece(ids.foot, `${side}foot`, PART.foot, {
      role: role("foot"),
      pivot: top(PART.foot),
      ...joined(ids.shin, "+y", "-y"),
    }),
  ];
}

/** Pieces from fixed parts, or null when the library lacks one. */
function fixed(pack: LoadedPack, pieces: LegoPiece[]): LegoPiece[] | null {
  return pieces.every((p) => !p.partId || pack.byId.has(p.partId))
    ? pieces
    : null;
}

function recipes(pack: LoadedPack): Recipe[] {
  const weapon = pickWeaponParts(pack.parts);
  const arm = pickArmParts(pack.parts);
  return [
    {
      key: "wheel",
      name: "Wheel",
      category: "Wheel",
      tags: ["wheel", "vehicle", "tank"],
      presets: ["wheels.roll"],
      // Mounted by its plain face, which turns its hub to the outside on
      // either side of a hull.
      pieces: (id) =>
        fixed(pack, [piece(id(0), "wheel", PART.wheel, { role: "wheel" })]),
      mount: { piece: 0, connector: "+x" },
    },
    {
      key: "axle",
      name: "Axle with two wheels",
      category: "Wheel",
      tags: ["wheel", "axle", "vehicle", "tank"],
      presets: ["wheels.roll"],
      pieces: (id) =>
        fixed(pack, [
          piece(id(0), "axle", PART.bar),
          piece(id(1), "lwheel", PART.wheel, {
            role: "wheel",
            ...joined(id(0), "+x", "+x"),
          }),
          piece(id(2), "rwheel", PART.wheel, {
            role: "wheel",
            ...joined(id(0), "+x", "-x"),
          }),
        ]),
      mount: { piece: 0, connector: "+y" },
    },
    {
      key: "turret",
      name: "Turret",
      category: "Turret",
      tags: ["weapon", "turret", "barrel", "flare", "gun"],
      presets: ["turret.track", "recoil"],
      pieces: (id) => {
        if (!weapon) return null;
        let n = 0;
        return buildWeaponModule(weapon, () => id(n++), AUTHORED).pieces;
      },
      mount: { piece: 0, connector: "-y" },
    },
    {
      key: "leg",
      name: "Leg",
      category: "Leg",
      tags: ["leg", "walker", "front left"],
      presets: ["walk.biped"],
      // Mounted by its inner side, so on a hull's left face it hangs as built.
      pieces: (id) =>
        fixed(
          pack,
          leg(pack, "l", { thigh: id(0), shin: id(1), foot: id(2) }, {}),
        ),
      mount: { piece: 0, connector: "-x" },
    },
    {
      key: "legs",
      name: "Pair of legs",
      category: "Leg",
      tags: ["leg", "walker", "biped", "hip"],
      presets: ["walk.biped"],
      // The unit's left is +x, so the left leg is on the hip's +x end.
      pieces: (id) =>
        fixed(pack, [
          piece(id(0), "hip", PART.bar),
          ...leg(
            pack,
            "l",
            { thigh: id(1), shin: id(2), foot: id(3) },
            joined(id(0), "-x", "+x"),
          ),
          ...leg(
            pack,
            "r",
            { thigh: id(4), shin: id(5), foot: id(6) },
            joined(id(0), "+x", "-x"),
          ),
        ]),
      mount: { piece: 0, connector: "+y" },
    },
    {
      key: "buildarm",
      name: "Build arm",
      category: "Arm",
      tags: ["builder", "build arm", "nano", "constructor"],
      presets: ["build.aim", "build.nano"],
      pieces: (id) => {
        if (!arm) return null;
        let n = 0;
        return buildArmModule(arm, () => id(n++), AUTHORED).pieces;
      },
      mount: { piece: 0, connector: "-y" },
    },
    {
      key: "hull",
      name: "Hull section",
      category: "Chassis",
      tags: ["hull", "body", "chassis", "block"],
      presets: [],
      pieces: (id) => fixed(pack, [piece(id(0), "hull", PART.hull)]),
      mount: { piece: 0, connector: "-y" },
    },
    {
      key: "hull-long",
      name: "Long hull section",
      category: "Chassis",
      tags: ["hull", "body", "chassis", "long"],
      presets: [],
      pieces: (id) =>
        fixed(pack, [
          piece(id(0), "hull", PART.hull),
          piece(id(1), "hullfront", PART.hull, joined(id(0), "-z", "+z")),
        ]),
      mount: { piece: 0, connector: "-y" },
    },
    {
      key: "deck",
      name: "Deck plate",
      category: "Chassis",
      tags: ["deck", "plate", "chassis", "flat"],
      presets: [],
      pieces: (id) => fixed(pack, [piece(id(0), "deck", PART.deck)]),
      mount: { piece: 0, connector: "-y" },
    },
  ];
}

function build(pack: LoadedPack, recipe: Recipe): LegoProject | null {
  const moduleId = `${BUILT_IN_PREFIX}${recipe.key}`;
  const pieces = recipe.pieces((n) => `${moduleId}.${n}`);
  const root = pieces?.[0];
  const mounted = pieces?.[recipe.mount.piece];
  if (!pieces || !root || !mounted) return null;
  const mount: LegoMount = {
    piece: mounted.id,
    connector: recipe.mount.connector,
  };
  const document: LegoProject = {
    schemaVersion: LEGO_SCHEMA_VERSION,
    id: moduleId,
    name: recipe.name,
    unitName: normalisePieceName(recipe.name),
    packId: pack.manifest.id,
    packVersion: pack.manifest.version,
    createdAt: AUTHORED,
    updatedAt: AUTHORED,
    rootPieceId: root.id,
    pieces,
    mount,
    category: recipe.category,
    tags: recipe.tags,
    ...(recipe.presets.length > 0
      ? {
          animations: recipe.presets.map((presetId) => ({
            presetId,
            params: {},
          })),
        }
      : {}),
  };
  // The joins put the pieces where they go, so no position above is worked
  // out by hand.
  return resolveConnections(document, pack).project;
}

const built = new WeakMap<LoadedPack, LegoProject[]>();

/** The built in modules this library can make, in the order they are listed. */
export function starterModules(pack: LoadedPack): LegoProject[] {
  const cached = built.get(pack);
  if (cached) return cached;
  const modules = recipes(pack).flatMap((recipe) => build(pack, recipe) ?? []);
  built.set(pack, modules);
  return modules;
}

/**
 * The module list: the built in modules first, then the user's own. A saved
 * document claiming a built in id is not the user's to have, so it is left out.
 */
export function withStarters(
  starters: LegoProject[],
  saved: LegoProject[],
): LegoProject[] {
  return [...starters, ...saved.filter((module) => !isBuiltInModule(module))];
}

/**
 * A module as the user's own: a new id, today's date and a name no other module
 * has, "Wheel copy" and then "Wheel copy 2". Everything else is kept, mount,
 * presets, category and tags included.
 */
export function ownCopy(
  module: LegoProject,
  taken: string[],
  options: { id: string; now: string },
): LegoProject {
  const names = new Set(taken.map((name) => name.trim().toLowerCase()));
  let name = `${module.name} copy`;
  for (let n = 2; names.has(name.toLowerCase()); n++) {
    name = `${module.name} copy ${n}`;
  }
  return {
    ...module,
    id: options.id,
    name,
    createdAt: options.now,
    updatedAt: options.now,
  };
}
