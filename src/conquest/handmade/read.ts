import {
  MapRouteError,
  type MapRunKind,
  routeAcrossMap,
} from "../../runlite/mapRun";
import type { GalaxyDoc, GalaxyNode, LinkKind, NodeBattleSpec } from "../model";
import { MIN_DIFFICULTY, NEUTRAL } from "../model";
import { type TraceCache, traceCacheKey } from "./cache";
import type { HandmadeMapError } from "./errors";
import { describeProvince, MANIFEST_FILE, parseManifest } from "./manifest";
import { type ProvincePixels, type TracedMap, traceProvinces } from "./trace";

/**
 * What a location's battle holds when the author left it out: an empty map
 * name. `NodeBattleSpec` has no optional form, and an empty name is the one
 * value `parseGalaxyJson` already treats as "no playable battle", so nothing
 * can launch it by mistake. Starting a conquest fills these from the
 * difficulty tiers (issue #3509). Test with {@link hasBlankBattle}.
 */
export const BLANK_BATTLE_MAP = "";

/** Whether the author left this location's battle for coilbox to pick. */
export function hasBlankBattle(node: { battle: NodeBattleSpec }): boolean {
  return node.battle.mapName === BLANK_BATTLE_MAP;
}

export interface HandmadeMapInput {
  /** The text of `map.json`, as read from the folder. */
  manifest: string;
  /** The province image, decoded. */
  provinces: ProvincePixels;
  /** The size of the map picture in pixels. Its pixels are not needed. */
  picture: { width: number; height: number };
  /**
   * Turn a file name from the manifest into a URL the webview can load, or
   * undefined when the folder has no such file.
   */
  urlFor: (fileName: string) => string | undefined;
  /** Keeps traced maps between reads. Without one, every read traces. */
  cache?: TraceCache;
  /** The `createdAt` and `updatedAt` of the document. Defaults to empty. */
  now?: string;
}

export type HandmadeMapResult =
  | { ok: true; doc: GalaxyDoc }
  | { ok: false; errors: HandmadeMapError[] };

const pairKey = (a: string, b: string) => (a < b ? `${a}\0${b}` : `${b}\0${a}`);

/** Map units are arbitrary, so three decimals is finer than any picture. */
const round = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Read a hand-made map folder into a galaxy document, or list everything that
 * is wrong with it.
 *
 * Errors come in two passes at most. A `map.json` that is not JSON, or has a
 * missing or wrong key, is reported alone, because nothing else can be trusted
 * until it is fixed. After that, every remaining problem with the manifest and
 * the images is reported together. The one exception is the check that every
 * location can be reached: it is skipped while a colour is unlisted or
 * unpainted or a link names an unknown location, since each of those makes
 * provinces look cut off when they are not. The Warpath route from the start
 * to the goal is skipped then too, for the same reason.
 */
export function readHandmadeMap(input: HandmadeMapInput): HandmadeMapResult {
  const { manifest, errors } = parseManifest(input.manifest);
  if (!manifest) return { ok: false, errors };

  const { provinces: image, picture } = input;
  if (image.width !== picture.width || image.height !== picture.height) {
    errors.push({
      code: "size-mismatch",
      provinces: { width: image.width, height: image.height },
      picture: { width: picture.width, height: picture.height },
      message: `The province image "${manifest.files.provinces}" is ${image.width} by ${image.height} pixels and the map picture "${manifest.files.picture}" is ${picture.width} by ${picture.height}. They must be the same size.`,
    });
  }

  const url = (what: string, file: string): string => {
    const found = input.urlFor(file);
    if (found !== undefined) return found;
    errors.push({
      code: "file-missing",
      file,
      message: `${MANIFEST_FILE} names the ${what} "${file}", but the folder has no file with that name.`,
    });
    return "";
  };
  const pictureUrl = url("picture", manifest.files.picture);
  const heightmapUrl =
    manifest.files.heightmap === undefined
      ? undefined
      : url("heightmap", manifest.files.heightmap);

  manifest.models.forEach((placed, i) => {
    if (!("file" in placed.model)) return;
    const { file } = placed.model;
    if (input.urlFor(file) !== undefined) return;
    errors.push({
      code: "file-missing",
      file,
      message: `${MANIFEST_FILE}: models[${i}] names the model file "${file}", but the folder has no file with that name.`,
    });
  });

  const key = input.cache ? traceCacheKey(input.manifest, image) : "";
  let traced: TracedMap | undefined = input.cache?.get(key);
  if (!traced) {
    traced = traceProvinces({
      image,
      colors: manifest.provinces.map((p) => p.color),
      background: manifest.background,
    });
    input.cache?.set(key, traced);
  }

  let traceTrusted = !errors.some((e) => e.code === "unknown-location");
  for (const region of traced.unlisted) {
    traceTrusted = false;
    errors.push({
      code: "color-not-listed",
      ...region,
      message: `The province image has the colour ${region.color} at pixel ${region.x}, ${region.y} (counted from the top left), but ${MANIFEST_FILE} lists no province with that colour. Add a province for it, or repaint the area.`,
    });
  }
  manifest.provinces.forEach((p, i) => {
    if (traced.provinces[i]) return;
    traceTrusted = false;
    errors.push({
      code: "province-not-painted",
      id: p.id,
      name: p.name,
      color: p.color,
      message: `The province ${describeProvince(p.name, p.color)} is listed in ${MANIFEST_FILE}, but its colour is not painted anywhere on the province image. Check the colour matches exactly.`,
    });
  });

  // Pixels to map units.
  const sx = manifest.size.width / image.width;
  const sy = manifest.size.height / image.height;

  const battleOf = (battle: NodeBattleSpec | undefined): NodeBattleSpec =>
    battle ?? { mapName: BLANK_BATTLE_MAP };
  const nodes: GalaxyNode[] = [];
  /** How each location is named in a message, by id. */
  const described = new Map<string, string>();
  manifest.provinces.forEach((p, i) => {
    const shape = traced.provinces[i];
    described.set(p.id, describeProvince(p.name, p.color));
    if (!shape) return;
    nodes.push({
      id: p.id,
      name: p.name,
      pos: p.anchor ?? [
        round(shape.anchor[0] * sx),
        round(shape.anchor[1] * sy),
      ],
      outline: shape.pieces.map((ring) =>
        ring.map(([x, y]): [number, number] => [round(x * sx), round(y * sy)]),
      ),
      owner: p.owner ?? NEUTRAL,
      kind: p.capital ? "capital" : undefined,
      difficulty: p.difficulty ?? MIN_DIFFICULTY,
      blurb: p.blurb,
      battle: battleOf(p.battle),
    });
  });
  for (const l of manifest.locations) {
    described.set(l.id, `"${l.name}"`);
    nodes.push({
      id: l.id,
      name: l.name,
      pos: l.pos,
      owner: l.owner ?? NEUTRAL,
      kind: l.capital ? "capital" : undefined,
      difficulty: l.difficulty ?? MIN_DIFFICULTY,
      blurb: l.blurb,
      battle: battleOf(l.battle),
    });
  }

  // Neighbours from the paint, then the manifest's changes to them. A road or
  // a crossing along an open border renames that link and does not add one.
  const kinds = new Map<string, [string, string, LinkKind]>();
  for (const [a, b] of traced.borders) {
    const pa = manifest.provinces[a].id;
    const pb = manifest.provinces[b].id;
    kinds.set(pairKey(pa, pb), [pa, pb, "border"]);
  }
  const blockedBorders: [string, string][] = [];
  for (const [a, b] of manifest.blockedBorders) {
    if (kinds.delete(pairKey(a, b))) {
      blockedBorders.push([a, b]);
      continue;
    }
    const painted = (id: string) => nodes.some((n) => n.id === id && n.outline);
    // An unpainted province already has its own error.
    if (!traceTrusted && !(painted(a) && painted(b))) continue;
    errors.push({
      code: "blocked-border-not-touching",
      a,
      b,
      message: `${MANIFEST_FILE} blocks the border between ${described.get(a)} and ${described.get(b)}, but they do not touch on the province image.`,
    });
  }
  for (const [a, b] of manifest.crossings) {
    kinds.set(pairKey(a, b), [a, b, "crossing"]);
  }
  for (const [a, b] of manifest.roads) {
    kinds.set(pairKey(a, b), [a, b, "road"]);
  }
  const linkKinds = [...kinds.values()];

  if (traceTrusted) {
    for (const stranded of findUnreachable(nodes, linkKinds)) {
      const node = stranded.node;
      const who = described.get(node.id);
      const company =
        stranded.group.length === 0
          ? "Nothing touches it."
          : `It is joined only to ${stranded.group.map((id) => described.get(id)).join(", ")}.`;
      errors.push({
        code: "unreachable",
        id: node.id,
        name: node.name,
        color: manifest.provinces.find((p) => p.id === node.id)?.color,
        message: `${node.outline ? "The province" : "The location"} ${who} cannot be reached from the rest of the map. ${company} Add a crossing or a road in ${MANIFEST_FILE}, or paint it so it touches a neighbour.`,
      });
    }
  }

  // The same route a run takes, so a map the reader accepts is one a run can
  // cross. It fails today only when the start or the goal is cut off from the
  // other, which is reported above as well.
  const links = linkKinds.map(([a, b]): [string, string] => [a, b]);
  const { warpath } = manifest;
  if (warpath && traceTrusted) {
    try {
      routeAcrossMap({ nodes, links }, warpath.start, warpath.goal);
    } catch (e) {
      if (!(e instanceof MapRouteError)) throw e;
      errors.push({
        code: "warpath-route",
        startId: warpath.start,
        goalId: warpath.goal,
        message: `A Warpath run cannot get from the start ${described.get(warpath.start)} to the goal ${described.get(warpath.goal)}. Join them with a crossing or a road in ${MANIFEST_FILE}, or paint the land between them so it touches.`,
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const warpathKinds: Record<string, MapRunKind> = {};
  for (const l of [...manifest.provinces, ...manifest.locations]) {
    if (l.warpath?.kind) warpathKinds[l.id] = l.warpath.kind;
  }

  const playable = manifest.factions.filter((f) => f.playable !== false);
  const now = input.now ?? "";
  return {
    ok: true,
    doc: {
      schemaVersion: 1,
      id: manifest.id,
      type: "conquest-galaxy",
      title: manifest.title,
      description: manifest.description ?? "",
      game: manifest.game,
      playerFactionId: manifest.playerFaction ?? playable[0].id,
      playableFactionIds: playable.map((f) => f.id),
      factions: manifest.factions.map(({ playable: _playable, ...f }) => f),
      nodes,
      links,
      terrain: {
        image: pictureUrl,
        heightmap: heightmapUrl,
        width: manifest.size.width,
        height: manifest.size.height,
        heightScale: manifest.heightScale,
        projection: "flat",
      },
      linkKinds,
      blockedBorders: blockedBorders.length > 0 ? blockedBorders : undefined,
      models: manifest.models.length > 0 ? manifest.models : undefined,
      theme: { skin: "theatre" },
      ...(warpath
        ? {
            warpath: {
              startId: warpath.start,
              goalId: warpath.goal,
              kinds: warpathKinds,
            },
          }
        : {}),
      createdAt: now,
      updatedAt: now,
    },
  };
}

/**
 * The locations with no route to the main body of the map, which is the
 * largest group of joined locations. `group` is the other locations each one
 * can still reach.
 */
function findUnreachable(
  nodes: GalaxyNode[],
  links: [string, string, LinkKind][],
): { node: GalaxyNode; group: string[] }[] {
  const next = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const [a, b] of links) {
    next.get(a)?.push(b);
    next.get(b)?.push(a);
  }
  const groupOf = new Map<string, string[]>();
  let main: string[] = [];
  for (const n of nodes) {
    if (groupOf.has(n.id)) continue;
    const group = [n.id];
    groupOf.set(n.id, group);
    for (let i = 0; i < group.length; i++) {
      for (const id of next.get(group[i]) ?? []) {
        if (groupOf.has(id)) continue;
        groupOf.set(id, group);
        group.push(id);
      }
    }
    if (group.length > main.length) main = group;
  }
  return nodes
    .filter((n) => groupOf.get(n.id) !== main)
    .map((n) => ({
      node: n,
      group: (groupOf.get(n.id) ?? []).filter((id) => id !== n.id),
    }));
}
