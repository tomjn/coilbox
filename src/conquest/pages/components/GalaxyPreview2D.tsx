import { useMemo } from "react";
import type { GalaxyDoc } from "../../model";
import { NEUTRAL } from "../../model";

/**
 * A cheap 2D constellation preview of a galaxy document: authored node
 * positions, lanes and capitals in faction colours, drawn straight in the
 * authored coordinate space. Pure SVG — the wizard regenerates this on every
 * knob change, which would be wasteful with the three.js view.
 */
export function GalaxyPreview2D({ galaxy }: { galaxy: GalaxyDoc }) {
  const view = useMemo(() => {
    const xs = galaxy.nodes.map((n) => n.pos[0]);
    const ys = galaxy.nodes.map((n) => n.pos[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const span = Math.max(maxX - minX, maxY - minY, 1);
    const pad = span * 0.08;
    const byId = new Map(galaxy.nodes.map((n) => [n.id, n]));
    const color = new Map(galaxy.factions.map((f) => [f.id, f.color]));
    return {
      box: `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`,
      r: span * 0.014,
      lanes: galaxy.links.flatMap(([a, b]) => {
        const na = byId.get(a);
        const nb = byId.get(b);
        return na && nb
          ? [
              {
                key: `${a}:${b}`,
                x1: na.pos[0],
                y1: na.pos[1],
                x2: nb.pos[0],
                y2: nb.pos[1],
              },
            ]
          : [];
      }),
      stars: galaxy.nodes.map((n) => ({
        id: n.id,
        x: n.pos[0],
        y: n.pos[1],
        capital: n.kind === "capital",
        color:
          n.owner === NEUTRAL ? "#94a3b8" : (color.get(n.owner) ?? "#94a3b8"),
      })),
    };
  }, [galaxy]);

  return (
    <svg
      viewBox={view.box}
      className="aspect-square w-full rounded-md border border-border/50 bg-[#05070f]"
      role="img"
      aria-label="Galaxy layout preview"
    >
      {view.lanes.map((l) => (
        <line
          key={l.key}
          x1={l.x1}
          y1={l.y1}
          x2={l.x2}
          y2={l.y2}
          stroke="#334155"
          strokeWidth={view.r * 0.3}
        />
      ))}
      {view.stars.map((s) => (
        <circle
          key={s.id}
          cx={s.x}
          cy={s.y}
          r={s.capital ? view.r * 1.9 : view.r}
          fill={s.color}
          stroke={s.capital ? "#e2e8f0" : "none"}
          strokeWidth={s.capital ? view.r * 0.35 : 0}
        />
      ))}
    </svg>
  );
}
