/**
 * Which fields the unit page draws, in what order, and under which heading.
 *
 * Two decisions live here. The first is grouping (issue #1270): a unitdef's own
 * layout is a flat table of 269 engine keys in whatever order the C++ parser
 * happens to read them, which is no use to somebody looking for "how much does
 * it cost". The community editor's grouping maps to how players think instead,
 * and that is what {@link UNIT_FIELD_GROUPS} copies.
 *
 * The second is which of those fields are worth drawing at all (issue #2647). A
 * unit sets a few dozen keys out of the 269 the engine will read, so showing
 * all of them buries the one the reader came for. {@link unitFieldView} defaults
 * to the ones the unit's own definition declares and counts the rest, so the
 * "all" switch is an offer rather than a rescue.
 *
 * Nothing here writes down a field's label, type or default. Those come from
 * `src/content/unitFields.ts`, which generates them from the engine's own
 * parsers. This module only says where a field belongs.
 */
import {
  describeField,
  engineFields,
  normaliseFieldPath,
  openTables,
  type ResolvedField,
} from "@/content/unitFields";
import {
  type FieldState,
  fieldState,
  readPath,
  type UnitOverrides,
} from "./overrides";

/** A collapsible run of fields inside a group. */
export interface SectionSpec {
  id: string;
  label: string;
  /** Registry paths, as the registry writes them, so `weapons.*.name`. */
  paths: string[];
}

/** A top-level heading on the unit page. */
export interface GroupSpec {
  id: string;
  label: string;
  sections: SectionSpec[];
}

/**
 * The grouping, as issue #1270 describes it: three headline groups that match
 * how a player talks about a unit, with the collapsible sections it names
 * distributed one to a group.
 *
 * A fourth group carries what none of those three own. Assets, a unit's model,
 * script and sounds, is a section #1270 asks for and is not economy, movement
 * or weaponry. The two sections after it are fallbacks rather than a designed
 * home, and both are filled at render time rather than listed here. Every
 * engine key nobody placed lands in "Other engine fields" and every key only
 * the game declares lands in the last one, so no field can be dropped by an
 * omission in this table.
 */
export const UNIT_FIELD_GROUPS: GroupSpec[] = [
  {
    id: "economy",
    label: "Economy and durability",
    sections: [
      {
        id: "economy",
        label: "Cost and production",
        paths: [
          "metalCost",
          "energyCost",
          "buildTime",
          "buildCostMetal",
          "buildCostEnergy",
          "metalMake",
          "energyMake",
          "metalUse",
          "energyUse",
          "metalUpkeep",
          "energyUpkeep",
          "metalStorage",
          "energyStorage",
          "harvestStorage",
          "harvestMetalStorage",
          "harvestEnergyStorage",
          "extractsMetal",
          "makesMetal",
          "tidalGenerator",
          "windGenerator",
          "onoffable",
          "activateWhenBuilt",
          "workerTime",
          "builder",
          "buildOptions",
          "buildDistance",
          "buildRange3D",
          "buildeeBuildRadius",
          "canAssist",
          "canBeAssisted",
          "canRepair",
          "canReclaim",
          "canRestore",
          "canResurrect",
          "canCapture",
          "repairSpeed",
          "maxRepairSpeed",
          "reclaimSpeed",
          "resurrectSpeed",
          "captureSpeed",
          "terraformSpeed",
          "repairable",
          "reclaimable",
          "capturable",
          "fullHealthFactory",
          "showNanoFrame",
          "showNanoSpray",
        ],
      },
      {
        id: "durability",
        label: "Durability",
        paths: [
          "health",
          "maxDamage",
          "autoHeal",
          "idleAutoHeal",
          "idleTime",
          "canSelfRepair",
          "damageModifier",
          "hideDamage",
          "crushResistance",
          "flankingBonusMode",
          "flankingBonusDir",
          "flankingBonusMin",
          "flankingBonusMax",
          "flankingBonusMobilityAdd",
        ],
      },
      {
        id: "classification",
        label: "Classification",
        // `name`, `humanName` and `description` used to head this list. They
        // now have a panel of their own at the top of the page, for the reason
        // {@link OWN_EDITOR} gives, and placing a path this module never draws
        // would only leave somebody looking for the row it promises.
        paths: [
          "category",
          "noChaseCategory",
          "decoyFor",
          "cobID",
          "power",
          "maxThisUnit",
          "unitRestricted",
          "isFeature",
          "isFirePlatform",
          "isTargetingUpgrade",
          "showPlayerName",
        ],
      },
      {
        id: "death",
        label: "Death and self destruct",
        paths: [
          "corpse",
          "explodeAs",
          "selfDestructAs",
          "canSelfDestruct",
          "selfDestructCountdown",
          "kamikaze",
          "kamikazeDistance",
          "kamikazeUseLOS",
          "fallSpeed",
          "unitFallSpeed",
          "SFXTypes.explosionGenerators",
          "SFXTypes.pieceExplosionGenerators",
          "SFXTypes.crashExplosionGenerators",
        ],
      },
    ],
  },
  {
    id: "movement",
    label: "Movement and sensors",
    sections: [
      {
        id: "movement",
        label: "Movement",
        paths: [
          "canMove",
          "speed",
          "maxVelocity",
          "rSpeed",
          "maxReverseVelocity",
          "maxAcc",
          "acceleration",
          "maxDec",
          "brakeRate",
          "turnRate",
          "turnRadius",
          "turnInPlace",
          "turnInPlaceAngleLimit",
          "turnInPlaceSpeedLimit",
          "movementClass",
          "maxSlope",
          "minWaterDepth",
          "maxWaterDepth",
          "waterline",
          "WaterLine",
          "floater",
          "canSubmerge",
          "upright",
          "moveState",
          "canFight",
          "canPatrol",
          "canGuard",
          "canRepeat",
          "myGravity",
          "useSmoothMesh",
          "upDirSmoothing",
          "slideTolerance",
          "holdSteady",
          "releaseHeld",
          "canFly",
          "airStrafe",
          "airHoverFactor",
          "bankingAllowed",
          "maxBank",
          "maxPitch",
          "maxAileron",
          "maxElevator",
          "maxRudder",
          "wingAngle",
          "wingDrag",
          "crashDrag",
          "cruiseAlt",
          "cruiseAltitude",
          "verticalSpeed",
          "frontToSpeed",
          "speedToFront",
          "canLoopbackAttack",
          "factoryHeadingTakeoff",
          "separationDistance",
          "loadingRadius",
          "transportCapacity",
          "transportMass",
          "transportSize",
          "transportUnloadMethod",
          "transportByEnemy",
          "cantBeTransported",
          "minTransportMass",
          "minTransportSize",
          "unloadSpread",
        ],
      },
      {
        id: "sensors",
        label: "Sensors and stealth",
        paths: [
          "sightDistance",
          "airSightDistance",
          "radarDistance",
          "sonarDistance",
          "radarDistanceJam",
          "sonarDistanceJam",
          "seismicDistance",
          "seismicSignature",
          "sightEmitHeight",
          "radarEmitHeight",
          "losEmitHeight",
          "leavesGhost",
          "stealth",
          "sonarStealth",
          "canCloak",
          "initCloaked",
          "cloakCost",
          "cloakCostMoving",
          "minCloakDistance",
          "decloakOnFire",
          "decloakSpherical",
        ],
      },
      {
        id: "collision",
        label: "Collision and physics",
        paths: [
          "mass",
          "collide",
          "blocking",
          "pushResistant",
          "minCollisionSpeed",
          "groundFrictionCoefficient",
          "rollingResistanceCoefficient",
          "atmosphericDragCoefficient",
          "collisionVolume.type",
          "collisionVolume.scales",
          "collisionVolume.offsets",
          "collisionVolume.axis",
          "collisionVolumeType",
          "collisionVolumeScales",
          "collisionVolumeOffsets",
          "useFootPrintCollisionVolume",
          "usePieceCollisionVolumes",
          "selectionVolume.type",
          "selectionVolume.scales",
          "selectionVolume.offsets",
          "selectionVolume.axis",
          "selectionVolumeType",
          "selectionVolumeScales",
          "selectionVolumeOffsets",
          "useFootPrintSelectionVolume",
          "usePieceSelectionVolumes",
        ],
      },
      {
        id: "footprint",
        label: "Footprint and placement",
        paths: [
          "footprintX",
          "footprintZ",
          "yardMap",
          "buildingMask",
          "levelGround",
          "useGroundDecal",
          "groundDecalType",
          "groundDecalSizeX",
          "groundDecalSizeY",
          "groundDecalDecaySpeed",
          "useBuildingGroundDecal",
          "buildingGroundDecalType",
          "buildingGroundDecalSizeX",
          "buildingGroundDecalSizeY",
          "buildingGroundDecalDecaySpeed",
        ],
      },
    ],
  },
  {
    id: "weapons",
    label: "Weapons",
    sections: [
      {
        id: "weapons",
        label: "Weapon mounts",
        paths: [
          "weapons.*.name",
          "weapons.*.slaveTo",
          "weapons.*.mainDir",
          "weapons.*.maxAngleDif",
          "weapons.*.onlyTargetCategory",
          "weapons.*.badTargetCategory",
          "weapons.*.accurateLeading",
          "weapons.*.fastAutoRetargeting",
          "weapons.*.fastQueryPointUpdate",
          "weapons.*.burstControlWhenOutOfArc",
          "weapons.*.weaponAimAdjustPriority",
        ],
      },
      {
        id: "combat",
        label: "Combat behaviour",
        paths: [
          "canAttack",
          "canDGun",
          "canManualFire",
          "fireState",
          "noAutoFire",
          "stopToAttack",
          "strafeToAttack",
          "hoverAttack",
          "highTrajectory",
          "canDropFlare",
          "flareDelay",
          "flareReload",
          "flareTime",
          "flareEfficiency",
          "flareSalvoSize",
          "flareSalvoDelay",
          "flareDropVector",
        ],
      },
    ],
  },
  {
    id: "presentation",
    label: "Everything else",
    sections: [
      {
        id: "assets",
        label: "Assets",
        paths: [
          "objectName",
          "script",
          "buildPic",
          "iconType",
          "nanoColor",
          "leaveTracks",
          "trackType",
          "trackWidth",
          "trackOffset",
          "trackStrength",
          "trackStretch",
          "sounds.select",
          "sounds.ok",
          "sounds.arrived",
          "sounds.cant",
          "sounds.underattack",
          "sounds.build",
          "sounds.activate",
          "sounds.deactivate",
          "sounds.*.*.file",
          "sounds.*.*.volume",
        ],
      },
      {
        // A table the engine reads whole and never looks inside, so every key
        // in it means whatever this game's own Lua decides. One row per key,
        // each carrying the file that reads it (issue #2661).
        id: "customParams",
        label: "Custom parameters",
        paths: ["customParams"],
      },
    ],
  },
];

/** Where an engine key nobody placed above ends up. */
const UNPLACED_SECTION = {
  id: "unplaced",
  label: "Other engine fields",
} as const;

/** Where a key only this game declares ends up, as a raw key and value row. */
const GAME_SECTION = {
  id: "game",
  label: "Fields only this game declares",
} as const;

/** The group both fallback sections are appended to. */
const FALLBACK_GROUP = "presentation";

/** Registry path to the section it was placed in. */
const SECTION_OF_PATH = new Map<string, string>();
/** Registry path to its position in the section, so a section keeps its order. */
const ORDER_IN_SECTION = new Map<string, number>();
for (const group of UNIT_FIELD_GROUPS) {
  for (const section of group.sections) {
    section.paths.forEach((path, index) => {
      SECTION_OF_PATH.set(path, section.id);
      ORDER_IN_SECTION.set(path, index);
    });
  }
}

/** Every unit path the engine declares, as the registry writes it. */
const REGISTRY_PATHS = engineFields("unit").map((f) =>
  f.section === "" ? f.key : `${f.section}.${f.key}`,
);
const REGISTRY_PATHS_LOWER = REGISTRY_PATHS.map((p) => p.toLowerCase());

/**
 * The key everything here matches on: a path normalised, then lowercased.
 *
 * A game's defs do not arrive in the engine's spelling. `gamedata/defs.lua`
 * hands back `buildcostmetal` and `collisionvolumescales` where the registry,
 * taken from the C++, writes `buildCostMetal` and `collisionVolume.scales`.
 * Matching on the literal spelling would have made every field in every real
 * game unknown, which is what a first run against Balanced Annihilation showed.
 * The engine's own def readers are case insensitive, so this is the engine's
 * behaviour rather than a way around the problem.
 */
const matchKey = (path: string) => normaliseFieldPath(path).toLowerCase();

/** Lowercased path to the registry's own spelling of it. */
const CANONICAL = new Map(
  REGISTRY_PATHS.map((path) => [path.toLowerCase(), path] as const),
);

/**
 * The registry's spelling of a path, for looking up what a field is. Falls back
 * to the path as written, which is what a key only the game declares gets.
 */
const canonicalPath = (path: string) => {
  const normalised = normaliseFieldPath(path);
  return CANONICAL.get(normalised.toLowerCase()) ?? normalised;
};

/**
 * A registry path some other registry path nests inside, e.g. `weapons`, whose
 * own row would only repeat what its children already say. Skipped in the "all"
 * view, because its children carry the content.
 */
const CONTAINER_PATHS = new Set(
  REGISTRY_PATHS.filter((path) =>
    REGISTRY_PATHS.some((other) => other.startsWith(`${path}.`)),
  ),
);

const OPEN_TABLE_PATTERNS = openTables("unit").map((p) =>
  p.toLowerCase().split("."),
);

/** Whether a path is a table the engine reads whole, so a game may put any key
 *  inside it and there is nothing below it to enumerate. */
function isOpenTable(path: string): boolean {
  const parts = matchKey(path).split(".");
  return OPEN_TABLE_PATTERNS.some(
    (pattern) =>
      pattern.length === parts.length &&
      pattern.every((seg, i) => seg === "*" || seg === parts[i]),
  );
}

/** Whether the registry declares anything below this path, so a table found
 *  here is worth walking into rather than showing as one row. */
function isRegistryContainer(path: string): boolean {
  const prefix = `${matchKey(path)}.`;
  return REGISTRY_PATHS_LOWER.some((known) => known.startsWith(prefix));
}

/**
 * Whether a path is a `customParams` table.
 *
 * The one open table whose keys are walked into rather than shown as one blob
 * of JSON. Every other open table is engine machinery a game fills in a shape
 * the engine defines, while a custom parameter is a key that exists only
 * because the game's own Lua reads it, so each one is a field in its own right
 * and issue #2661 has something to say about each one separately.
 */
const isCustomParamsTable = (path: string) =>
  matchKey(path).split(".").at(-1) === "customparams";

/** The section id the `customParams` spec above declares, so a key inside the
 *  table lands beside it rather than in the fallback section for keys the
 *  registry has never heard of. */
const CUSTOM_PARAMS_SECTION = "customParams";

/** Whether a path names something inside a `customParams` table. */
const isCustomParamKey = (path: string) => {
  const parts = matchKey(path).split(".");
  const at = parts.indexOf("customparams");
  return at >= 0 && at < parts.length - 1;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * Every field path a unit's own definition declares, as access paths, so an
 * array step is the real index and `weapons.0.name` reads the first mount.
 *
 * The walk stops as soon as there is nothing useful below: at a table the
 * engine reads whole, at a value that is not a table, and at a table the
 * registry says nothing about, which becomes a single raw row rather than
 * however many rows a game's own nested data happens to contain. A
 * `customParams` table is the exception, for the reason {@link
 * isCustomParamsTable} gives.
 */
export function presentPaths(
  def: Record<string, unknown> | undefined,
): string[] {
  const out: string[] = [];
  const walk = (path: string, value: unknown) => {
    if (
      isPlainObject(value) &&
      (isCustomParamsTable(path) ||
        (!isOpenTable(path) && isRegistryContainer(path)))
    ) {
      for (const key of Object.keys(value)) walk(`${path}.${key}`, value[key]);
      return;
    }
    out.push(path);
  };
  const table = def ?? {};
  for (const key of Object.keys(table)) walk(key, table[key]);
  return out;
}

/**
 * Lowercased paths the field list never draws, because the page has a better
 * editor for them above it.
 *
 * `buildoptions` is an ordered list of units, and the page gives it a roster
 * with add, remove and reorder on it (issue #1274). Left in the field list as
 * well it would be a second, worse way to say the same thing: a read-only blob
 * of JSON beside a control that already shows the same list in order.
 *
 * `name`, `humanname` and `description` have a panel of their own for a
 * stronger reason (issue #2650). For a game that names its units in a
 * localisation file rather than in its defs, a `name` row here would be an
 * empty box that writes a key the game never reads. The panel knows where the
 * game keeps its names and this list cannot, so the list stops offering them.
 */
export const OWN_EDITOR = new Set([
  "buildoptions",
  "name",
  "humanname",
  "description",
]);

/** Which view of the field list the page is showing. */
export type FieldView = "relevant" | "all";

/** One field, ready to draw. */
export interface FieldRow {
  /** The access path into the def, so `weapons.0.name`. */
  path: string;
  /** What the registry says about it, keyed on the normalised path. */
  field: ResolvedField;
  /** The field's label, qualified when it is one of several array entries. */
  label: string;
  /** Whether the game's own definition declares this path. */
  present: boolean;
  /** The value with no user edit: the game's, or the engine's default. */
  inherited: unknown;
  /** The value to show: the user's if they set one, else `inherited`. */
  value: unknown;
  state: FieldState;
}

/** One collapsible run of fields, with its rows resolved. */
export interface RenderedSection {
  id: string;
  label: string;
  rows: FieldRow[];
}

/** One heading, with the sections under it that have anything to show. */
export interface RenderedGroup {
  id: string;
  label: string;
  sections: RenderedSection[];
}

/** Everything the unit page draws, plus what it is not drawing. */
export interface UnitFieldView {
  groups: RenderedGroup[];
  /** How many fields are drawn. */
  shown: number;
  /** How many the "all" view would add, so the switch can say what it offers. */
  hidden: number;
}

/** The numeric steps in an access path, for ordering weapon 0 before weapon 1. */
const indexPath = (path: string): number[] =>
  path
    .split(".")
    .filter((part) => /^\d+$/.test(part))
    .map(Number);

function compareIndexPaths(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const left = a[i] ?? -1;
    const right = b[i] ?? -1;
    if (left !== right) return left - right;
  }
  return 0;
}

/** A label that says which array entry it belongs to, when there is more than
 *  one. `weapons.0.name` reads "name (weapon 1)", counting from one because
 *  that is how a game's own def file writes its weapon list. */
function qualifiedLabel(path: string, field: ResolvedField): string {
  const parts = path.split(".");
  const at = parts.findIndex((part) => /^\d+$/.test(part));
  if (at <= 0) return field.label;
  const container = parts[at - 1].replace(/s$/, "");
  return `${field.label} (${container} ${Number(parts[at]) + 1})`;
}

/**
 * Build one row. `inherited` is what the field would read with no user edit:
 * the game's own value when its definition declares the path, and otherwise the
 * engine's default, which is what the engine would use for a key nobody wrote.
 */
function buildRow(
  path: string,
  def: Record<string, unknown> | undefined,
  overrides: UnitOverrides,
  unitKey: string,
  presentSet: Set<string>,
): FieldRow {
  const field = describeField("unit", canonicalPath(path));
  const present = presentSet.has(path);
  const inherited = present ? readPath(def, path) : field.default;
  const state = fieldState(overrides, unitKey, path);
  const value = state === "overridden" ? overrides[unitKey]?.[path] : inherited;
  return {
    path,
    field,
    label: qualifiedLabel(path, field),
    present,
    inherited,
    value,
    state,
  };
}

/**
 * Which paths a view draws.
 *
 * "relevant" is the paths the unit's own definition declares plus any the user
 * has overridden. Issue #2647 words that as the def's fields "plus the engine
 * defaults it overrides", which is the same set: a key present in a def is the
 * unit overriding whatever the engine would otherwise have used. The user's own
 * edits are added so a field cannot vanish out from under the person who just
 * changed it, which is the one way this filter could do harm.
 *
 * "all" adds every key the engine declares. A registry path with a `*` in it is
 * a pattern rather than a path, so it only appears where the def has an entry
 * for it to describe: an "all" view cannot invent a third weapon mount in order
 * to show the keys a weapon mount would have.
 *
 * Keyed by the lowercased path so the registry's `maxDamage` and a game's own
 * `maxdamage` are one field rather than two rows of the same thing. Where both
 * exist the game's spelling wins, because that is the path the value is read
 * from. Array indices are deliberately left alone here, unlike in {@link
 * matchKey}: three weapon mounts are three fields, and folding their indices
 * into `*` would collapse them into one row.
 *
 * A registry key the def has already walked into is left out of the "all" view
 * as well, on top of the statically known containers. `customParams` is a leaf
 * to the registry and a table with rows of its own here, so without this a unit
 * that declares two custom parameters would show both of them and then the
 * whole table again as one blob of JSON.
 */
function pathsForView(
  view: FieldView,
  present: string[],
  overridden: string[],
): string[] {
  const paths = new Map<string, string>();
  for (const path of [...present, ...overridden])
    paths.set(path.toLowerCase(), path);
  if (view === "all") {
    const walkedInto = [...paths.keys()];
    for (const path of REGISTRY_PATHS) {
      if (path.includes("*") || CONTAINER_PATHS.has(path)) continue;
      const key = path.toLowerCase();
      if (paths.has(key)) continue;
      if (walkedInto.some((below) => below.startsWith(`${key}.`))) continue;
      paths.set(key, path);
    }
  }
  for (const path of OWN_EDITOR) paths.delete(path);
  return [...paths.values()];
}

/**
 * Group one unit's fields for drawing, in the requested view.
 *
 * `def` is the unit's table exactly as the game left it and `overrides` is the
 * project's sparse edit set. Nothing here writes to either.
 */
export function unitFieldView(
  def: Record<string, unknown> | undefined,
  overrides: UnitOverrides,
  unitKey: string,
  view: FieldView,
): UnitFieldView {
  const present = presentPaths(def);
  const presentSet = new Set(present);
  const overridden = Object.keys(overrides[unitKey] ?? {});
  const paths = pathsForView(view, present, overridden);
  const relevantCount = pathsForView("relevant", present, overridden).length;

  const bySection = new Map<string, FieldRow[]>();
  for (const path of paths) {
    const canonical = canonicalPath(path);
    const section = isCustomParamKey(path)
      ? CUSTOM_PARAMS_SECTION
      : (SECTION_OF_PATH.get(canonical) ??
        (CANONICAL.has(canonical.toLowerCase())
          ? UNPLACED_SECTION.id
          : GAME_SECTION.id));
    const row = buildRow(path, def, overrides, unitKey, presentSet);
    const rows = bySection.get(section);
    if (rows) rows.push(row);
    else bySection.set(section, [row]);
  }

  const orderOf = (path: string) =>
    ORDER_IN_SECTION.get(canonicalPath(path)) ?? Number.MAX_SAFE_INTEGER;
  for (const rows of bySection.values())
    rows.sort((a, b) => {
      const byIndex = compareIndexPaths(indexPath(a.path), indexPath(b.path));
      if (byIndex !== 0) return byIndex;
      const byOrder = orderOf(a.path) - orderOf(b.path);
      if (byOrder !== 0) return byOrder;
      return a.path.localeCompare(b.path);
    });

  const groups: RenderedGroup[] = [];
  for (const group of UNIT_FIELD_GROUPS) {
    const specs =
      group.id === FALLBACK_GROUP
        ? [...group.sections, UNPLACED_SECTION, GAME_SECTION]
        : group.sections;
    const sections: RenderedSection[] = [];
    for (const section of specs) {
      const rows = bySection.get(section.id);
      if (rows?.length)
        sections.push({ id: section.id, label: section.label, rows });
    }
    if (sections.length > 0)
      groups.push({ id: group.id, label: group.label, sections });
  }

  const shown = [...bySection.values()].reduce((n, rows) => n + rows.length, 0);
  return {
    groups,
    shown,
    // What switching to "all" would add. Counted against the relevant set
    // rather than against `shown`, so it reads the same in either view.
    hidden: pathsForView("all", present, overridden).length - relevantCount,
  };
}
