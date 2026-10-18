/**
 * How the parts pack reads on screen (#4539): which parts are one shape in
 * several colourways, the order the parts are listed in, and the words on a
 * tile.
 *
 * `shapeGroups` is the one place that decides what counts as one shape. The
 * sort here uses it, and so can anything that wants one entry per shape.
 */

import type { LegoPartInfo } from "./pack";

/** A colourway as the pack's `categories` list it, in the order it lists them. */
export interface ColourwayCategory {
  id: string;
  label: string;
}

/** One shape and the parts that are its colourways, in category order. */
export interface ShapeGroup {
  /** The `shapeId` of the group's first part in the pack. */
  key: string;
  parts: LegoPartInfo[];
}

/** The atlas row tags ("row5") the pack's tool wrote. They mean nothing to a person. */
const ROW_TAG = /^row\d+$/;

/** A part's tags without the atlas rows. */
export function visibleTags(tags: string[]): string[] {
  return tags.filter((tag) => !ROW_TAG.test(tag));
}

/** The name without its leading colourway, "grey block 1x1x1" to "block 1x1x1". */
function nameWithoutColour(
  name: string,
  categories: ColourwayCategory[],
): string {
  const lower = name.toLowerCase();
  for (const { id, label } of categories) {
    for (const word of [label, id]) {
      const prefix = `${word.toLowerCase()} `;
      if (lower.startsWith(prefix)) return lower.slice(prefix.length);
    }
  }
  return lower;
}

function sizeKey(part: LegoPartInfo): string {
  return JSON.stringify(part.bbox);
}

/**
 * The parts of the pack as shapes. Parts that share a `shapeId` are one shape.
 * The bundled pack also has a few shapes whose team colour part has its own
 * mesh, so a `shapeId` alone leaves them in separate groups. Groups with the
 * same name once the colour is taken off and the same size are joined if
 * neither has the full set of colourways and no colourway would then appear
 * twice. That keeps two different shapes that share a name and size apart.
 *
 * Groups are in the order their first part appears in `parts`. Parts within a
 * group are in the order of `categories`, and a colourway they do not list
 * comes last.
 */
export function shapeGroups(
  parts: LegoPartInfo[],
  categories: ColourwayCategory[],
): ShapeGroup[] {
  const byShape = new Map<string, LegoPartInfo[]>();
  for (const part of parts) {
    const members = byShape.get(part.shapeId);
    if (members) members.push(part);
    else byShape.set(part.shapeId, [part]);
  }

  const buckets = new Map<string, LegoPartInfo[][]>();
  for (const members of byShape.values()) {
    const first = members[0];
    const bucketKey = `${nameWithoutColour(first.name, categories)}|${sizeKey(first)}`;
    const bucket = buckets.get(bucketKey);
    if (bucket) bucket.push(members);
    else buckets.set(bucketKey, [members]);
  }

  const fullSize = Math.max(...[...byShape.values()].map((m) => m.length));
  const merged: LegoPartInfo[][] = [];
  for (const bucket of buckets.values()) {
    const open: LegoPartInfo[][] = [];
    for (const members of bucket) {
      if (members.length >= fullSize) {
        merged.push(members);
        continue;
      }
      const home = open.find(
        (other) =>
          other.length + members.length <= fullSize &&
          !other.some((a) => members.some((b) => b.colourway === a.colourway)),
      );
      if (home) home.push(...members);
      else open.push([...members]);
    }
    merged.push(...open);
  }

  const position = new Map(parts.map((part, index) => [part.id, index]));
  const place = (part: LegoPartInfo) => position.get(part.id) ?? 0;
  const rank = (colourway: string) => {
    const index = categories.findIndex((c) => c.id === colourway);
    return index < 0 ? categories.length : index;
  };
  return merged
    .map((members) => {
      const ordered = [...members].sort(
        (a, b) => rank(a.colourway) - rank(b.colourway) || place(a) - place(b),
      );
      return { key: members[0].shapeId, parts: ordered };
    })
    .sort(
      (a, b) =>
        Math.min(...a.parts.map(place)) - Math.min(...b.parts.map(place)),
    );
}

/**
 * `parts` with the colourways of each shape side by side. `groups` come from
 * the whole pack, so a search or a category that leaves some of a shape's
 * colourways out still lists the rest in the same place. A part in no group
 * goes last.
 */
export function sortByShape(
  parts: LegoPartInfo[],
  groups: ShapeGroup[],
): LegoPartInfo[] {
  const order = new Map<string, number>();
  for (const group of groups) {
    for (const part of group.parts) order.set(part.id, order.size);
  }
  const last = order.size;
  return [...parts].sort(
    (a, b) => (order.get(a.id) ?? last) - (order.get(b.id) ?? last),
  );
}

/**
 * What to call each part on a tile and in the detail panel, by part id. A name
 * more than one part has gets the part's source object names added, so two
 * tiles never read the same. Parts with no source object keep the bare name.
 */
export function partTitles(parts: LegoPartInfo[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const part of parts) {
    counts.set(part.name, (counts.get(part.name) ?? 0) + 1);
  }
  return new Map(
    parts.map((part) => [
      part.id,
      (counts.get(part.name) ?? 0) > 1 && part.sourceNames.length > 0
        ? `${part.name} (${part.sourceNames.join(", ")})`
        : part.name,
    ]),
  );
}
