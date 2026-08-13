/**
 * What a hub item looks like, read off the container it points at.
 *
 * The hub's API hands out a description and a pointer, never the contents, so
 * the item page shipped with less on it than the website's page for the same
 * item. This is the missing half: the page fetches the container it was going
 * to fetch on Import anyway, and this turns it into something to draw.
 *
 * Pure, with no React and no fetching in it, so the readers can be tested
 * against real payloads. `./pages/components/ItemPreview.tsx` draws what comes
 * out.
 *
 * A kind whose payload says nothing readable yields null and nothing is drawn.
 * A placeholder box reads as broken where an absence reads as a page that had
 * nothing to add.
 *
 * The counterpart on the website is `components/ItemPreview.tsx` and
 * `lib/gallery/*` in tomjn/coilbox-hub, which had to vendor coilbox's galaxy
 * generator and mirror its validation to do this. Here both are the originals:
 * `parseConquestChallengeSettings` and `generateGalaxy` are the same functions
 * the app generates a real galaxy with, so a preview cannot drift from it.
 */

import { BUILD_SQUARE, facedFootprint } from "@/blueprint/footprint";
import {
  type BlueprintPayload,
  declaredFootprint,
  ONE_BUILD_SQUARE,
  parseBlueprintPayload,
} from "@/blueprint/payload";
import {
  optionsFromChallenge,
  parseConquestChallengeSettings,
} from "@/conquest/challenge";
import { generateGalaxy } from "@/conquest/generate";
import { type GalaxyDoc, NEUTRAL, type NodePos } from "@/conquest/model";
import type { Container } from "@/container/container";
import { type Participant, RANDOM_SIDE, type Rgb } from "@/play/participants";

/** A labelled fact, ready to draw. Values are strings because a layout name is
 * as much a fact about a challenge as its system count. */
export interface PreviewStat {
  label: string;
  value: string;
}

/** One row of a preset's composition, with everything already resolved: the
 * component draws it and decides nothing. */
export interface PresetMember {
  /** The participant's own id, or its position when the payload carries none.
   * Two open slots on one team look identical, so the row needs an identity of
   * its own to be drawn as a list. */
  id: string;
  label: string;
  /** The faction, or null when the preset leaves it to the engine. */
  side: string | null;
  /** A CSS colour, ready for a swatch. */
  color: string;
}

export interface PresetTeam {
  allyTeam: number;
  members: PresetMember[];
}

/** One system in a rebuilt galaxy, positioned in a unit square. */
export interface GalaxySystem {
  /** The generated node's id. */
  id: string;
  x: number;
  y: number;
  /** Index into {@link GalaxyShape.factionColors}, or null for neutral. */
  faction: number | null;
  capital: boolean;
}

export interface GalaxyShape {
  systems: GalaxySystem[];
  /** Jump lanes, as index pairs into {@link GalaxyShape.systems}. */
  lanes: [number, number][];
  /** Player first, then enemies. */
  factionColors: string[];
}

/** One building, as a rectangle inside the box below. Build squares throughout,
 * measured from the top left of the box. */
export interface BlueprintSquare {
  def: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Whether the payload said what this def stands on. False is a building
   *  standing on one square because nothing said otherwise, which is worth
   *  drawing differently from one square somebody measured. */
  sized: boolean;
}

/** A layout as squares on a grid. */
export interface BlueprintShape {
  /** The box every square fits inside, in build squares. */
  width: number;
  height: number;
  /** In the payload's own order, which is the build order when `ordered`. */
  squares: BlueprintSquare[];
  ordered: boolean;
}

export type HubPreview =
  | { kind: "preset"; teams: PresetTeam[]; playing: number }
  | { kind: "setup-pack"; stats: PreviewStat[] }
  | { kind: "challenge"; galaxy: GalaxyShape | null; stats: PreviewStat[] }
  | { kind: "scenario"; stats: PreviewStat[] }
  | { kind: "blueprint"; layout: BlueprintShape };

/**
 * Read a container into something drawable, or null when there is nothing to
 * draw. Never throws: this runs on a file somebody else published, so a payload
 * that is not the shape its kind claims must cost a preview and nothing more.
 */
export function readPreview(container: Container): HubPreview | null {
  const payload = container.payload;
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as Record<string, unknown>;
  try {
    switch (container.kind) {
      case "preset":
        return presetPreview(record);
      case "setup-pack":
        return setupPackPreview(record);
      case "challenge":
        return challengePreview(record);
      case "scenario":
        return scenarioPreview(record);
      case "blueprint":
        return blueprintPreview(record);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * A preset's composition: who is on which side, in which colour.
 *
 * Composition rather than a map diagram because that is what the payload
 * describes. A participant holds a side, a colour, an ally team and a slot, and
 * `startPosType` only says how positions get chosen at launch, so there are no
 * start positions to draw.
 */
function presetPreview(payload: Record<string, unknown>): HubPreview | null {
  const participants = (
    Array.isArray(payload.participants) ? payload.participants : []
  ) as Partial<Participant>[];
  // `spectator` is only meaningful on the "you" row, and a preset where nobody
  // is playing has no composition to show.
  const playing = participants.filter((p) => !p.spectator);
  if (playing.length === 0) return null;

  const byTeam = new Map<number, PresetMember[]>();
  playing.forEach((p, i) => {
    const key = p.allyTeam ?? 0;
    byTeam.set(key, [...(byTeam.get(key) ?? []), member(p, i)]);
  });
  const teams = [...byTeam.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([allyTeam, members]) => ({ allyTeam, members }));

  return { kind: "preset", teams, playing: playing.length };
}

function member(p: Partial<Participant>, index: number): PresetMember {
  return {
    id: p.id ?? `slot-${index}`,
    label: memberLabel(p),
    side: sideLabel(p.side),
    color: css(p.color),
  };
}

function memberLabel(p: Partial<Participant>): string {
  if (p.kind === "you") return p.name || "You";
  return p.ai?.name || p.ai?.shortName || p.name || "Open slot";
}

function sideLabel(side: string | undefined): string | null {
  if (!side) return null;
  return side === RANDOM_SIDE ? "Random" : side;
}

/** Play-side colours are floats from 0 to 1, not bytes: reading them as bytes
 * draws everything black, which this codebase has got wrong in the other
 * direction before. A missing or out-of-range component clamps rather than
 * putting `NaN` in a CSS string. */
function css(color: Rgb | undefined): string {
  const to = (v: number | undefined) =>
    Math.round(Math.min(1, Math.max(0, v ?? 0)) * 255);
  const [r, g, b] = color ?? [];
  return `rgb(${to(r)} ${to(g)} ${to(b)})`;
}

/** A pack has no picture in it. What it has is a list of what it will install,
 * and saying that plainly is more use than a diagram of nothing. */
function setupPackPreview(payload: Record<string, unknown>): HubPreview | null {
  const games = gameNames(payload);
  const maps = (Array.isArray(payload.maps) ? payload.maps : []).filter(
    (m): m is string => typeof m === "string",
  );
  const engine =
    typeof payload.engineVersion === "string" ? payload.engineVersion : "";
  if (games.length === 0 && maps.length === 0 && !engine) return null;

  return {
    kind: "setup-pack",
    stats: [
      {
        label: games.length === 1 ? "Game" : "Games",
        value: games.length === 0 ? "None" : games.join(", "),
      },
      // ".spring" is the placeholder a pack carries when it does not pin an
      // engine, which means whatever the importer already has.
      {
        label: "Engine",
        value: engine && engine !== ".spring" ? engine : "Whatever you have",
      },
      {
        label: maps.length === 1 ? "Map" : "Maps",
        value: maps.length === 0 ? "None" : maps.join(", "),
      },
    ],
  };
}

/** The names of a pack's games, reading the collection shape (`games`) and
 * falling back to the single-game shape (`game`) every pack carried before it
 * became a collection. */
function gameNames(payload: Record<string, unknown>): string[] {
  if (Array.isArray(payload.games)) {
    return payload.games
      .map((g) =>
        typeof g === "object" && g !== null
          ? (g as { name?: unknown }).name
          : undefined,
      )
      .filter((name): name is string => typeof name === "string" && !!name);
  }
  const game = payload.game as { name?: string } | undefined;
  return game?.name ? [game.name] : [];
}

/**
 * A conquest or warpath challenge. A conquest one is drawn, because the galaxy
 * is the thing somebody would recognise. A warpath one has numbers and no
 * picture, so it gets the numbers.
 */
function challengePreview(payload: Record<string, unknown>): HubPreview | null {
  const settings = payload.settings as Record<string, unknown> | undefined;
  if (typeof settings !== "object" || settings === null) return null;

  if (payload.mode === "conquest") {
    const parsed = parseConquestChallengeSettings(settings);
    if (!parsed) return null;
    return {
      kind: "challenge",
      galaxy: rebuildGalaxy(parsed),
      stats: [
        { label: "Systems", value: String(parsed.nodeCount) },
        // `factionCount` is the enemy count. The app's own wizard calls it
        // "enemy factions", and the drawing has the player as a colour too.
        { label: "Enemies", value: String(parsed.factionCount) },
        { label: "Layout", value: parsed.layout },
      ],
    };
  }

  if (payload.mode === "warpath") {
    const stats: PreviewStat[] = [];
    if (typeof settings.length === "string") {
      stats.push({ label: "Length", value: settings.length });
    }
    if (typeof settings.difficulty === "number") {
      stats.push({ label: "Difficulty", value: String(settings.difficulty) });
    }
    if (typeof settings.ascension === "number" && settings.ascension > 0) {
      stats.push({ label: "Ascension", value: String(settings.ascension) });
    }
    return stats.length > 0 ? { kind: "challenge", galaxy: null, stats } : null;
  }

  return null;
}

/**
 * Rebuild the galaxy the challenge would generate.
 *
 * Positions, lanes, capitals and starting territory are all settled before the
 * generator first touches installed content, so passing it no maps and no
 * naming pools gives the graph every machine gets. What is deliberately not
 * rebuilt is anything installed content decides: the map on each system, and a
 * game's lore faction names. Neither is drawn.
 */
function rebuildGalaxy(
  settings: Parameters<typeof optionsFromChallenge>[0],
): GalaxyShape | null {
  try {
    const galaxy = generateGalaxy(
      optionsFromChallenge(settings, { maps: [] }, "hub-preview"),
    );
    return galaxy.nodes.length > 0 ? shapeOf(galaxy) : null;
  } catch {
    return null;
  }
}

/** Scatter positions are 2D and real-star ones are 3D light years. Both are
 * drawn on the plane the app draws them on, which is x against y. */
const plane = (pos: NodePos): [number, number] => [pos[0], pos[1]];

/**
 * Fit the systems into a unit square without stretching them. Both axes are
 * scaled by the larger span, so a galaxy wider than it is tall stays that way
 * rather than being squared up into a different shape.
 */
function normalise(points: [number, number][]): [number, number][] {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX;
  const spanY = Math.max(...ys) - minY;
  const span = Math.max(spanX, spanY);
  // One system, or several stacked on a point, has no span to divide by.
  if (span === 0) return points.map(() => [0.5, 0.5]);
  const padX = (span - spanX) / 2;
  const padY = (span - spanY) / 2;
  return points.map(([x, y]) => [
    (x - minX + padX) / span,
    (y - minY + padY) / span,
  ]);
}

function shapeOf(galaxy: GalaxyDoc): GalaxyShape {
  const index = new Map(galaxy.nodes.map((node, i) => [node.id, i]));
  const factionIndex = new Map(galaxy.factions.map((f, i) => [f.id, i]));
  const positions = normalise(galaxy.nodes.map((node) => plane(node.pos)));

  return {
    systems: galaxy.nodes.map((node, i) => ({
      id: node.id,
      x: positions[i][0],
      y: positions[i][1],
      faction:
        node.owner === NEUTRAL ? null : (factionIndex.get(node.owner) ?? null),
      capital: node.kind === "capital",
    })),
    lanes: galaxy.links.flatMap(([a, b]) => {
      const from = index.get(a);
      const to = index.get(b);
      return from === undefined || to === undefined
        ? []
        : [[from, to] as [number, number]];
    }),
    factionColors: galaxy.factions.map((f) => f.color),
  };
}

/** A scenario is a lot of moving parts and no picture. The counts say how much
 * there is to it, which is what somebody deciding whether to play it wants. */
function scenarioPreview(payload: Record<string, unknown>): HubPreview | null {
  // A scenario export wraps the document beside its dialogue media, so the
  // shape to read is the wrapper. A bare document is accepted too.
  const scenario = (payload.scenario ?? payload) as Record<string, unknown>;
  const stats = [
    { label: "Objectives", n: count(scenario.objectives) },
    { label: "Triggers", n: count(scenario.triggers) },
    { label: "Zones", n: count(scenario.zones) },
    { label: "Teams", n: count(scenario.teams) },
    { label: "Actors", n: count(scenario.actors) },
    { label: "Dialogue", n: count(scenario.dialogue) },
  ]
    .filter((s) => s.n > 0)
    .map((s) => ({ label: s.label, value: String(s.n) }));

  return stats.length > 0 ? { kind: "scenario", stats } : null;
}

/** How many, for a list or for a keyed record. `teams` is keyed by participant
 * id, the rest are arrays. */
function count(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return Object.keys(value).length;
  return 0;
}

/**
 * Ground left clear on each side of a building, in build squares.
 *
 * Buildings in a real base stand shoulder to shoulder, and squares drawn true to
 * size would touch and read as one shape. Taking the gap off each building
 * rather than adding it between them keeps the layout to scale: the distance
 * between two buildings stays what the author placed.
 */
export const BUILDING_GAP = 0.12;

/**
 * A layout as squares on a grid, the same drawing the website makes of the same
 * container (tomjn/coilbox-hub#84), down to the gap and the arithmetic.
 *
 * A building is a square because neither side has unit models or unit pictures.
 * What stops that being a diagram of nothing is the footprint, which travels in
 * the payload for exactly this, so a factory really is bigger than a solar
 * collector here.
 *
 * Two things the payload measures in different units meet here. Offsets are in
 * elmos and footprints are in build squares, so everything is converted to build
 * squares, which is also what makes a sensible `viewBox`.
 *
 * Positions are drawn where the layout puts them. The engine snaps a building to
 * the build grid when it is placed and the editor snaps as it is drawn, so a
 * layout made here arrives on the grid already.
 */
function blueprintPreview(payload: Record<string, unknown>): HubPreview | null {
  const blueprint = parseBlueprintPayload(payload);
  const layout = blueprint ? blueprintShape(blueprint) : null;
  return layout ? { kind: "blueprint", layout } : null;
}

/**
 * A layout as squares, or null when there is nothing in it to draw.
 *
 * Separate from the container reader above because the blueprint library draws
 * the same picture on its cards (issue #1415), from a layout it holds rather
 * than one it was sent. Two drawings of one base that differ are worse than
 * either on its own, so there is one arithmetic and both callers use it.
 */
export function blueprintShape(
  blueprint: BlueprintPayload,
): BlueprintShape | null {
  if (blueprint.buildings.length === 0) return null;

  const rects = blueprint.buildings.map((building) => {
    const declared = declaredFootprint(blueprint, building.def);
    // A 3 by 2 building faced east stands on 2 by 3 of the ground.
    const faced = facedFootprint(declared ?? ONE_BUILD_SQUARE, building.facing);
    // An offset is the middle of the building, so the ground it stands on
    // reaches half a footprint either side of it.
    return {
      def: building.def,
      sized: declared !== undefined,
      left: building.offset.x / BUILD_SQUARE - faced.x / 2,
      top: building.offset.z / BUILD_SQUARE - faced.z / 2,
      width: faced.x,
      height: faced.z,
    };
  });

  // Measured from the layout rather than from zero. Offsets run out from the
  // origin in both directions, so a box starting at zero would leave half the
  // base outside the picture.
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.left + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.top + rect.height));

  return {
    width: right - left,
    height: bottom - top,
    ordered: blueprint.ordered === true,
    squares: rects.map((rect) => ({
      def: rect.def,
      sized: rect.sized,
      x: rect.left - left + BUILDING_GAP,
      y: rect.top - top + BUILDING_GAP,
      // A footprint is at least one square, so this never reaches zero.
      width: rect.width - BUILDING_GAP * 2,
      height: rect.height - BUILDING_GAP * 2,
    })),
  };
}

/**
 * Clear ground round the layout, in build squares.
 *
 * What makes the drawing a plan on a sheet rather than a base cropped to its own
 * edge, which is the difference the welcome screen's illustration has over the
 * preview (issue #1506). One square is enough to read as room round the base and
 * little enough that it does not shrink the base to make room for nothing.
 */
export const SHEET_MARGIN = 1;

/**
 * The biggest a build square is ever drawn, in CSS pixels.
 *
 * Without this a two building layout fills the box it is given, and a base is
 * drawn at whatever zoom makes it fill the space rather than at a size that says
 * how big it is. Sixteen pixels is a generous build square, so only a layout
 * small enough to look silly blown up is held back to it.
 */
const MOST_PX_PER_SQUARE = 16;

/**
 * The smallest a build square can be drawn and still be worth ruling, in CSS
 * pixels.
 *
 * Below this the rules are closer together than the eye can separate and the grid
 * becomes grey fill, which says less than a blank sheet does. A base that big gets
 * no grid rather than a grid nobody can read.
 */
const LEAST_RULED_PX = 3;

/** The box a plan is drawn in, in CSS pixels. Both sides are positive. */
export interface PlanBox {
  width: number;
  height: number;
}

/** The sheet a layout is drawn on: the box to draw, and the rule over it. */
export interface BlueprintSheet {
  /** The `viewBox`, in the layout's own build squares. It covers the whole box
   *  the plan is drawn in, with the layout centred on it. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** How many CSS pixels one build square is drawn at. What lets the drawing
   *  choose weights in pixels, the way its strokes already do. */
  scale: number;
  /** Where the grid lines fall, down the sheet then across it. Empty when a
   *  build square is too small to rule. */
  verticals: number[];
  horizontals: number[];
}

/**
 * The sheet to draw a layout on, given the box it is drawn in.
 *
 * Every build square is ruled, and the rules run the whole box rather than a
 * patch in the middle of it (issue #1508). Both follow from what a plan is for.
 *
 * Ruling every build square is what makes the grid true. A footprint stands on
 * whole build squares, so on a grid of single squares every building edge lands on
 * a rule. A coarser grid cannot do that: a five square solar collector on rules
 * every second square straddles them, and a grid the buildings ignore is worse
 * than no grid, because it invites exactly the reading it then contradicts. What
 * a big base costs is therefore weight rather than truth. The rules close up, the
 * drawing fades them, and past {@link LEAST_RULED_PX} it stops drawing them.
 *
 * Running them the whole box is what makes it a sheet. Sized to the layout, the
 * grid was a patch of graph paper floating on a blank card. The layout keeps its
 * clear ground on all sides, {@link SHEET_MARGIN}, and then the sheet grows out to
 * the box on whichever side has room.
 */
export function blueprintSheet(
  shape: BlueprintShape,
  box: PlanBox,
): BlueprintSheet {
  const across = shape.width + SHEET_MARGIN * 2;
  const down = shape.height + SHEET_MARGIN * 2;
  // Fit the layout and its clear ground, without stretching one axis past the
  // other, and without blowing a small base up to fill the box.
  const scale = Math.min(
    box.width / across,
    box.height / down,
    MOST_PX_PER_SQUARE,
  );
  const width = box.width / scale;
  const height = box.height / scale;
  // The layout runs from zero to its own width, so centring it puts the same
  // amount of sheet on each side of it.
  const left = (shape.width - width) / 2;
  const top = (shape.height - height) / 2;
  const ruled = scale >= LEAST_RULED_PX;
  return {
    left,
    top,
    width,
    height,
    scale,
    verticals: ruled ? rules(left, left + width) : [],
    horizontals: ruled ? rules(top, top + height) : [],
  };
}

/** Every build square boundary inside the sheet. Counted off the layout's own
 *  origin rather than the sheet's edge, so the rules line up with the buildings
 *  rather than with the margin. */
function rules(from: number, to: number): number[] {
  const out: number[] = [];
  for (let at = Math.ceil(from); at <= to; at += 1) {
    // The rule on the origin comes out of that arithmetic as `-0`, which is a
    // value of its own to anything reading these back.
    out.push(at === 0 ? 0 : at);
  }
  return out;
}
