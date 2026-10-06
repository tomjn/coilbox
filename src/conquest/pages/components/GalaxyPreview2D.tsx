import { useEffect, useMemo, useRef } from "react";
import type { LandPicture } from "../../landJob";
import type { GalaxyDoc, LinkKind, MapSkin } from "../../model";
import { NEUTRAL } from "../../model";

const NEUTRAL_COLOR = "#94a3b8";
/** Shown under a land map until its picture is drawn, and where it cannot be. */
const SEA_COLOR = "#183a60";

/**
 * A cheap 2D preview of a map document, drawn straight in the document's own
 * coordinate space. Pure SVG for a galaxy or a theatre: node positions, lanes
 * and capitals in faction colours. The wizard regenerates this on every knob
 * change, which would be wasteful with the three.js view.
 *
 * A document with a terrain is drawn as land. `picture` is the generator's own
 * picture of it, the one the strategic map is given, so the coast here is the
 * coast the player then plays on. Over it go the province outlines, tinted by
 * owner, and the links that are not a shared border: roads solid, crossings
 * dashed. A border is not drawn as a line, because the two outlines touching
 * already says it.
 */
/** What a screen reader calls the preview. Only a galaxy is a galaxy. */
export function previewLabel(skin: MapSkin | undefined): string {
  return skin === "galaxy" || skin === undefined
    ? "Galaxy layout preview"
    : "Map preview";
}

export function GalaxyPreview2D({
  galaxy,
  picture,
}: {
  galaxy: GalaxyDoc;
  /** The pixels of a generated land map. Without them the land has no picture
   * and only the outlines, links and markers are drawn. */
  picture?: LandPicture | null;
}) {
  const land = galaxy.terrain;
  const view = useMemo(() => {
    const xs = galaxy.nodes.map((n) => n.pos[0]);
    const ys = galaxy.nodes.map((n) => n.pos[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    // A land map is framed by its terrain, so the picture and the overlay
    // share one box. Anything else is framed by its nodes.
    const span = land
      ? Math.max(land.width, land.height)
      : Math.max(maxX - minX, maxY - minY, 1);
    const pad = span * 0.08;
    const byId = new Map(galaxy.nodes.map((n) => [n.id, n]));
    const color = new Map(galaxy.factions.map((f) => [f.id, f.color]));
    const colorOf = (owner: string) =>
      owner === NEUTRAL ? NEUTRAL_COLOR : (color.get(owner) ?? NEUTRAL_COLOR);
    const kinds = new Map<string, LinkKind>();
    for (const [a, b, kind] of galaxy.linkKinds ?? []) {
      kinds.set(`${a}:${b}`, kind);
      kinds.set(`${b}:${a}`, kind);
    }
    return {
      box: land
        ? `0 0 ${land.width} ${land.height}`
        : `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`,
      r: span * 0.014,
      provinces: galaxy.nodes.flatMap((n) =>
        (n.outline ?? []).map((ring, i) => ({
          key: `${n.id}:${i}`,
          points: ring.map(([x, y]) => `${x},${y}`).join(" "),
          owned: n.owner !== NEUTRAL,
          color: colorOf(n.owner),
        })),
      ),
      lanes: galaxy.links.flatMap(([a, b]) => {
        const na = byId.get(a);
        const nb = byId.get(b);
        const kind = kinds.get(`${a}:${b}`);
        return na && nb && kind !== "border"
          ? [
              {
                key: `${a}:${b}`,
                x1: na.pos[0],
                y1: na.pos[1],
                x2: nb.pos[0],
                y2: nb.pos[1],
                crossing: kind === "crossing",
              },
            ]
          : [];
      }),
      // A province is its outline. Only its capital gets a marker.
      stars: galaxy.nodes
        .filter((n) => !n.outline || n.kind === "capital")
        .map((n) => ({
          id: n.id,
          x: n.pos[0],
          y: n.pos[1],
          capital: n.kind === "capital",
          color: colorOf(n.owner),
        })),
    };
  }, [galaxy, land]);

  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = picture ? canvas.current?.getContext("2d") : null;
    if (!picture || !ctx) return;
    ctx.putImageData(
      new ImageData(
        new Uint8ClampedArray(picture.image),
        picture.width,
        picture.height,
      ),
      0,
      0,
    );
  }, [picture]);

  const lane = land ? "#e2e8f0" : "#334155";
  const svg = (
    <svg
      viewBox={view.box}
      className={
        land
          ? "absolute inset-0 size-full"
          : "aspect-square w-full rounded-md border border-border/50 bg-[#05070f]"
      }
      role="img"
      aria-label={previewLabel(galaxy.theme?.skin)}
    >
      {view.provinces.map((p) => (
        <polygon
          key={p.key}
          points={p.points}
          fill={p.owned ? p.color : "none"}
          fillOpacity={0.45}
          stroke="#0f172a"
          strokeOpacity={0.7}
          strokeWidth={view.r * 0.25}
          strokeLinejoin="round"
        />
      ))}
      {view.lanes.map((l) => (
        <line
          key={l.key}
          x1={l.x1}
          y1={l.y1}
          x2={l.x2}
          y2={l.y2}
          stroke={lane}
          strokeOpacity={land ? 0.8 : 1}
          strokeWidth={view.r * 0.3}
          strokeDasharray={l.crossing ? `${view.r} ${view.r}` : undefined}
        />
      ))}
      {view.stars.map((s) => (
        <circle
          key={s.id}
          cx={s.x}
          cy={s.y}
          r={s.capital ? view.r * 1.9 : view.r}
          fill={s.color}
          stroke={s.capital ? "#e2e8f0" : land ? "#0f172a" : "none"}
          strokeWidth={s.capital ? view.r * 0.35 : land ? view.r * 0.2 : 0}
        />
      ))}
    </svg>
  );
  if (!land) return svg;

  return (
    <div
      className="relative w-full overflow-hidden rounded-md border border-border/50"
      style={{
        aspectRatio: `${land.width} / ${land.height}`,
        background: SEA_COLOR,
      }}
    >
      {picture && (
        <canvas
          ref={canvas}
          width={picture.width}
          height={picture.height}
          className="absolute inset-0 size-full"
          aria-hidden
        />
      )}
      {svg}
    </div>
  );
}
