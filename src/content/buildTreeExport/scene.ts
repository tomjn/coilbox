/**
 * Pure SVG scene generator for one exported faction. Emits a static `<svg>`
 * whose nodes/edges carry `data-*` hooks the runtime (`runtime.ts`) toggles for
 * hover-highlight and pan/zoom, plus a matching minimap `<svg>`. No React Flow —
 * edges are plain cubic-bezier paths, nodes plain `<g>` groups.
 */

import { type ExportEdge, type ExportFaction, NODE_H, NODE_W } from "./types";

/** Escape text for use in an XML/HTML text node or a double-quoted attribute. */
export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Ring colour per unit kind, mirroring `BuildTreeDrawer`. */
const RING: Record<string, string> = {
  commander: "#60a5fa",
  builder: "#facc15",
  mobile: "#fb7185",
  building: "#94a3b8",
};

/** Minimap dot colour per unit kind (bright, opaque — mirrors the app minimap). */
const DOT: Record<string, string> = {
  commander: "#60a5fa",
  builder: "#fde047",
  mobile: "#fb7185",
  building: "#e5e7eb",
};

/** Cubic-bezier path from a source node's bottom-centre to a target's top-centre.
 * A vertical S-curve — deterministic and dependency-free, standing in for React
 * Flow's smoothstep. */
function edgePath(
  s: { x: number; y: number },
  t: { x: number; y: number },
): string {
  const sx = s.x + NODE_W / 2;
  const sy = s.y + NODE_H;
  const tx = t.x + NODE_W / 2;
  const ty = t.y;
  const my = (sy + ty) / 2;
  return `M${sx},${sy} C${sx},${my} ${tx},${my} ${tx},${ty}`;
}

/** The `<g>` of edge `<path>`s. Rendered before nodes so nodes sit on top. */
function renderEdges(
  edges: ExportEdge[],
  pos: Map<string, { x: number; y: number }>,
): string {
  const paths: string[] = [];
  for (const e of edges) {
    const s = pos.get(e.source);
    const t = pos.get(e.target);
    if (!s || !t) continue;
    const cls = e.extra ? "edge edge-extra" : "edge";
    paths.push(
      `<path class="${cls}" data-src="${esc(e.source)}" data-tgt="${esc(
        e.target,
      )}" d="${edgePath(s, t)}" />`,
    );
  }
  return `<g class="edges">${paths.join("")}</g>`;
}

/** One node `<g>`: a rounded rect ring, the build-pic (or a placeholder), and the
 * clamped label. `href(id)` resolves the pic reference (inline data URL for the
 * single-file html, a relative `images/` path for the zip) or undefined. */
function renderNode(
  n: ExportFaction["nodes"][number],
  href: (id: string) => string | undefined,
): string {
  const ring = RING[n.kind] ?? RING.building;
  const pad = 6;
  const img = NODE_W - pad * 2;
  const src = href(n.id);
  const why = n.noPic?.title ? `<title>${esc(n.noPic.title)}</title>` : "";
  const pic = src
    ? `<image class="pic" href="${esc(src)}" x="${pad}" y="${pad}" width="${img}" height="${img}" preserveAspectRatio="xMidYMid meet" />`
    : `<g class="nopic-box">${why}<rect class="nopic" x="${pad}" y="${pad}" width="${img}" height="${img}" rx="4" /><text class="nopic-label" x="${NODE_W / 2}" y="${pad + img / 2}">${esc(n.noPic?.label ?? "no pic")}</text></g>`;
  // Two-line clamp: crude wrap by splitting the label in half on a space when long.
  const label = esc(n.label);
  return `<g class="node" data-id="${esc(n.id)}" data-kind="${n.kind}" transform="translate(${n.x},${n.y})" tabindex="0" role="listitem" aria-label="${label}">
<rect class="ring" width="${NODE_W}" height="${NODE_H}" rx="8" style="stroke:${ring}" />
${pic}
<text class="label" x="${NODE_W / 2}" y="${pad + img + 14}">${label}</text>
</g>`;
}

/** Minimap: a scaled overview of the scene (dots per node) plus a `viewport`
 * rect the runtime moves. Fixed 180px wide; height scaled to the scene aspect. */
function renderMinimap(f: ExportFaction): string {
  const w = 180;
  const h = Math.max(60, Math.round((w * f.height) / (f.width || 1)));
  const dots = f.nodes
    .map(
      (n) =>
        `<circle cx="${n.x + NODE_W / 2}" cy="${n.y + NODE_H / 2}" r="14" fill="${DOT[n.kind] ?? DOT.building}" />`,
    )
    .join("");
  return `<svg class="minimap" width="${w}" height="${h}" viewBox="0 0 ${f.width} ${f.height}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
<rect class="minimap-bg" x="0" y="0" width="${f.width}" height="${f.height}" />
${dots}
<rect class="minimap-view" x="0" y="0" width="${f.width}" height="${f.height}" />
</svg>`;
}

/**
 * The full canvas for one faction: a `.scene-wrap` holding the pannable `<svg>`
 * scene and its minimap. `href` resolves each node's pic reference.
 */
export function renderFactionCanvas(
  f: ExportFaction,
  href: (id: string) => string | undefined,
): string {
  const pos = new Map(f.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
  const edges = renderEdges(f.edges, pos);
  const nodes = f.nodes.map((n) => renderNode(n, href)).join("\n");
  return `<div class="scene-wrap">
<svg class="scene" viewBox="0 0 ${f.width} ${f.height}" data-w="${f.width}" data-h="${f.height}" role="list" aria-label="${esc(f.side)} build tree">
${edges}
<g class="nodes">
${nodes}
</g>
</svg>
${renderMinimap(f)}
</div>`;
}
