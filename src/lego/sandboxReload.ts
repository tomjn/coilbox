/**
 * What "Reload in the sandbox" can reload, worked out from what the export
 * wrote (issue #3346).
 *
 * A running game has read the unit's files once. The sandbox can give its live
 * units the script again, and nothing else: the engine keeps the definition and
 * the model it loaded for the length of the game, and only sees files that
 * were there when it started (`docs/developers/engine-reload.md`). So each
 * export into a running sandbox is compared with what the game has loaded, by
 * the digest of every file written.
 */

import type { WrittenScratchUnit } from "./writeScratchGame";

/** What the running sandbox has loaded: each file's digest by path, and its textures. */
export interface LoadedSandbox {
  files: Record<string, string>;
  textures: string;
}

/** A part of the unit only a relaunch shows, in the order a sentence names them. */
export type RelaunchPart = "definition" | "model" | "texture" | "files";

const ORDER: RelaunchPart[] = ["definition", "model", "texture", "files"];

export interface SandboxChanges {
  /** The script changed, and reloading it is worth doing. */
  reload: boolean;
  relaunch: RelaunchPart[];
}

/** What a game launched on `written` has loaded. */
export function loadedFrom(written: WrittenScratchUnit): LoadedSandbox {
  return {
    files: Object.fromEntries(written.files.map((f) => [f.path, f.sha256])),
    textures: written.textures,
  };
}

/** Which folder of the game a written file is in, which says what it is. */
function kindOf(
  dir: string,
  path: string,
): "script" | "definition" | "model" | "other" {
  const root = dir.replaceAll("\\", "/").replace(/\/$/, "");
  const file = path.replaceAll("\\", "/");
  const relative = file.startsWith(`${root}/`)
    ? file.slice(root.length + 1)
    : file;
  const folder = relative.split("/")[0]?.toLowerCase();
  if (folder === "scripts") return "script";
  if (folder === "units") return "definition";
  if (folder === "objects3d") return "model";
  return "other";
}

/** Compare an export into the sandbox with what the game has loaded. */
export function sandboxChanges(
  loaded: LoadedSandbox,
  written: WrittenScratchUnit,
): SandboxChanges {
  const parts = new Set<RelaunchPart>();
  let script = false;
  for (const file of written.files) {
    const before = loaded.files[file.path];
    if (before === undefined) {
      parts.add("files");
      continue;
    }
    if (before === file.sha256) continue;
    const kind = kindOf(written.dir, file.path);
    if (kind === "script") script = true;
    else if (kind === "other") parts.add("files");
    else parts.add(kind);
  }
  if (written.textures !== loaded.textures) parts.add("texture");
  // The script moves the model's pieces and may include a new file, so it
  // waits for the relaunch that either of those needs.
  const reload = script && !parts.has("model") && !parts.has("files");
  return { reload, relaunch: ORDER.filter((part) => parts.has(part)) };
}

/** What the game has loaded once its scripts are the ones in `written`. */
export function afterScriptReload(
  loaded: LoadedSandbox,
  written: WrittenScratchUnit,
): LoadedSandbox {
  const files = { ...loaded.files };
  for (const file of written.files) {
    if (file.path in files && kindOf(written.dir, file.path) === "script") {
      files[file.path] = file.sha256;
    }
  }
  return { ...loaded, files };
}

const NAME: Record<Exclude<RelaunchPart, "files">, string> = {
  definition: "unit definition",
  model: "model",
  texture: "texture",
};

function list(names: string[]): string {
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", the ")} and the ${names[names.length - 1]}`;
}

/** Why a relaunch is needed, as the drawer says it. Null when it is not. */
export function relaunchMessage(parts: RelaunchPart[]): string | null {
  const named = parts.filter(
    (p): p is Exclude<RelaunchPart, "files"> => p !== "files",
  );
  const sentences: string[] = [];
  if (named.length === 1) {
    const [part] = named;
    sentences.push(
      part === "texture"
        ? "The texture changed. Coilbox does not reload a texture in a running game yet, so relaunch to see it."
        : `The ${NAME[part]} changed. The engine cannot reload a ${NAME[part]} in a running game, so relaunch to see it.`,
    );
  } else if (named.length > 1) {
    const changed = `The ${list(named.map((p) => NAME[p]))} changed.`;
    // Whether the engine can reload a texture is not known yet (issue #3346),
    // so a list with one in it says only what to do.
    sentences.push(
      named.includes("texture")
        ? `${changed} Relaunch to see them in the game.`
        : `${changed} The engine cannot reload them in a running game, so relaunch to see them.`,
    );
  }
  if (parts.includes("files")) {
    sentences.push(
      "The unit has files the game did not start with, so relaunch to see them.",
    );
  }
  return sentences.length > 0 ? sentences.join(" ") : null;
}
