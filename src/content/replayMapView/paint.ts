import type { ReplayTrackTeam } from "../bindings";
import type { MapScene } from "./scene";

/** The canvas the scene is drawn on. `width` and `height` are its own pixels,
 *  `scale` is pixels for each elmo, and `pixelRatio` is the screen's. */
export interface MapViewport {
  width: number;
  height: number;
  scale: number;
  pixelRatio: number;
}

/** What one picture put on the canvas. */
export interface PaintCounts {
  units: number;
  projectiles: number;
  wrecks: number;
  /** Whether the unit asked to be ringed is in the picture. */
  highlighted: boolean;
}

/** The part of a 2D context the painter uses, so a test can hand it a
 *  recorder. */
export type PaintContext = Pick<
  CanvasRenderingContext2D,
  | "setTransform"
  | "clearRect"
  | "beginPath"
  | "moveTo"
  | "lineTo"
  | "closePath"
  | "rect"
  | "arc"
  | "fill"
  | "stroke"
  | "fillStyle"
  | "strokeStyle"
  | "globalAlpha"
  | "lineWidth"
>;

/** How a team's marks are coloured. */
export interface TeamStyle {
  fill: string;
  /** The line round a mark: dark round a light colour, pale round a dark. */
  edge: string;
}

/** Display choices, in CSS pixels. They are how the picture looks and bound
 *  nothing in the track. */
/** Half the smallest mark, so 1,368 units on a small map are still 3 pixels
 *  each and can be told from the ground. */
export const LEAST_HALF_MARK = 1.5;
/** How far a facing line runs past the front of its mark, at the least. */
const FACING_REACH = 2.5;
/** A projectile's line, shortest and longest, and how many frames of its
 *  travel the line stands for between the two. */
const SHOT_SHORTEST = 2;
const SHOT_LONGEST = 9;
const SHOT_FRAMES = 3;
const HALF_WRECK = 1;
/** How much of a unit shows when construction has only just started. A unit
 *  at 0 would otherwise be invisible while it is on the map. */
const FAINTEST = 0.25;

const DARK_EDGE = "rgba(9, 13, 22, 0.9)";
const PALE_EDGE = "rgba(226, 232, 240, 0.85)";
const WRECK = "rgba(148, 156, 170, 0.85)";
const SHOT = "rgba(255, 236, 170, 0.95)";
const RING = "rgba(255, 255, 255, 0.95)";
const NO_TEAM: TeamStyle = { fill: "rgb(148, 156, 170)", edge: DARK_EDGE };

/**
 * Each team's colours from the track. A colour too dark to see against the
 * dimmed map gets a pale edge, so the mark still reads as a shape.
 */
export function teamStyles(
  teams: readonly ReplayTrackTeam[],
): ReadonlyMap<number, TeamStyle> {
  const styles = new Map<number, TeamStyle>();
  for (const team of teams) {
    const [r, g, b] = team.colour;
    // Relative luminance as sRGB weights it, without the gamma step, which is
    // close enough to choose between two edges.
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    styles.set(team.id, {
      fill: `rgb(${r}, ${g}, ${b})`,
      edge: luminance < 0.25 ? PALE_EDGE : DARK_EDGE,
    });
  }
  return styles;
}

/** How much of a unit shows at a build progress of 0 to 1. */
export function buildAlpha(build: number): number {
  if (build >= 1) return 1;
  // Never as solid as a finished unit, so the two are always told apart.
  return FAINTEST + (0.85 - FAINTEST) * Math.max(build, 0);
}

/**
 * Draws a scene. Units go down a team at a time: every finished unit of a team
 * is one path, filled once, so a frame with a thousand units is a few dozen
 * canvas calls that paint and not a thousand. A unit under construction has
 * its own opacity and so its own fill.
 *
 * World x runs along the canvas and world z runs down it, as on the minimap.
 */
export function paintScene(
  ctx: PaintContext,
  scene: MapScene,
  view: MapViewport,
  teams: ReadonlyMap<number, TeamStyle>,
  highlight: number | null,
): PaintCounts {
  const { scale, pixelRatio: u } = view;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, view.width, view.height);

  if (scene.wrecks > 0) {
    const half = HALF_WRECK * u;
    ctx.beginPath();
    for (let i = 0; i < scene.wrecks; i++) {
      ctx.rect(
        scene.wreckX[i] * scale - half,
        scene.wreckZ[i] * scale - half,
        half * 2,
        half * 2,
      );
    }
    ctx.fillStyle = WRECK;
    ctx.fill();
  }

  const least = LEAST_HALF_MARK * u;
  const outline = (i: number) => {
    const cx = scene.unitX[i] * scale;
    const cz = scene.unitZ[i] * scale;
    let fx = scene.unitFx[i];
    let fz = scene.unitFz[i];
    const length = Math.hypot(fx, fz);
    if (length < 1e-6) {
      fx = 0;
      fz = 1;
    } else {
      fx /= length;
      fz /= length;
    }
    const along = Math.max(scene.unitAlong[i] * scale, least);
    const across = Math.max(scene.unitAcross[i] * scale, least);
    // The front is along (fx, fz) and the side is a quarter turn from it.
    const ax = fx * along;
    const az = fz * along;
    const sx = -fz * across;
    const sz = fx * across;
    ctx.moveTo(cx + ax + sx, cz + az + sz);
    ctx.lineTo(cx + ax - sx, cz + az - sz);
    ctx.lineTo(cx - ax - sx, cz - az - sz);
    ctx.lineTo(cx - ax + sx, cz - az + sz);
    ctx.closePath();
  };
  const facing = (i: number) => {
    const cx = scene.unitX[i] * scale;
    const cz = scene.unitZ[i] * scale;
    const fx = scene.unitFx[i];
    const fz = scene.unitFz[i];
    const length = Math.hypot(fx, fz);
    if (length < 1e-6) return;
    const along = Math.max(scene.unitAlong[i] * scale, least);
    const reach = along + Math.max(FACING_REACH * u, along * 0.6);
    ctx.moveTo(cx, cz);
    ctx.lineTo(cx + (fx / length) * reach, cz + (fz / length) * reach);
  };

  // The teams in the picture, in rising order so the order of drawing does not
  // change from one frame to the next.
  const present: number[] = [];
  for (let i = 0; i < scene.units; i++) {
    if (!present.includes(scene.unitTeam[i])) present.push(scene.unitTeam[i]);
  }
  present.sort((a, b) => a - b);

  ctx.lineWidth = u;
  let ringed = -1;
  for (const team of present) {
    const style = teams.get(team) ?? NO_TEAM;
    let built = 0;
    ctx.beginPath();
    for (let i = 0; i < scene.units; i++) {
      if (scene.unitTeam[i] !== team) continue;
      if (highlight !== null && scene.unitSerial[i] === highlight) ringed = i;
      if (scene.unitBuild[i] < 1) continue;
      outline(i);
      built++;
    }
    if (built > 0) {
      ctx.strokeStyle = style.edge;
      ctx.stroke();
      ctx.fillStyle = style.fill;
      ctx.fill();
      ctx.beginPath();
      for (let i = 0; i < scene.units; i++) {
        if (scene.unitTeam[i] === team && scene.unitBuild[i] >= 1) facing(i);
      }
      ctx.strokeStyle = style.fill;
      ctx.stroke();
    }
    for (let i = 0; i < scene.units; i++) {
      if (scene.unitTeam[i] !== team || scene.unitBuild[i] >= 1) continue;
      ctx.globalAlpha = buildAlpha(scene.unitBuild[i]);
      ctx.beginPath();
      outline(i);
      ctx.strokeStyle = style.edge;
      ctx.stroke();
      ctx.fillStyle = style.fill;
      ctx.fill();
      ctx.beginPath();
      facing(i);
      ctx.strokeStyle = style.fill;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  if (scene.projectiles > 0) {
    ctx.beginPath();
    for (let i = 0; i < scene.projectiles; i++) {
      const x = scene.shotX[i] * scale;
      const z = scene.shotZ[i] * scale;
      const vx = scene.shotVx[i];
      const vz = scene.shotVz[i];
      const speed = Math.hypot(vx, vz);
      const length = Math.min(
        Math.max(speed * scale * SHOT_FRAMES, SHOT_SHORTEST * u),
        SHOT_LONGEST * u,
      );
      // One falling straight down has no direction on the map, and is drawn
      // as the shortest line across.
      const dx = speed < 1e-6 ? 1 : vx / speed;
      const dz = speed < 1e-6 ? 0 : vz / speed;
      ctx.moveTo(x - dx * length, z - dz * length);
      ctx.lineTo(x, z);
    }
    ctx.strokeStyle = SHOT;
    ctx.stroke();
  }

  if (ringed >= 0) {
    const reach =
      Math.max(
        scene.unitAlong[ringed] * scale,
        scene.unitAcross[ringed] * scale,
        least,
      ) *
        Math.SQRT2 +
      3 * u;
    ctx.beginPath();
    ctx.arc(
      scene.unitX[ringed] * scale,
      scene.unitZ[ringed] * scale,
      reach,
      0,
      Math.PI * 2,
    );
    ctx.lineWidth = 1.5 * u;
    ctx.strokeStyle = RING;
    ctx.stroke();
  }

  return {
    units: scene.units,
    projectiles: scene.projectiles,
    wrecks: scene.wrecks,
    highlighted: ringed >= 0,
  };
}
