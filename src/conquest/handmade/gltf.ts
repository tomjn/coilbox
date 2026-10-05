/**
 * The files a `.gltf` names beside itself. A `.gltf` keeps its `.bin` buffer
 * and its textures in other files, named by uri relative to the `.gltf`.
 */

/**
 * Where a uri a `.gltf` at `gltfFile` writes points in the map folder, or
 * `undefined` for a uri with a scheme, such as a `data:` uri that holds its
 * bytes inline. A path that climbs out of the folder is returned as the uri
 * was written, with `outside` set.
 */
export function resolveGltfUri(
  uri: unknown,
  gltfFile: string,
): { path: string; outside: boolean } | undefined {
  if (typeof uri !== "string" || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(uri)) {
    return undefined;
  }
  let decoded = uri;
  try {
    decoded = decodeURIComponent(uri);
  } catch {}
  const steps = gltfFile.split("/").slice(0, -1);
  let outside = false;
  for (const step of decoded.split("/")) {
    if (step === "" || step === ".") continue;
    if (step !== "..") steps.push(step);
    else if (steps.length > 0) steps.pop();
    else outside = true;
  }
  return { path: outside ? decoded : steps.join("/"), outside };
}

/** The `buffers` and `images` entries of a parsed `.gltf` that carry a uri. */
export function gltfUriEntries(json: unknown): { uri?: unknown }[] {
  const out: { uri?: unknown }[] = [];
  if (typeof json !== "object" || json === null) return out;
  const { buffers, images } = json as { buffers?: unknown; images?: unknown };
  for (const list of [buffers, images]) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (typeof entry === "object" && entry !== null) out.push(entry);
    }
  }
  return out;
}

/**
 * The files a `.gltf` names beside itself, as paths in the map folder. A
 * `data:` uri holds its bytes inline and names nothing. A path that climbs out
 * of the folder is returned as the uri was written, with `outside` set.
 */
export function gltfSiblings(
  gltf: string,
  gltfFile: string,
): { path: string; outside: boolean }[] {
  let json: unknown;
  try {
    json = JSON.parse(gltf);
  } catch {
    return [];
  }
  return gltfUriEntries(json).flatMap((entry) => {
    const found = resolveGltfUri(entry.uri, gltfFile);
    return found ? [found] : [];
  });
}
