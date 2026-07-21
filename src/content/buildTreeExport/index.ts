/**
 * Orchestrates the build-tree export: turns the serialized {@link ExportInput}
 * plus the three option axes into either a single self-contained HTML string or
 * the zip file set (`index.html` + `images/` + `assets/`). Pure and
 * deterministic — the only non-deterministic value is `input.date`, threaded
 * through to a single footer element. The zip archive itself is assembled in
 * Rust; this returns the file set for it.
 */

import { renderDocument } from "./document";
import { TREE_JS } from "./runtime";
import { TREE_CSS } from "./styles";
import type {
  ExportArtifact,
  ExportFile,
  ExportInput,
  ExportOptions,
} from "./types";

export type {
  ExportArtifact,
  ExportBranding,
  ExportEdge,
  ExportFaction,
  ExportFile,
  ExportInput,
  ExportNode,
  ExportOptions,
  UnitKind,
} from "./types";

/** Map an image data-URL mime to a file extension. */
function extForMime(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    default:
      return "png";
  }
}

/** Split a `data:<mime>;base64,<payload>` URL into its parts, or null. */
function parseDataUrl(url: string): { ext: string; base64: string } | null {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  if (!m) return null;
  return { ext: extForMime(m[1]), base64: m[2] };
}

/** Filesystem-safe form of a unit id for the `images/` folder. */
function safeName(id: string): string {
  return id.replace(/[^a-z0-9_-]/gi, "_");
}

/**
 * Build the export artifact. `html` inlines every pic as a base64 `data:` URL in
 * one file; `zip` emits `index.html` with relative `images/<unit>.<ext>` refs
 * plus `assets/tree.{css,js}`, and returns the base64 image bytes for Rust to
 * pack. Both wrappers/scopes are just data in `input`/`opts`.
 */
export function buildExportArtifact(
  input: ExportInput,
  opts: ExportOptions,
): ExportArtifact {
  if (opts.format === "html") {
    const iconById = new Map<string, string>();
    for (const f of input.factions)
      for (const n of f.nodes) if (n.icon) iconById.set(n.id, n.icon);
    const href = (id: string) => iconById.get(id);
    return {
      format: "html",
      html: renderDocument(input, opts, href, { inline: true }),
    };
  }

  // zip: dedupe pics by unit id into images/<name>.<ext>; ref them relatively.
  const files: ExportFile[] = [];
  const relById = new Map<string, string>();
  const usedNames = new Set<string>();
  for (const f of input.factions) {
    for (const n of f.nodes) {
      if (!n.icon || relById.has(n.id)) continue;
      const parsed = parseDataUrl(n.icon);
      if (!parsed) continue;
      let base = safeName(n.id);
      let name = `${base}.${parsed.ext}`;
      while (usedNames.has(name)) {
        base = `${base}_`;
        name = `${base}.${parsed.ext}`;
      }
      usedNames.add(name);
      const rel = `images/${name}`;
      relById.set(n.id, rel);
      files.push({ path: rel, base64: parsed.base64 });
    }
  }
  const href = (id: string) => relById.get(id);
  const html = renderDocument(input, opts, href, { inline: false });
  files.unshift(
    { path: "index.html", text: html },
    { path: "assets/tree.css", text: TREE_CSS },
    { path: "assets/tree.js", text: TREE_JS },
  );
  return { format: "zip", files };
}
