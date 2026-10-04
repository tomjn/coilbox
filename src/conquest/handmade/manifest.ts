import { parseMapDownload } from "../../campaign/model";
import { MAP_RUN_KINDS, type MapRunKind } from "../../runlite/mapRun";
import type { NodeBattleSpec } from "../model";
import { MAX_DIFFICULTY, MIN_DIFFICULTY, NEUTRAL } from "../model";
import {
  MODEL_FILE_EXTS,
  type PlacedModel,
  parsePlacedModels,
} from "../placedModels";
import type { HandmadeMapError } from "./errors";

/**
 * The manifest of a hand-made map folder, as the author writes it in
 * `map.json`. These types are the format: the author guide is written from
 * the doc comments here.
 *
 * Two rules hold for every part of it. A key the reader does not know is
 * ignored, so a manifest written for a newer coilbox still reads. A value the
 * reader does not know is an error, so a typo in an owner or a kind is caught
 * instead of being read as something else.
 *
 * Positions are in map units, with the origin at the top left of the map
 * picture, x to the right and y down.
 */

/** The file name of the manifest inside a map folder. */
export const MANIFEST_FILE = "map.json";

/** The manifest version this build reads. */
export const MANIFEST_FORMAT_VERSION = 1;

/**
 * The battle fought at a location, in the form Conquest uses for a node. Only
 * `mapName` is required. Leave the whole `battle` out and coilbox picks a map
 * from the ones the player has, by the location's difficulty.
 */
export type ManifestBattle = Omit<NodeBattleSpec, "mapSubstitutedFrom">;

export interface ManifestFaction {
  /** Short id that provinces use as their `owner`. Not `neutral`. */
  id: string;
  /** The name shown to the player. */
  name: string;
  /** `#rrggbb`, the tint on the map and the team colour in battle. */
  color: string;
  /** 0 to 1, how often this faction attacks when the computer plays it. */
  aggression?: number;
  /** The skirmish AI that plays this faction, as `kind:shortName`. */
  aiKey?: string;
  /** The in-game side this faction plays, such as "Core". */
  side?: string;
  /** Whether the player may pick this faction. Defaults to true. */
  playable?: boolean;
}

/** What a painted province and a point location have in common. */
export interface ManifestLocation {
  /**
   * The id that crossings, blocked borders, roads and saved games use. Letters,
   * digits, `-` and `_`. Defaults to the name in lower case with every other
   * character turned into `-`, so "Lower Saxony" is `lower-saxony`. Set it by
   * hand before renaming a location, so saved games keep their place.
   */
  id?: string;
  /** The name shown to the player. */
  name: string;
  /** A faction id, or `neutral`. Defaults to `neutral`. */
  owner?: string;
  /** True for a faction's capital. Each faction needs exactly one. */
  capital?: boolean;
  /** 1 to 5, how hard the battle is. Defaults to 1. */
  difficulty?: number;
  /** The battle fought here. Leave it out for a map chosen by difficulty. */
  battle?: ManifestBattle;
  /** A sentence or two shown when the location is selected. */
  blurb?: string;
  /**
   * What this location is on a Warpath run: battle, elite, shop, event or
   * reward. Leave it out and each run picks a kind from its seed. Conquest
   * ignores it. The Warpath start and goal cannot have one.
   */
  warpath?: { kind?: MapRunKind };
  /**
   * Reserved for a scenario played here in place of a skirmish (issue #3515):
   * the name of a scenario file in the folder. The reader ignores it today.
   */
  scenario?: string;
}

/** A province painted on the province image. */
export interface ManifestProvince extends ManifestLocation {
  /** `#rrggbb`, the one flat colour this province is painted in. */
  color: string;
  /**
   * Where the province's marker sits, as `[x, y]`. Defaults to a point well
   * inside the painted area.
   */
  anchor?: [number, number];
}

/** A location with a position and no painted area, such as a city. */
export interface ManifestPointLocation extends ManifestLocation {
  /** Where it is, as `[x, y]`. */
  pos: [number, number];
}

export interface MapManifest {
  /** Always 1. */
  formatVersion: 1;
  /** Letters, digits and `-`. Saved games record it, so do not change it. */
  id: string;
  title: string;
  description?: string;
  /** The game this map is for, by the `shortname` in its modinfo. */
  game: { shortname: string; pinnedName?: string };
  /** The size of the map in map units. Every position is measured in these. */
  size: { width: number; height: number };
  /** File names inside the folder. */
  files: {
    /** The map picture shown to the player. */
    picture: string;
    /** The province image, the same size in pixels as the picture. */
    provinces: string;
    /** A greyscale image, black lowest and white highest. */
    heightmap?: string;
  };
  /** How high a white heightmap pixel is, in map units. */
  heightScale?: number;
  /**
   * `#rrggbb` of a colour that belongs to no province, for an image editor
   * that cannot save transparency. Transparent pixels never belong to one.
   */
  background?: string;
  factions: ManifestFaction[];
  /** The faction picked by default. Defaults to the first playable one. */
  playerFaction?: string;
  provinces: ManifestProvince[];
  /** Point locations. They join the map through `roads` or `crossings`. */
  locations?: ManifestPointLocation[];
  /** Pairs of location ids joined although they do not touch, such as a strait. */
  crossings?: [string, string][];
  /** Pairs of province ids that touch but cannot be moved between. */
  blockedBorders?: [string, string][];
  /** Pairs of location ids joined by a road. This is how a point location is reached. */
  roads?: [string, string][];
  /**
   * The ids of the locations a Warpath run starts at and ends at. Give both to
   * offer the map in Warpath, or leave `warpath` out for a map that is only
   * for Conquest. The goal must be reachable from the start. A location on no
   * shortest route between the two is scenery in Warpath. Conquest ignores
   * this and uses every location.
   */
  warpath?: { start?: string; goal?: string };
  /**
   * Models stood on the terrain as scenery. An entry names a model the game
   * has, or a `.gltf` or `.glb` file inside the folder.
   */
  models?: PlacedModel[];
}

/**
 * A manifest after checking: every location has its id, colours are lower
 * case, the optional lists are present, the reserved keys are dropped, and
 * `warpath` is present only with both of its ends.
 */
export interface ResolvedManifest
  extends Omit<
    MapManifest,
    | "provinces"
    | "locations"
    | "crossings"
    | "blockedBorders"
    | "roads"
    | "warpath"
    | "models"
  > {
  models: PlacedModel[];
  provinces: (ManifestProvince & { id: string })[];
  locations: (ManifestPointLocation & { id: string })[];
  crossings: [string, string][];
  blockedBorders: [string, string][];
  roads: [string, string][];
  warpath?: { start: string; goal: string };
}

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `#rrggbb` in lower case, or null when the value is not that. */
export function normaliseHex(value: unknown): string | null {
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    return null;
  }
  return value.toLowerCase();
}

/** The default id for a location: its name, lower case, joined by `-`. */
export function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * A file name that stays inside the map folder: relative, with no `..` step,
 * no backslash and no URL scheme.
 */
function isFolderFile(name: string): boolean {
  if (name === "" || name.startsWith("/") || name.includes("\\")) return false;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(name)) return false;
  return !name.split("/").some((step) => step === ".." || step === "");
}

/** How a province is named in a message: `"Kent" (#ff0000)`. */
export function describeProvince(name: string, color: string): string {
  return `"${name}" (${color})`;
}

/**
 * Check the text of `map.json` and resolve it.
 *
 * `manifest` is null when the file cannot be used at all: it is not JSON, or
 * a key is missing or wrong. The errors that leave it usable (a faction with
 * no capital, a crossing to a location that does not exist, a pair both
 * blocked and joined) come back beside a manifest, so the caller can go on to
 * the images and report everything in one pass.
 */
export function parseManifest(text: string): {
  manifest: ResolvedManifest | null;
  errors: HandmadeMapError[];
} {
  const errors: HandmadeMapError[] = [];
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return {
      manifest: null,
      errors: [
        {
          code: "manifest-json",
          message: `${MANIFEST_FILE} is not valid JSON: ${detail}`,
        },
      ],
    };
  }
  if (!isObj(data)) {
    return {
      manifest: null,
      errors: [
        {
          code: "manifest-json",
          message: `${MANIFEST_FILE} must hold one JSON object.`,
        },
      ],
    };
  }

  const field = (path: string, problem: string) => {
    errors.push({
      code: "manifest-field",
      path,
      message: `${MANIFEST_FILE}: ${path} ${problem}`,
    });
  };

  /** A required non-empty string. */
  const text1 = (o: Obj, key: string, path: string): string => {
    const v = o[key];
    if (typeof v === "string" && v !== "") return v;
    field(path, "must be text and cannot be empty.");
    return "";
  };
  /** An optional string. Absent is fine, any other type is not. */
  const optText = (o: Obj, key: string, path: string): string | undefined => {
    const v = o[key];
    if (v === undefined) return undefined;
    if (typeof v === "string") return v === "" ? undefined : v;
    field(path, "must be text.");
    return undefined;
  };
  const optNumber = (
    o: Obj,
    key: string,
    path: string,
    ok: (n: number) => boolean,
    rule: string,
  ): number | undefined => {
    const v = o[key];
    if (v === undefined) return undefined;
    if (typeof v === "number" && Number.isFinite(v) && ok(v)) return v;
    field(path, `must be ${rule}.`);
    return undefined;
  };
  const optBool = (o: Obj, key: string, path: string): boolean | undefined => {
    const v = o[key];
    if (v === undefined) return undefined;
    if (typeof v === "boolean") return v;
    field(path, "must be true or false.");
    return undefined;
  };

  const d = data;

  if (d.formatVersion !== MANIFEST_FORMAT_VERSION) {
    if (
      typeof d.formatVersion === "number" &&
      d.formatVersion > MANIFEST_FORMAT_VERSION
    ) {
      field(
        "formatVersion",
        `is ${d.formatVersion}, which is newer than this coilbox reads (${MANIFEST_FORMAT_VERSION}). Update coilbox to use this map.`,
      );
    } else {
      field("formatVersion", `must be ${MANIFEST_FORMAT_VERSION}.`);
    }
  }

  const id = text1(d, "id", "id");
  if (id !== "" && !/^[A-Za-z0-9-]+$/.test(id)) {
    field("id", "may only use letters, digits and -.");
  }
  const title = text1(d, "title", "title");
  const description = optText(d, "description", "description");

  let game: MapManifest["game"] = { shortname: "" };
  if (isObj(d.game)) {
    game = {
      shortname: text1(d.game, "shortname", "game.shortname"),
      pinnedName: optText(d.game, "pinnedName", "game.pinnedName"),
    };
  } else {
    field("game", 'must be an object such as { "shortname": "BYAR" }.');
  }

  const size = { width: 0, height: 0 };
  if (isObj(d.size)) {
    for (const key of ["width", "height"] as const) {
      const v = d.size[key];
      if (typeof v === "number" && Number.isFinite(v) && v > 0) size[key] = v;
      else field(`size.${key}`, "must be a number above 0.");
    }
  } else {
    field(
      "size",
      'must be an object such as { "width": 2000, "height": 1500 }.',
    );
  }
  const sized = size.width > 0 && size.height > 0;

  const fileName = (o: Obj, key: string, required: boolean) => {
    const v = o[key];
    if (v === undefined && !required) return undefined;
    if (typeof v === "string" && isFolderFile(v)) return v;
    field(`files.${key}`, "must be the name of a file inside the map folder.");
    return undefined;
  };
  const files: MapManifest["files"] = { picture: "", provinces: "" };
  if (isObj(d.files)) {
    files.picture = fileName(d.files, "picture", true) ?? "";
    files.provinces = fileName(d.files, "provinces", true) ?? "";
    files.heightmap = fileName(d.files, "heightmap", false);
  } else {
    field("files", "must be an object naming the picture and provinces files.");
  }

  const heightScale = optNumber(
    d,
    "heightScale",
    "heightScale",
    (n) => n > 0,
    "a number above 0",
  );

  let background: string | undefined;
  if (d.background !== undefined) {
    background = normaliseHex(d.background) ?? undefined;
    if (!background) field("background", "must be a colour such as #ffffff.");
  }

  // Factions.
  const factions: ManifestFaction[] = [];
  const factionIds = new Set<string>();
  if (Array.isArray(d.factions) && d.factions.length > 0) {
    d.factions.forEach((raw, i) => {
      const path = `factions[${i}]`;
      if (!isObj(raw)) {
        field(path, "must be an object.");
        return;
      }
      const fid = text1(raw, "id", `${path}.id`);
      const name = text1(raw, "name", `${path}.name`);
      const color = normaliseHex(raw.color);
      if (!color) field(`${path}.color`, "must be a colour such as #cc3333.");
      if (fid === NEUTRAL) {
        field(`${path}.id`, `cannot be "${NEUTRAL}", which means no owner.`);
      } else if (factionIds.has(fid)) {
        field(`${path}.id`, `"${fid}" is used by two factions.`);
      }
      factionIds.add(fid);
      factions.push({
        id: fid,
        name,
        color: color ?? "",
        aggression: optNumber(
          raw,
          "aggression",
          `${path}.aggression`,
          (n) => n >= 0 && n <= 1,
          "a number from 0 to 1",
        ),
        aiKey: optText(raw, "aiKey", `${path}.aiKey`),
        side: optText(raw, "side", `${path}.side`),
        playable: optBool(raw, "playable", `${path}.playable`),
      });
    });
  } else {
    field("factions", "must list at least one faction.");
  }

  const playable = factions.filter((f) => f.playable !== false);
  if (factions.length > 0 && playable.length === 0) {
    field("factions", "must have at least one faction the player can pick.");
  }
  const playerFaction = optText(d, "playerFaction", "playerFaction");
  if (
    playerFaction !== undefined &&
    !playable.some((f) => f.id === playerFaction)
  ) {
    field(
      "playerFaction",
      `"${playerFaction}" is not the id of a faction the player can pick.`,
    );
  }

  // Locations: painted provinces first, then point locations.
  const locationIds = new Map<string, string>();
  const readLocation = (raw: Obj, path: string) => {
    const name = text1(raw, "name", `${path}.name`);
    const label = name === "" ? path : `${path} ("${name}")`;
    let locId = optText(raw, "id", `${label}.id`);
    if (locId !== undefined && !/^[A-Za-z0-9_-]+$/.test(locId)) {
      field(`${label}.id`, "may only use letters, digits, - and _.");
    }
    if (locId === undefined) {
      locId = slugifyName(name);
      if (locId === "" && name !== "") {
        field(
          `${label}.id`,
          "is needed, because the name has no letters or digits to make one from.",
        );
      }
    }
    if (locId !== "") {
      const other = locationIds.get(locId);
      if (other !== undefined) {
        errors.push({
          code: "duplicate-id",
          id: locId,
          message: `${MANIFEST_FILE}: "${other}" and "${name}" both have the id "${locId}". Give one of them its own "id".`,
        });
      } else {
        locationIds.set(locId, name);
      }
    }
    let owner = optText(raw, "owner", `${label}.owner`) ?? NEUTRAL;
    if (owner !== NEUTRAL && !factionIds.has(owner)) {
      field(
        `${label}.owner`,
        `"${owner}" is not a faction id. Use one of: ${[...factionIds, NEUTRAL].join(", ")}.`,
      );
      owner = NEUTRAL;
    }
    const capital = optBool(raw, "capital", `${label}.capital`);
    if (capital && owner === NEUTRAL) {
      field(`${label}.capital`, "is true, so the location needs an owner.");
    }
    let warpath: { kind: MapRunKind } | undefined;
    if (isObj(raw.warpath)) {
      const kind = optText(raw.warpath, "kind", `${label}.warpath.kind`);
      if (MAP_RUN_KINDS.includes(kind as MapRunKind)) {
        warpath = { kind: kind as MapRunKind };
      } else if (kind !== undefined) {
        errors.push({
          code: "warpath-kind",
          name,
          kind,
          message: `${MANIFEST_FILE}: "${name}" has the Warpath kind "${kind}", which Warpath does not know. Use one of: ${MAP_RUN_KINDS.join(", ")}.`,
        });
      }
    } else if (raw.warpath !== undefined) {
      field(
        `${label}.warpath`,
        'must be an object such as { "kind": "shop" }.',
      );
    }
    return {
      id: locId,
      name,
      warpath,
      owner,
      capital: capital || undefined,
      difficulty: optNumber(
        raw,
        "difficulty",
        `${label}.difficulty`,
        (n) =>
          Number.isInteger(n) && n >= MIN_DIFFICULTY && n <= MAX_DIFFICULTY,
        `a whole number from ${MIN_DIFFICULTY} to ${MAX_DIFFICULTY}`,
      ),
      battle: readBattle(raw.battle, `${label}.battle`, field),
      blurb: optText(raw, "blurb", `${label}.blurb`),
    };
  };
  const readPoint = (value: unknown, path: string) => {
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      value.every((n) => typeof n === "number" && Number.isFinite(n))
    ) {
      const [x, y] = value as [number, number];
      if (!sized || (x >= 0 && x <= size.width && y >= 0 && y <= size.height)) {
        return [x, y] as [number, number];
      }
      field(
        path,
        `is [${x}, ${y}], which is outside the map (${size.width} by ${size.height}).`,
      );
      return undefined;
    }
    field(path, "must be a position such as [120, 340].");
    return undefined;
  };

  const provinces: ResolvedManifest["provinces"] = [];
  const colors = new Map<string, string>();
  if (Array.isArray(d.provinces)) {
    d.provinces.forEach((raw, i) => {
      const path = `provinces[${i}]`;
      if (!isObj(raw)) {
        field(path, "must be an object.");
        return;
      }
      const base = readLocation(raw, path);
      const label = base.name === "" ? path : `${path} ("${base.name}")`;
      const color = normaliseHex(raw.color);
      if (!color) {
        field(`${label}.color`, "must be a colour such as #cc3333.");
      } else if (color === background) {
        field(`${label}.color`, `is ${color}, the same as the background.`);
      } else if (colors.has(color)) {
        errors.push({
          code: "duplicate-color",
          color,
          message: `${MANIFEST_FILE}: "${colors.get(color)}" and "${base.name}" are both listed with the colour ${color}. Each province needs its own colour.`,
        });
      } else {
        colors.set(color, base.name);
      }
      provinces.push({
        ...base,
        color: color ?? "",
        anchor:
          raw.anchor === undefined
            ? undefined
            : readPoint(raw.anchor, `${label}.anchor`),
      });
    });
  } else {
    field("provinces", "must be a list of provinces.");
  }

  const locations: ResolvedManifest["locations"] = [];
  if (Array.isArray(d.locations)) {
    d.locations.forEach((raw, i) => {
      const path = `locations[${i}]`;
      if (!isObj(raw)) {
        field(path, "must be an object.");
        return;
      }
      const base = readLocation(raw, path);
      const label = base.name === "" ? path : `${path} ("${base.name}")`;
      const pos = readPoint(raw.pos, `${label}.pos`);
      locations.push({ ...base, pos: pos ?? [0, 0] });
    });
  } else if (d.locations !== undefined) {
    field("locations", "must be a list of point locations.");
  }
  // Placed models. An entry has the shape the map document keeps, so the
  // checks here only say what `parsePlacedModels` would drop without a word.
  const models: PlacedModel[] = [];
  if (Array.isArray(d.models)) {
    d.models.forEach((raw, i) => {
      const path = `models[${i}]`;
      if (!isObj(raw)) {
        field(
          path,
          'must be an object such as { "model": { "file": "tower.glb" }, "pos": [120, 340] }.',
        );
        return;
      }
      const before = errors.length;
      const ref = isObj(raw.model) ? raw.model : {};
      const named = [ref.file, ref.game].find(
        (v) => typeof v === "string" && v.trim() !== "",
      );
      const label = named === undefined ? path : `${path} ("${named}")`;
      const { file, game: gameModel } = ref;
      if ((file === undefined) === (gameModel === undefined)) {
        field(
          `${label}.model`,
          'must name one model: { "file": "tower.glb" } for a file in the map folder, or { "game": "armcom" } for a model the game has.',
        );
      } else if (gameModel !== undefined) {
        if (typeof gameModel !== "string" || gameModel.trim() === "") {
          field(`${label}.model.game`, "must be text and cannot be empty.");
        }
      } else if (typeof file !== "string" || !isFolderFile(file)) {
        field(
          `${label}.model.file`,
          "must be the name of a file inside the map folder.",
        );
      } else if (
        !MODEL_FILE_EXTS.some((ext) => file.toLowerCase().endsWith(ext))
      ) {
        field(
          `${label}.model.file`,
          `is "${file}", which is not a glTF model. The name must end in ${MODEL_FILE_EXTS.join(" or ")}.`,
        );
      }
      readPoint(raw.pos, `${label}.pos`);
      optNumber(raw, "height", `${label}.height`, () => true, "a number");
      optNumber(raw, "rotation", `${label}.rotation`, () => true, "a number");
      optNumber(
        raw,
        "scale",
        `${label}.scale`,
        (n) => n > 0,
        "a number above 0",
      );
      if (errors.length > before) return;
      const [entry] = parsePlacedModels([raw]) ?? [];
      if (entry) models.push(entry);
      else field(label, "is not a model the map can place.");
    });
  } else if (d.models !== undefined) {
    field("models", "must be a list of models.");
  }

  let warpathStart: string | undefined;
  let warpathGoal: string | undefined;
  if (isObj(d.warpath)) {
    warpathStart = optText(d.warpath, "start", "warpath.start");
    warpathGoal = optText(d.warpath, "goal", "warpath.goal");
  } else if (d.warpath !== undefined) {
    field(
      "warpath",
      'must be an object such as { "start": "kent", "goal": "calais" }.',
    );
  }

  if (provinces.length + locations.length === 0 && Array.isArray(d.provinces)) {
    field("provinces", "is empty, and the map needs at least one location.");
  }

  // Everything above is the shape of the file. A problem there stops here,
  // because the checks below would only repeat it in a more confusing form.
  if (errors.length > 0) return { manifest: null, errors };

  const all = [...provinces, ...locations];
  const nameOf = new Map(all.map((l) => [l.id, l.name]));

  for (const f of factions) {
    const capitals = all
      .filter((l) => l.capital && l.owner === f.id)
      .map((l) => l.name);
    if (capitals.length === 1) continue;
    errors.push({
      code: "capital-count",
      factionId: f.id,
      factionName: f.name,
      capitals,
      message:
        capitals.length === 0
          ? `The faction "${f.name}" has no capital. Set "capital": true on one location it owns.`
          : `The faction "${f.name}" has ${capitals.length} capitals: ${capitals.join(", ")}. Keep "capital": true on one of them.`,
    });
  }

  const readPairs = (key: "crossings" | "blockedBorders" | "roads") => {
    const out: [string, string][] = [];
    const raw = d[key];
    if (raw === undefined) return out;
    if (!Array.isArray(raw)) {
      field(key, "must be a list of pairs of location ids.");
      return out;
    }
    raw.forEach((pair, i) => {
      if (
        !Array.isArray(pair) ||
        pair.length !== 2 ||
        typeof pair[0] !== "string" ||
        typeof pair[1] !== "string"
      ) {
        field(
          `${key}[${i}]`,
          'must be a pair of location ids such as ["kent", "calais"].',
        );
        return;
      }
      const [a, b] = pair as [string, string];
      let known = true;
      for (const end of [a, b]) {
        if (nameOf.has(end)) continue;
        known = false;
        errors.push({
          code: "unknown-location",
          list: key,
          id: end,
          message: `${MANIFEST_FILE}: ${key}[${i}] names "${end}", which is not the id of any location.`,
        });
      }
      if (!known) return;
      if (a === b) {
        field(`${key}[${i}]`, `joins "${nameOf.get(a)}" to itself.`);
        return;
      }
      out.push([a, b]);
    });
    return out;
  };
  const crossings = readPairs("crossings");
  const blockedBorders = readPairs("blockedBorders");
  const roads = readPairs("roads");

  const pairKey = (a: string, b: string) =>
    a < b ? `${a}\0${b}` : `${b}\0${a}`;
  const blocked = new Set(blockedBorders.map(([a, b]) => pairKey(a, b)));
  for (const [list, word] of [
    [crossings, "crossing"],
    [roads, "road"],
  ] as const) {
    for (const [a, b] of list) {
      if (!blocked.has(pairKey(a, b))) continue;
      errors.push({
        code: "link-conflict",
        a,
        b,
        message: `"${nameOf.get(a)}" and "${nameOf.get(b)}" have a blocked border and a ${word}. Remove one of the two.`,
      });
    }
  }

  // Warpath markings. A map with neither end is for Conquest only.
  let warpath: ResolvedManifest["warpath"];
  const ends = [
    ["start", warpathStart],
    ["goal", warpathGoal],
  ] as const;
  for (const [end, endId] of ends) {
    if (endId === undefined || nameOf.has(endId)) continue;
    errors.push({
      code: "warpath-unknown-location",
      end,
      id: endId,
      message: `${MANIFEST_FILE}: warpath.${end} names "${endId}", which is not the id of any location.`,
    });
  }
  if ((warpathStart === undefined) !== (warpathGoal === undefined)) {
    const [has, missing] =
      warpathGoal === undefined
        ? (["start", "goal"] as const)
        : (["goal", "start"] as const);
    errors.push({
      code: "warpath-one-end",
      missing,
      message: `${MANIFEST_FILE}: warpath has a ${has} and no ${missing}. Warpath needs both. Add warpath.${missing}, or remove warpath.${has} to offer the map in Conquest only.`,
    });
  } else if (warpathStart !== undefined && warpathGoal !== undefined) {
    if (warpathStart === warpathGoal) {
      if (nameOf.has(warpathStart)) {
        errors.push({
          code: "warpath-same-location",
          id: warpathStart,
          name: nameOf.get(warpathStart) ?? warpathStart,
          message: `${MANIFEST_FILE}: the Warpath start and goal are both "${nameOf.get(warpathStart)}". They must be different locations.`,
        });
      }
    } else if (nameOf.has(warpathStart) && nameOf.has(warpathGoal)) {
      warpath = { start: warpathStart, goal: warpathGoal };
    }
    // A kind on either end would never be used, so it is the author's mistake.
    for (const [end, endId] of ends) {
      const at = all.find((l) => l.id === endId);
      const kind = at?.warpath?.kind;
      if (!at || !kind) continue;
      errors.push({
        code: "warpath-kind-on-end",
        end,
        id: at.id,
        name: at.name,
        kind,
        message: `${MANIFEST_FILE}: "${at.name}" is the Warpath ${end}, so it cannot also have the kind "${kind}". Remove the kind, or move the ${end}.`,
      });
    }
  }

  // A wrongly shaped pair list is a shape problem like the ones above.
  if (errors.some((e) => e.code === "manifest-field")) {
    return { manifest: null, errors };
  }

  return {
    manifest: {
      formatVersion: 1,
      id,
      title,
      description,
      game,
      size,
      files,
      heightScale,
      background,
      factions,
      playerFaction,
      provinces,
      locations,
      crossings,
      blockedBorders,
      roads,
      models,
      warpath,
    },
    errors,
  };
}

/** Check a location's `battle`. Absent is fine and means a blank battle. */
function readBattle(
  value: unknown,
  path: string,
  field: (path: string, problem: string) => void,
): ManifestBattle | undefined {
  if (value === undefined) return undefined;
  if (!isObj(value)) {
    field(
      path,
      'must be an object such as { "mapName": "Comet Catcher Redux" }.',
    );
    return undefined;
  }
  const b = value;
  if (typeof b.mapName !== "string" || b.mapName === "") {
    field(
      `${path}.mapName`,
      "must be the name of a map. Leave the whole battle out to have one picked.",
    );
    return undefined;
  }
  const out: ManifestBattle = { mapName: b.mapName };
  const num = (
    key: "enemyAiCount" | "startPosType" | "handicap",
    ok: (n: number) => boolean,
    rule: string,
  ) => {
    const v = b[key];
    if (v === undefined) return;
    if (typeof v === "number" && Number.isInteger(v) && ok(v)) out[key] = v;
    else field(`${path}.${key}`, `must be ${rule}.`);
  };
  // The ranges are the ones `parseGalaxyJson` clamps a stored battle to.
  num("enemyAiCount", (n) => n >= 1 && n <= 8, "a whole number from 1 to 8");
  num("startPosType", (n) => n >= 0, "a whole number, 0 or above");
  num("handicap", (n) => n >= 0 && n <= 300, "a whole number from 0 to 300");
  if (b.enemyAiKey !== undefined) {
    if (typeof b.enemyAiKey === "string" && b.enemyAiKey !== "") {
      out.enemyAiKey = b.enemyAiKey;
    } else {
      field(`${path}.enemyAiKey`, "must be text.");
    }
  }
  if (b.mapDownload !== undefined) {
    const hint = parseMapDownload(b.mapDownload);
    if (hint) out.mapDownload = hint;
    else field(`${path}.mapDownload`, "must have a springName or a searchUrl.");
  }
  if (b.modOptionValues !== undefined) {
    if (
      isObj(b.modOptionValues) &&
      Object.values(b.modOptionValues).every((v) => typeof v === "string")
    ) {
      out.modOptionValues = b.modOptionValues as Record<string, string>;
    } else {
      field(`${path}.modOptionValues`, "must map option names to text values.");
    }
  }
  if (b.disabledUnits !== undefined) {
    if (
      Array.isArray(b.disabledUnits) &&
      b.disabledUnits.every((v) => typeof v === "string")
    ) {
      out.disabledUnits = b.disabledUnits as string[];
    } else {
      field(`${path}.disabledUnits`, "must be a list of unit names.");
    }
  }
  return out;
}
