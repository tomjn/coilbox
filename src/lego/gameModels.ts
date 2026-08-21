/**
 * What a game holds that the builder could open, listed by unit rather than by
 * file name.
 *
 * Somebody working on a game knows a model as "Commander", not as
 * `objects3d/armcom.s3o`, and a game with four hundred units is a folder you go
 * hunting in (#1817). Two readings answer that between them: the archive's own
 * member list says which model files exist, and the unit dataset says which
 * unitdef names which of them, through its `objectname`. Joining the two gives a
 * row per unit with a model, and a row per model no unit names, which is how a
 * feature or a wreck stays visible instead of disappearing.
 *
 * The join is done here rather than by `unitsyncUnitModels`, which answers the
 * same question authoritatively. That command flattens each model it resolves
 * and writes it out as JSON, which is megabytes a unit and the wrong price for
 * drawing a list. This pays one cheap member listing instead, and the flattened
 * read stays where it belongs, on the one model somebody actually opens.
 *
 * Pure, so the matching rules are testable without unitsync or a webview.
 */

import type { UnitDatasetEntry } from "../content/bindings";
import type { LegoProject } from "./model";

/** Where a game keeps its models. Anything outside it is not one, whatever it
 *  is called. */
const MODELS_DIR = "objects3d/";

/** One openable model, as the picker lists it. */
export interface GameModelRow {
  /** The model's path inside the archive, exactly as the archive spells it.
   *  This is what gets read, so its case is the archive's and not a guess. */
  member: string;
  /** What the row is called: the unitdef's human name where there is one, the
   *  unitdef's internal name where the human one is blank, and the file's own
   *  name for a model no unitdef names. */
  label: string;
  /** The unitdef's internal name, when a unitdef names this model. */
  unit?: string;
  /** The project this model is already open as, so the picker can offer that
   *  one rather than quietly making a second copy. */
  openedAs?: string;
}

export interface GameModels {
  rows: GameModelRow[];
  /** Units drawn with a `.3do`, the older format the builder cannot read.
   *  Counted rather than listed: Balanced Annihilation is 720 `.3do` models
   *  against 7 `.s3o`, so listing them greyed out would bury the openable ones.
   *  Counted per unit rather than per file because a unit is what somebody came
   *  looking for, and most of the files are wrecks and features nobody named. */
  threeDoUnits: number;
  /** Units naming a model this archive does not hold at all, which is normally
   *  a game whose models live in an archive it depends on. Kept apart from the
   *  `.3do` count so neither footnote claims the other's reason. */
  unresolvedUnits: number;
}

/**
 * The name two spellings of one model agree on.
 *
 * A unitdef's `objectname` is written however the author felt like: `AAFUS` in
 * Balanced Annihilation, `mech/Anubis/cc_anubis_abs3l.s3o` in MechCommander,
 * with or without the `objects3d/` prefix, with either slash, and usually with
 * no extension at all. Everything that varies is flattened away here so the two
 * can be compared at all.
 */
export function modelKey(name: string): string {
  let key = name.trim().replace(/\\/g, "/").toLowerCase();
  if (key.startsWith(MODELS_DIR)) key = key.slice(MODELS_DIR.length);
  return key.replace(/\.(s3o|3do)$/, "");
}

/** A model's own name, for a row no unitdef speaks for. */
function fileLabel(member: string): string {
  return (member.split("/").at(-1) ?? member).replace(/\.s3o$/i, "");
}

/**
 * Join a game's archive members to its unit dataset.
 *
 * `archivePath` is only needed to recognise units opened before the picker
 * existed: those carry the full path the file dialog handed over and nothing
 * else, so the archive's own folder is what tells one of this game's models from
 * a same-named model in another game.
 */
export function gameModelRows(input: {
  files: { path: string }[];
  units: UnitDatasetEntry[];
  projects: LegoProject[];
  /** The game's primary archive name, as unitsync knows it. */
  archive: string;
  archivePath?: string;
}): GameModels {
  const { archive, archivePath } = input;

  const models = new Map<string, string>();
  const threeDo = new Set<string>();
  for (const file of input.files) {
    const path = file.path.replace(/\\/g, "/");
    if (!path.toLowerCase().startsWith(MODELS_DIR)) continue;
    if (/\.3do$/i.test(path)) {
      threeDo.add(modelKey(path));
      continue;
    }
    if (!/\.s3o$/i.test(path)) continue;
    models.set(modelKey(path), path);
  }

  const opened = openedProjects(input.projects, archive, archivePath);
  const rows: GameModelRow[] = [];
  const named = new Set<string>();
  let threeDoUnits = 0;
  let unresolvedUnits = 0;

  for (const unit of input.units) {
    if (!unit.objectName) continue;
    const key = modelKey(unit.objectName);
    const member = models.get(key);
    if (!member) {
      if (threeDo.has(key)) threeDoUnits += 1;
      else unresolvedUnits += 1;
      continue;
    }
    named.add(key);
    rows.push({
      member,
      label: unit.fullName?.trim() || unit.name,
      unit: unit.name,
      ...(opened.get(key) ? { openedAs: opened.get(key) as string } : {}),
    });
  }

  for (const [key, member] of models) {
    if (named.has(key)) continue;
    rows.push({
      member,
      label: fileLabel(member),
      ...(opened.get(key) ? { openedAs: opened.get(key) as string } : {}),
    });
  }

  rows.sort(
    (a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: "base" }) ||
      a.member.localeCompare(b.member),
  );
  return { rows, threeDoUnits, unresolvedUnits };
}

/**
 * Which of this game's models are already open as a project, by model key.
 *
 * A unit opened through the picker says which archive and member it came from,
 * which is exact. A unit opened through the file dialog says only the path it
 * was read from, so it counts only when that path is this archive's folder plus
 * the member: two games shipping an `armcom.s3o` are two different models, and
 * offering one in place of the other would be worse than offering neither.
 */
function openedProjects(
  projects: LegoProject[],
  archive: string,
  archivePath?: string,
): Map<string, string> {
  const root = archivePath
    ?.replace(/\\/g, "/")
    .replace(/\/$/, "")
    .toLowerCase();
  const opened = new Map<string, string>();
  for (const project of projects) {
    const imported = project.imported;
    if (!imported) continue;
    const game = imported.game;
    if (game) {
      if (game.archive === archive)
        opened.set(modelKey(game.member), project.id);
      continue;
    }
    if (!root) continue;
    const source = imported.source.replace(/\\/g, "/").toLowerCase();
    if (!source.startsWith(`${root}/`)) continue;
    opened.set(modelKey(source.slice(root.length + 1)), project.id);
  }
  return opened;
}
