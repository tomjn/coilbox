/**
 * Write a unit out as an s3o.
 *
 * The destination is a game folder, chosen once and remembered on the project,
 * so exporting again after a change is one click. The model in `objects3d/` is
 * rewritten every export, since the builder alone owns it. The atlas, the unit
 * script and the unit definition are different, so hand edits to any of them
 * survive a re-export. The atlas is written once and then left alone. The
 * script is replaced only while it is still the one the last export wrote, and
 * the unit definition has only the fields the build decides brought up to
 * date, and only those nobody has changed (issue #3245). The atlas and the
 * script are checkboxes, since a game may already have either. The unit
 * definition always goes to `units/`, since without one the engine has nothing
 * to spawn.
 *
 * Exactly one atlas is written, the unit's own, because that is all an s3o can
 * name. Units sharing an atlas share the one PNG, so five units in one atlas
 * need one file installed, not five. It goes in under the name
 * `exportTextureName` gives it, prefixed so it does not collide with a file the
 * game already has, and left alone once written like the rest.
 *
 * A unit imported from somebody else's model has no atlas. It draws with its
 * own two textures, which go in under the names the model already gives them,
 * because those are the game's own file names rather than a pack's generic
 * one. The Blender files take the same two textures a different way: Blender
 * reads no `.dds`, so both are decoded to PNG on the way into the `blender`
 * folder, and only the first of them is a picture anything samples. See
 * https://github.com/tomjn/coilbox/issues/715.
 */

import { Button, Input } from "@picoframe/frame";
import { open, save } from "@tauri-apps/plugin-dialog";
import { FolderOpen, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useCallback, useEffect, useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { workshopCompile } from "@/workshop/compile";
import { useModProjects } from "@/workshop/project";
import {
  baseLanguage,
  type LanguageTexts,
  languageNamesUnits,
  languageUnitsFile,
  type TextHome,
} from "@/workshop/unitText";
import { exportTextureName, unitAtlas } from "../../atlas";
import {
  type BlenderTextureRef,
  type BlenderTextureWritten,
  legoAtlasPng,
  legoExport,
  legoExportGlb,
  legoExportObj,
  legoExportPicture,
  legoExportStale,
  legoGameLanguage,
  legoReadTextFile,
  legoSaveGlb,
  legoTexturePng,
} from "../../bindings";
import { overBudgetLoadouts, unitCost } from "../../budget";
import { pictureDigest } from "../../buildPicture";
import { buildCombinedSheet, type CombinedSheet } from "../../combinedSheet";
import { exportGlb } from "../../exportGlb";
import { buildObj } from "../../exportObj";
import {
  adoptFile,
  digestsOf,
  forgetStale,
  receiptFor,
  recordExport,
} from "../../exportRecord";
import { liftCredits } from "../../liftPiece";
import {
  type ExportTarget,
  exportTargets,
  loadoutUnit,
  loadoutUnitNames,
} from "../../loadouts";
import { unitScript } from "../../luaScript";
import type {
  ExportedFile,
  LegoExport,
  LegoProject,
  StaleExport,
} from "../../model";
import type { LoadedPack } from "../../pack";
import {
  buildPieceCollisionScript,
  pieceCollisionScriptPath,
} from "../../pieceCollisionScript";
import type { RawGeometry } from "../../rawGeometry";
import { blenderTextures, importedTextures } from "../../rawImport";
import {
  definitionUnclaimed,
  derivedFields,
  type FieldChange,
  type KeptWhole,
  receiptDef,
  writtenDigest,
} from "../../reexport";
import { bakedPieces, buildS3o, unitBounds } from "../../s3oBuild";
import { sheetSources, sheetTextureNames } from "../../textureSheet";
import { buildUnitDef, defValue, legoUnitDef, unitWords } from "../../unitDef";
import { exportWeapons } from "../../weaponModule";
import { worthTotals } from "../../worth";
import { buildWreck, wreckFeaturePath } from "../../wreck";
import { ShowMe } from "./ShowMe";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: LegoProject;
  pack: LoadedPack;
  /** The meshes of a unit imported from somebody else's model, if it is one. */
  raw: RawGeometry | null;
  /** Remembered on the document, so the next export does not ask again, plus
   *  the receipt the workshop reads to find this unit in a game (issue #2651)
   *  and the names it has stopped using in that folder (issue #2680). */
  onRemember: (settings: {
    exportDir: string;
    exportTexture: boolean;
    exportOverwriteTexture: boolean;
    exportScript: boolean;
    exportGlb: boolean;
    exportObj: boolean;
    exported: LegoExport;
    exportedElsewhere: LegoExport[];
    staleExports: StaleExport[];
  }) => void;
  /** The leftovers alone, for when the drawer clears a name's files without
   *  exporting anything. Stable, since an effect here reads it. */
  onStale: (staleExports: StaleExport[]) => void;
  /** The receipts after the person has said a definition is coilbox's
   *  (issue #4272). */
  onAdopt: (
    receipts: Pick<LegoProject, "exported" | "exportedElsewhere">,
  ) => void;
  /** The same for a loadout of a unit that has them (#3282): the receipt goes
   *  on that loadout and no other, and the project keeps the folder and the
   *  choices. `next` and `written` are recorded against the project as it is
   *  when the edit lands, so exporting every loadout in a row loses none. */
  onRememberLoadout: (
    loadoutId: string,
    settings: {
      exportDir: string;
      exportTexture: boolean;
      exportOverwriteTexture: boolean;
      exportScript: boolean;
      exportGlb: boolean;
      exportObj: boolean;
    },
    next: Omit<LegoExport, "files">,
    written: ExportedFile[],
  ) => void;
  /** A definition said to be coilbox's, for one loadout. */
  onAdoptLoadout: (loadoutId: string, dir: string, file: ExportedFile) => void;
  /** The name a loadout exports under, as the person typed it. */
  onLoadoutUnitName: (loadoutId: string, name: string) => void;
}

/** What is still in the game folder under one name the unit no longer uses. */
interface Leftover {
  stale: StaleExport;
  /** Files still exactly as coilbox wrote them, so it can offer to remove them. */
  ours: string[];
  /** Files under that name that coilbox did not write, or no longer recognises. */
  kept: string[];
}

/** One loadout's line in the answer to exporting every loadout. */
interface BatchLine {
  unitName: string;
  /** Null when it went through. */
  problem: string | null;
}

type Result =
  | { state: "idle" }
  | { state: "working" }
  | {
      state: "done";
      model: string;
      texture: string | null;
      textureKept: boolean;
      textures: string[];
      texturesKept: string[];
      script: string | null;
      scriptKept: boolean;
      cobVars: string | null;
      cobVarsKept: boolean;
      pieceCollision: string | null;
      unitDef: string | null;
      unitDefKept: KeptWhole | null;
      unitDefFields: FieldChange[];
      /** The definition this build gives, to set beside a field that was kept. */
      built: Record<string, unknown>;
      /** The library weapon files written under `weapons/` (issue #3274). */
      weapons: string[];
      /** The wreck's model and feature file (issue #3310). */
      wreckModel: string | null;
      wreckFeature: string | null;
      wreckFeatureKept: boolean;
      /** How many weapon slots the definition names. */
      weaponSlots: number;
      /** A line for each weapon left out, and why. */
      weaponsMissing: string[];
      glb: string | null;
      obj: string | null;
      mtl: string | null;
      /** The decoded textures the Blender files were written with. */
      blenderTextures: BlenderTextureWritten[];
      /** Why a Blender file could not be written, when the rest of the export
       *  went through. Reported rather than thrown: the `.s3o` is already on
       *  disk by then and is the half the engine reads. */
      blenderProblem: string | null;
      /** `language/<code>/coilbox.json`, for a game named out of one. */
      language: string | null;
      /** `unitpics/<unit>.png`, when the build picture was written. */
      picture: string | null;
      /** True when a picture was already there that the builder did not write,
       *  and it was left alone. */
      pictureKept: boolean;
      pictureProblem: string | null;
    }
  | { state: "failed"; message: string };

type Done = Extract<Result, { state: "done" }>;

/** The standalone "Save GLB…" button, independent of the export above. */
type GlbSave =
  | { state: "idle" }
  | { state: "working" }
  | { state: "done"; path: string }
  | { state: "failed"; message: string };

/**
 * Where the chosen folder's game keeps the words a player reads (issue #2683).
 *
 * Read off the folder rather than off a game scan, because the export drawer is
 * given a directory by a picker and there may be no scanned game behind it at
 * all. That is enough: the files it opens are the whole of the answer, for the
 * reason `languageNamesUnits` gives.
 */
type GameText =
  | { state: "unread" }
  | { state: "reading" }
  | { state: "read"; home: TextHome; texts: LanguageTexts }
  /** A file is there and will not read, so the home cannot be answered. */
  | { state: "failed"; message: string };

/**
 * A stored texture as a PNG, with the file's own name on any reason it could
 * not be read.
 *
 * The store names files by their content hash, so a bare failure from it says
 * nothing a person could act on. `lego_export_obj` puts the name on its own
 * failures for the same reason.
 */
async function decodedTexture(texture: BlenderTextureRef) {
  try {
    return await legoTexturePng({ key: texture.key });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${texture.writeAs}: ${reason}`);
  }
}

/** A field's value as the drawer shows it. */
function shown(value: unknown): string {
  if (value === null || value === undefined) return "nothing";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Why the whole unit definition was left as it was (issue #3245). */
function KeptDefinition({
  kept,
  weapons,
}: {
  kept: KeptWhole;
  /** Whether the build has weapons, which then stay as the file has them. */
  weapons: boolean;
}) {
  const weaponLine = weapons ? " Its weapons are as that file has them." : null;
  if (kept.reason === "workshopBackup")
    return (
      <p className="text-muted-foreground">
        The unit definition has been left alone, because the workshop has
        changes in it that you have not accepted or undone. Undo would put the
        old file back over this export. Accept or undo them, then export again.
        {weaponLine}
      </p>
    );
  if (kept.reason === "unreadable")
    return (
      <p className="text-muted-foreground">
        The unit definition there does not run, so it has been left alone:{" "}
        {kept.message}
        {weaponLine}
      </p>
    );
  return (
    <p className="text-muted-foreground">
      A unit definition was already there that coilbox has no record of writing,
      so it has been left alone.
      {weaponLine}
    </p>
  );
}

/** What a re-export did to each field the build decides (issue #3245). */
function FieldChanges({
  changes,
  built,
}: {
  changes: FieldChange[];
  built: Record<string, unknown>;
}) {
  const written = changes.filter(
    (field) => field.change !== "kept" && field.change !== "refused",
  );
  const kept = changes.filter((field) => field.change === "kept");
  const refused = changes.filter((field) => field.change === "refused");
  return (
    <>
      {written.length > 0 ? (
        <>
          <p className="text-muted-foreground">
            Brought up to date in the unit definition:
          </p>
          <ul className="flex flex-col gap-0.5">
            {written.map((field) => (
              <li key={field.path}>
                <code>{field.path}</code>{" "}
                {field.change === "removed"
                  ? `taken out, was ${shown(field.was)}`
                  : field.change === "added"
                    ? `added as ${shown(defValue(built, field.path))}`
                    : `${shown(field.was)} to ${shown(defValue(built, field.path))}`}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {kept.length > 0 ? (
        <>
          <p className="text-muted-foreground">
            Kept, because they were changed after the last export:
          </p>
          <ul className="flex flex-col gap-0.5">
            {kept.map((field) => (
              <li key={field.path}>
                <code>{field.path}</code> is {shown(field.was)}, the build gives{" "}
                {shown(defValue(built, field.path))}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {refused.length > 0 ? (
        <>
          <p className="text-destructive">Not brought up to date:</p>
          <ul className="flex flex-col gap-0.5">
            {refused.map((field) => (
              <li key={field.path}>
                <code>{field.path}</code>: {field.message}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}

/**
 * What a unit's textures come to on export: imported pictures, a sheet made
 * from mixed parts, or the atlas its parts share. Asked of each unit written,
 * since a loadout can hold parts the next one does not.
 */
function textureFacts(
  project: LegoProject,
  pack: LoadedPack,
  raw: RawGeometry | null,
) {
  const imported = project.imported ? importedTextures(project.imported) : null;
  // A unit of parts holding a lifted piece draws from more than one picture
  // and a model names one, so on export they go onto one sheet (#3260). Null
  // for every other unit, which exports exactly as it did before.
  const mixed = sheetSources(project, pack, raw);
  const heldBack = mixed && "refused" in mixed ? mixed.refused : null;
  const sheetFrom = mixed && "sources" in mixed ? mixed.sources : null;
  // The same two textures again, named as the PNGs a Blender file can carry.
  const blender = project.imported ? blenderTextures(project.imported) : null;
  const unit = unitAtlas(project, pack.library.atlases);
  // What the atlas is called once written, which is what the s3o names and
  // what a game folder ends up holding. Never the pack's own name for it: that
  // is generic enough to land on a file the game already has.
  return {
    imported,
    heldBack,
    sheetFrom,
    blender,
    atlas: unit.texture,
    atlasFile: exportTextureName(unit.texture),
    // Everything that needs the atlas file itself, rather than only its name,
    // needs it to actually be installed.
    installed: unit.installed,
  };
}

export function ExportDrawer({
  open: isOpen,
  onOpenChange,
  project: whole,
  pack,
  raw,
  onRemember,
  onStale,
  onAdopt,
  onRememberLoadout,
  onAdoptLoadout,
  onLoadoutUnitName,
}: Props) {
  // The unit the drawer describes: the project, or with loadouts the one on
  // screen as its own unit under its own name and receipts (#3282).
  const project =
    (whole.activeLoadout ? loadoutUnit(whole, whole.activeLoadout) : null) ??
    whole;
  const loadoutNames = loadoutUnitNames(whole);
  const overBudget = overBudgetLoadouts(whole, (unit) =>
    unitCost(unit, pack, raw),
  );
  const [scope, setScope] = useState<"active" | "all">("active");
  const [batch, setBatch] = useState<BatchLine[] | null>(null);
  const [dir, setDir] = useState(project.exportDir ?? "");
  const [withTexture, setWithTexture] = useState(
    project.exportTexture !== false,
  );
  const [withOverwriteTexture, setWithOverwriteTexture] = useState(
    project.exportOverwriteTexture === true,
  );
  const [withScript, setWithScript] = useState(project.exportScript !== false);
  const [withGlb, setWithGlb] = useState(project.exportGlb === true);
  const [withObj, setWithObj] = useState(project.exportObj === true);
  const [withPicture, setWithPicture] = useState(true);
  const [result, setResult] = useState<Result>({ state: "idle" });
  const [glbSave, setGlbSave] = useState<GlbSave>({ state: "idle" });
  const [gameText, setGameText] = useState<GameText>({ state: "unread" });
  // Where a library weapon is read from on each export (issue #3274).
  const { projects: workshopProjects } = useModProjects();

  // Asked of the folder as soon as there is one, so the drawer can say where
  // this unit's name is going before anybody presses the button rather than
  // only in the list of what was written.
  const readGameText = useCallback(async (folder: string) => {
    if (!folder) {
      setGameText({ state: "unread" });
      return;
    }
    setGameText({ state: "reading" });
    try {
      const { texts } = await legoGameLanguage({ dir: folder });
      setGameText({
        state: "read",
        home: languageNamesUnits(texts) ? "language" : "def",
        texts,
      });
    } catch (error) {
      setGameText({
        state: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void readGameText(dir);
  }, [isOpen, dir, readGameText]);

  // A folder whose game could not be asked is treated as one that names its
  // units in their definitions, which is what every export did before #2683 and
  // is the answer for the great majority of games. The drawer says so, because
  // the one game it is wrong for is the one this whole thing is about.
  const home: TextHome = gameText.state === "read" ? gameText.home : "def";
  // The locale the name goes in: the one the game's other locales fall back to,
  // which for anything descended from Beyond All Reason is English. A unit is
  // built with one name, so it is written once rather than into every file the
  // game ships. Translating it is the workshop's job (issue #2672).
  const language =
    gameText.state === "read" ? baseLanguage(gameText.texts) : "en";
  // A name the game itself declares is the game's. Export already keeps that
  // unit's own `units/<name>.lua` rather than overwriting it, so writing our
  // name over the game's would rename a unit that was never ours.
  const gameNames = (unitName: string) =>
    gameText.state === "read" &&
    Object.hasOwn(
      gameText.texts[language]?.names ?? {},
      unitName.toLowerCase(),
    );
  const gameNamesThisUnit = gameNames(project.unitName);
  const writesLanguage = home === "language" && !gameNamesThisUnit;

  // What a rename left in the game folder, looked for each time the drawer
  // opens and again after each export (issue #2680). Null until the first look,
  // so an empty list means "nothing left behind" rather than "not asked yet".
  const [leftovers, setLeftovers] = useState<Leftover[] | null>(null);
  const [clearing, setClearing] = useState<string | null>(null);

  const staleExports = project.staleExports;
  useEffect(() => {
    if (!isOpen) return;
    const stale = staleExports ?? [];
    if (stale.length === 0) {
      setLeftovers([]);
      return;
    }
    let live = true;
    void (async () => {
      const found = await Promise.all(
        stale.map(async (entry): Promise<Leftover> => {
          try {
            const seen = await legoExportStale({
              dir: entry.dir,
              unitName: entry.unitName,
              digests: digestsOf(entry.files),
              dryRun: true,
            });
            return { stale: entry, ours: seen.ours, kept: seen.kept };
          } catch {
            // A folder that has moved, or one this build cannot read. Nothing
            // to offer and nothing to say, so it drops out of the list rather
            // than becoming an error the user cannot act on.
            return { stale: entry, ours: [], kept: [] };
          }
        }),
      );
      if (!live) return;
      const left = found.filter(
        (entry) => entry.ours.length + entry.kept.length > 0,
      );
      setLeftovers(left);
      // A name whose files are gone, deleted by hand or by an earlier run, has
      // nothing left to say, so the project stops carrying it.
      if (left.length < found.length) onStale(left.map((entry) => entry.stale));
    })();
    return () => {
      live = false;
    };
  }, [isOpen, staleExports, onStale]);

  // A definition already in the folder that the receipt has no digest for: one
  // exported before digests were recorded, or the game's own that an older
  // export kept. Coilbox cannot tell which, so the person says (issue #4272).
  // Every unit the export writes has its own definition, so each loadout is
  // asked on its own (#3282).
  const folder = dir.replace(/[\\/]+$/, "");
  const claimable = (
    whole.loadouts
      ? whole.loadouts.map((loadout) => ({
          id: loadout.id as string | null,
          unitName: loadoutNames.get(loadout.id) ?? "",
          receipts: loadout,
          label: loadout.name,
        }))
      : [
          {
            id: null as string | null,
            unitName: project.unitName,
            receipts: project,
            label: project.name,
          },
        ]
  )
    .filter((unit) =>
      definitionUnclaimed(receiptFor(unit.receipts, dir), dir, unit.unitName),
    )
    .map((unit) => ({
      ...unit,
      path: `${folder}/units/${unit.unitName}.lua`,
    }));
  const claimablePaths = claimable.map((unit) => unit.path).join("\n");
  const [definitionsThere, setDefinitionsThere] = useState<string[]>([]);
  const [adopting, setAdopting] = useState(false);
  useEffect(() => {
    setDefinitionsThere([]);
    if (!isOpen || claimablePaths === "") return;
    let live = true;
    for (const path of claimablePaths.split("\n")) {
      legoReadTextFile({ path }).then(
        () => live && setDefinitionsThere((there) => [...there, path]),
        () => {},
      );
    }
    return () => {
      live = false;
    };
  }, [isOpen, claimablePaths]);

  async function adoptDefinition(unit: (typeof claimable)[number]) {
    setAdopting(true);
    try {
      // Read now rather than when the drawer looked, so the digest is of the
      // file as it is when the person chose.
      const { text } = await legoReadTextFile({ path: unit.path });
      const bytes = new TextEncoder().encode(text);
      const sha256 = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
      const file = { path: unit.path, sha256 };
      if (unit.id) onAdoptLoadout(unit.id, dir, file);
      else onAdopt(adoptFile(project, dir, file));
    } catch (error) {
      setResult({
        state: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setAdopting(false);
    }
  }

  async function clearStale(entry: Leftover) {
    setClearing(entry.stale.unitName);
    try {
      const gone = await legoExportStale({
        dir: entry.stale.dir,
        unitName: entry.stale.unitName,
        digests: digestsOf(entry.stale.files),
        dryRun: false,
      });
      const left = (leftovers ?? []).flatMap((other) =>
        other.stale === entry.stale
          ? gone.kept.length > 0
            ? [{ stale: other.stale, ours: [], kept: gone.kept }]
            : []
          : [other],
      );
      setLeftovers(left);
      // The receipt only goes when nothing is left under that name. A file
      // coilbox did not write stays where it is, and forgetting the name would
      // take away the only thing that could ever mention it again.
      if (gone.kept.length === 0)
        onStale(forgetStale(staleExports ?? [], entry.stale));
    } catch (error) {
      setResult({
        state: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setClearing(null);
    }
  }

  // Whichever atlas the unit samples, installed or not. The s3o names it
  // either way, so an atlas installed later puts a re-export right without the
  // unit having to change.
  // A unit imported from somebody else's model draws with its own textures out
  // of the store, and none of the atlas below applies to it.
  const facts = textureFacts(project, pack, raw);
  const { imported, heldBack, sheetFrom, blender } = facts;
  const { atlas, atlasFile, installed } = facts;
  const sheetNames = sheetTextureNames(project.unitName);
  const credits = liftCredits(project);

  async function chooseFolder() {
    const picked = await open({
      directory: true,
      multiple: false,
      title: "Choose the game folder to export into",
    });
    if (typeof picked !== "string") return;
    setDir(picked);
    setResult({ state: "idle" });
  }

  // What the GLB's material samples: an imported unit's own picture, decoded
  // out of the store, or the atlas a built one shares. Shared by the full
  // export below and by the standalone "Save GLB…" button, which both need
  // the same answer to the same question. A mixed unit's is its sheet.
  async function glbColourUrl(
    sheet: CombinedSheet | null,
    { blender, installed, atlas, atlasFile }: ReturnType<typeof textureFacts>,
  ): Promise<string | null> {
    if (sheet) return (await decodedTexture(sheet.blender.colour)).dataUrl;
    if (blender) {
      return blender.colour
        ? (await decodedTexture(blender.colour)).dataUrl
        : null;
    }
    if (!installed) return null;
    // Through Rust rather than the asset URL: the atlas has no alpha channel,
    // which the bake reads as all team colour (#4173).
    const { dataUrl } = await legoAtlasPng({
      atlas: { name: atlas, pack: installed.folder, writeAs: atlasFile },
    });
    return dataUrl;
  }

  async function saveGlb() {
    const target = await save({
      title: "Save the .glb",
      defaultPath: `${project.unitName}.glb`,
      filters: [{ name: "glTF Binary", extensions: ["glb"] }],
    });
    if (typeof target !== "string") return;
    if (heldBack) {
      setGlbSave({ state: "failed", message: heldBack });
      return;
    }
    setGlbSave({ state: "working" });
    try {
      const sheet = sheetFrom
        ? await buildCombinedSheet(project, pack, raw, sheetFrom)
        : null;
      const colourUrl = await glbColourUrl(sheet, facts);
      const bytes = await exportGlb(project, pack, raw, colourUrl, sheet?.uv);
      if (!bytes) {
        setGlbSave({
          state: "failed",
          message: "This unit has no root piece.",
        });
        return;
      }
      const written = await legoSaveGlb({
        path: target,
        bytes: Array.from(new Uint8Array(bytes)),
      });
      setGlbSave({ state: "done", path: written.path });
    } catch (error) {
      setGlbSave({
        state: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Write one unit: the project, or one of its loadouts as a unit of its own.
   * Everything below reads `project` as that unit, its name, its pieces and its
   * receipts, so a loadout is written by the same code as any unit. Throws with
   * the reason when the unit could not be written.
   */
  async function exportOne(target: ExportTarget): Promise<Done> {
    const project = target.unit;
    const facts = textureFacts(project, pack, raw);
    const { imported, heldBack, sheetFrom, blender, atlas, atlasFile } = facts;
    const { installed } = facts;
    const writesLanguage = home === "language" && !gameNames(project.unitName);
    if (heldBack) throw new Error(heldBack);
    // A mixed unit's sheet is made first, since the model names it and its
    // UVs point onto it.
    const sheet: CombinedSheet | null = sheetFrom
      ? await buildCombinedSheet(project, pack, raw, sheetFrom)
      : null;
    // The s3o header names the atlas whether or not this export copies it, so a
    // unit exported without the texture still finds one already installed.
    const model = sheet
      ? buildS3o(
          project,
          pack,
          raw,
          { texture1: sheet.texture1, texture2: sheet.texture2 },
          { sheet: sheet.uv },
        )
      : buildS3o(project, pack, raw, {
          texture1: imported ? imported.texture1 : atlasFile,
          texture2: imported?.texture2,
        });
    if (!model) throw new Error("This unit has no root piece.");
    // Measured rather than taken off the build: a build's `mid` is the header's,
    // which is the aim point, and the definition is derived from the bounding
    // box. Derived once here because two things read it: the Lua file the engine
    // loads, and the receipt the workshop turns into a unit (issue #2651).
    const bounds = unitBounds(project, pack, raw);
    const totals = worthTotals(project, pack);
    // Read again from the workshop every time, so the weapon it writes is
    // the one the workshop holds now (issue #3274).
    const weapons = await exportWeapons(project, workshopProjects, (made) =>
      workshopCompile({ project: made }),
    );
    const def = legoUnitDef(project, bounds, home, totals, weapons.slots);
    // What coilbox wrote into this folder, which is not always the latest
    // export's receipt (issue #4267).
    const folderReceipt = receiptFor(project, dir);
    // The wreck the unit leaves, painted with the unit's own textures
    // (issue #3310).
    const wreck = buildWreck(
      project,
      pack,
      raw,
      { texture1: model.texture1, texture2: model.texture2 },
      def,
      sheet?.uv,
    );
    const exported = await legoExport({
      dir,
      unitName: project.unitName,
      // A mixed unit's sheet is always written: it is made from this build,
      // so no game can already have it.
      textures: sheet
        ? { atlas: null, stored: sheet.place }
        : withTexture
          ? {
              atlas:
                !imported && installed
                  ? {
                      name: atlas,
                      pack: installed.folder,
                      writeAs: atlasFile,
                    }
                  : null,
              stored: imported ? imported.place : [],
            }
          : null,
      overwriteTexture: withOverwriteTexture,
      script: withScript ? unitScript(project) : null,
      // A script still exactly as the last export wrote it has not been
      // touched, so it is replaced with this build's (issue #3245).
      scriptWritten: writtenDigest(
        folderReceipt,
        dir,
        `scripts/${project.unitName}.lua`,
      ),
      // Not behind the script checkbox. That one is about not clobbering a
      // game's own hand-written script, and this file is coilbox's: it is
      // rewritten, or taken away, on every export.
      pieceCollision: buildPieceCollisionScript(
        project,
        bakedPieces(project, pack, raw).pieces,
      ),
      // Unlike the atlas and the script, there is no scenario where a
      // built unit should export without one: with no unit definition the
      // engine has nothing to spawn.
      unitDef: buildUnitDef(project, bounds, home, totals, weapons.slots),
      // The fields the build decides, beside what the last export wrote
      // there, so a re-export updates the ones nobody has changed.
      unitDefFields: derivedFields(def, folderReceipt, dir, project.unitName),
      // Where the name goes for a game that will not read one in the
      // definition. Coilbox's own file beside the game's, never the game's
      // (issue #2683).
      text: writesLanguage ? { language, ...unitWords(project) } : null,
      model,
      weapons: weapons.files,
      ...(wreck
        ? {
            wreck: {
              model: wreck.model,
              feature: wreck.feature,
              featureWritten: writtenDigest(
                folderReceipt,
                dir,
                wreckFeaturePath(project.unitName),
              ),
            },
          }
        : {}),
    });

    // The Blender half, which the engine reads none of. A texture the decoder
    // cannot read stops these two and nothing else: the model, the script and
    // the definition are already written and are what the game runs on.
    let glbPath: string | null = null;
    let objPath: string | null = null;
    let mtlPath: string | null = null;
    let written: BlenderTextureWritten[] = [];
    let blenderProblem: string | null = null;
    // Every file this run put on disk under the unit's name, for the receipt
    // a later rename reads to know what is still its own (issue #2680).
    let owned: ExportedFile[] = exported.owned;

    // The build picture, if one has been taken. Its own step because it is
    // write once: a picture in the game that the builder did not write is the
    // game maker's, and the receipt's digest is how that is told. A failure
    // here is reported and does not undo the export above.
    let picturePath: string | null = null;
    let pictureKept = false;
    let pictureProblem: string | null = null;
    if (withPicture && project.picture) {
      try {
        const placed = await legoExportPicture({
          dir,
          unitName: project.unitName,
          id: project.id,
          written: pictureDigest(folderReceipt, dir, project.unitName),
        });
        pictureKept = placed.kept;
        picturePath = placed.kept ? null : placed.path;
        owned = [...owned, ...placed.owned];
      } catch (error) {
        pictureProblem = error instanceof Error ? error.message : String(error);
      }
    }

    try {
      // The mask is not a colour map, so it goes beside whichever file is
      // written rather than into a material slot that would misdescribe it.
      // A mixed unit's two sheets go the way an imported unit's own
      // textures do.
      const pictures = sheet ? sheet.blender : blender;
      const place = pictures?.mask ? [pictures.mask] : [];

      if (withGlb && (pictures || installed)) {
        const colourUrl = await glbColourUrl(sheet, facts);
        const bytes = await exportGlb(project, pack, raw, colourUrl, sheet?.uv);
        if (bytes) {
          const glbWritten = await legoExportGlb({
            dir,
            unitName: project.unitName,
            bytes: Array.from(new Uint8Array(bytes)),
            textures: place,
          });
          glbPath = glbWritten.path;
          written = [...written, ...glbWritten.textures];
          owned = [...owned, ...glbWritten.owned];
        }
      }

      if (withObj && (pictures || installed)) {
        const objBuild = buildObj(project, pack, raw, {
          unitName: project.unitName,
          textureName: pictures
            ? (pictures.colour?.writeAs ?? null)
            : atlasFile,
          maskName: pictures?.mask?.writeAs,
          sheet: sheet?.uv,
        });
        if (objBuild) {
          const objWritten = await legoExportObj({
            dir,
            unitName: project.unitName,
            obj: objBuild.obj,
            mtl: objBuild.mtl,
            atlas:
              !pictures && installed
                ? { name: atlas, pack: installed.folder, writeAs: atlasFile }
                : null,
            // The colour texture as well this time: an `.mtl` names a file
            // beside it rather than carrying the picture the way a `.glb`
            // does.
            textures: pictures
              ? [pictures.colour, ...place].filter((t) => t !== null)
              : [],
          });
          objPath = objWritten.obj;
          mtlPath = objWritten.mtl;
          written = [...written, ...objWritten.textures];
          owned = [...owned, ...objWritten.owned];
        }
      }
    } catch (error) {
      blenderProblem = error instanceof Error ? error.message : String(error);
    }

    // Only on the way out of a successful export, so the receipt never claims
    // a folder holds a unit that failed to reach it. A re-export overwrites
    // the receipt for its folder, which is what keeps a second run from
    // becoming a second unit (issue #2651). The receipts for other folders are
    // kept (issue #4267). Where the name
    // changed, the receipt it replaces is moved aside rather than dropped,
    // since the files under the old name are still in the folder and after
    // this nothing else knows they are there (issue #2680).
    const settings = {
      exportDir: dir,
      exportTexture: withTexture,
      exportOverwriteTexture: withOverwriteTexture,
      exportScript: withScript,
      exportGlb: withGlb,
      exportObj: withObj,
    };
    const next = {
      dir,
      at: new Date().toISOString(),
      unitName: project.unitName,
      // What the file got from coilbox, not only what this build gives:
      // a field kept because it was edited stays at the value last
      // written, so the next export still sees the edit.
      def: receiptDef(def, folderReceipt, dir, project.unitName, exported),
    };
    if (target.loadoutId)
      onRememberLoadout(target.loadoutId, settings, next, owned);
    else onRemember({ ...settings, ...recordExport(project, next, owned) });
    return {
      state: "done",
      ...exported,
      built: def,
      weaponSlots: weapons.slots.length,
      weaponsMissing: weapons.missing,
      glb: glbPath,
      obj: objPath,
      mtl: mtlPath,
      picture: picturePath,
      pictureKept,
      pictureProblem,
      // Both Blender files write the mask, into the same folder under the
      // same name, so a run that wrote both reports it once.
      blenderTextures: written.filter(
        (t, i) => written.findIndex((other) => other.path === t.path) === i,
      ),
      blenderProblem,
    };
  }

  async function runExport() {
    const targets = exportTargets(whole, scope);
    setResult({ state: "working" });
    setBatch(null);
    if (scope === "active" || targets.length === 1) {
      try {
        setResult(await exportOne(targets[0]));
      } catch (error) {
        setResult({
          state: "failed",
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
    // Every loadout in turn. One that cannot be written is reported and the
    // rest still go, since they are separate units.
    const lines: BatchLine[] = [];
    for (const target of targets) {
      try {
        await exportOne(target);
        lines.push({ unitName: target.unit.unitName, problem: null });
      } catch (error) {
        lines.push({
          unitName: target.unit.unitName,
          problem: error instanceof Error ? error.message : String(error),
        });
      }
    }
    setBatch(lines);
    setResult({ state: "idle" });
  }

  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-50 flex w-[460px] max-w-[92vw] flex-col border-l border-border bg-background shadow-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right">
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
            <DialogPrimitive.Title className="text-base font-semibold">
              Export {project.unitName}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="size-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>

          <div className="flex flex-col gap-5 overflow-y-auto px-5 pt-4 pb-8">
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Game folder</span>
              <p className="text-xs text-muted-foreground">
                The folder holding <code>objects3d</code> and{" "}
                <code>unittextures</code>. For a game you are working on, that
                is the <code>.sdd</code> directory.
              </p>
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate rounded border border-border px-2 py-1 text-xs">
                  {dir || "Nothing chosen"}
                </span>
                <Button variant="outline" size="sm" onClick={chooseFolder}>
                  <FolderOpen className="size-4" /> Choose
                </Button>
              </div>
            </div>

            {whole.loadouts ? (
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">Loadouts</span>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={scope}
                  aria-label="Which loadouts to export"
                  onValueChange={(value) => {
                    if (value === "active" || value === "all") setScope(value);
                  }}
                >
                  <ToggleGroupItem value="active">This loadout</ToggleGroupItem>
                  <ToggleGroupItem value="all">All loadouts</ToggleGroupItem>
                </ToggleGroup>
                <ul className="flex flex-col gap-1.5">
                  {whole.loadouts.map((loadout) => {
                    const name = loadoutNames.get(loadout.id) ?? "";
                    const written =
                      scope === "all" || loadout.id === whole.activeLoadout;
                    return (
                      <li
                        key={loadout.id}
                        className={`flex items-center gap-2 text-xs ${written ? "" : "opacity-50"}`}
                      >
                        <span className="w-28 shrink-0 truncate">
                          {loadout.name}
                        </span>
                        {overBudget.has(loadout.id) ? (
                          <span className="shrink-0 text-destructive">
                            Over budget
                          </span>
                        ) : null}
                        <Input
                          key={`${loadout.id}:${name}`}
                          aria-label={`Unit name for ${loadout.name}`}
                          className="h-7 text-xs"
                          defaultValue={name}
                          onBlur={(event) => {
                            if (event.currentTarget.value !== name)
                              onLoadoutUnitName(
                                loadout.id,
                                event.currentTarget.value,
                              );
                          }}
                        />
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Unit definition</span>
              <p className="text-xs text-muted-foreground">
                Export always writes <code>{project.unitName}.lua</code> to{" "}
                <code>units</code>, the definition the engine spawns from. There
                is no checkbox for it: without one, the engine has nothing to
                give a model to. A re-export updates only the fields the build
                decides, and never one you have changed.
              </p>
            </div>

            {/* Named before the export because it is the one thing here whose
                destination depends on the game rather than on the unit, and
                because the wrong answer is invisible in coilbox and wrong only
                in the game (issue #2683). */}
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">This unit's name</span>
              {gameText.state === "reading" ? (
                <p className="text-xs text-muted-foreground">
                  Reading what this game names its units in.
                </p>
              ) : gameText.state === "failed" ? (
                <p className="text-xs text-destructive">
                  This game has a <code>{languageUnitsFile(language)}</code>{" "}
                  that will not read, so coilbox cannot tell where it names its
                  units: {gameText.message}. The name goes into the definition,
                  which is where most games read it. If the game reads names out
                  of that file instead, this unit will show as{" "}
                  <code>units.names.{project.unitName}</code> until the file is
                  fixed.
                </p>
              ) : writesLanguage ? (
                <p className="text-xs text-muted-foreground">
                  This game names its units in{" "}
                  <code>{languageUnitsFile(language)}</code> rather than in
                  their definitions, so <strong>{project.name}</strong> goes
                  into <code>language/{language}/coilbox.json</code> beside it.
                  That is coilbox's own file, holding the names of the units
                  coilbox put in this folder and nothing else. The game's own
                  file is never opened for writing.
                </p>
              ) : gameNamesThisUnit ? (
                <p className="text-xs text-muted-foreground">
                  This game already names a unit <code>{project.unitName}</code>{" "}
                  in <code>{languageUnitsFile(language)}</code>, so coilbox
                  writes no name for it. That unit's definition is the game's
                  own and is left alone too.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  <strong>{project.name}</strong> goes into the definition, as{" "}
                  <code>name</code> and <code>description</code>, which is where
                  the engine and nearly every game read it.
                </p>
              )}
            </div>

            <div className="flex items-start gap-2">
              <Checkbox
                id="lego-export-script"
                checked={withScript}
                onCheckedChange={(checked) => setWithScript(checked === true)}
                className="mt-0.5"
              />
              <div>
                <Label htmlFor="lego-export-script">
                  Write the unit script
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Puts <code>{project.unitName}.lua</code> in{" "}
                  <code>scripts</code>,{" "}
                  {project.script === undefined
                    ? "generated from the animations applied to this unit"
                    : "the script this unit owns, exactly as it stands"}
                  . A script you have changed is never overwritten.
                </p>
              </div>
            </div>

            {/* Named before the export rather than only in the list of what was
                written, because it is a file nobody asked for by name and it
                lands in somebody else's game folder. */}
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Piece collision</span>
              <p className="text-xs text-muted-foreground">
                Export always writes{" "}
                <code className="break-all">
                  scripts/{pieceCollisionScriptPath(project.unitName)}
                </code>
                , the Lua that gives this unit's pieces the collision boxes set
                in the collision panel. No checkbox and no keeping an older
                copy: this one is coilbox's own and is rewritten every time, so
                it stays in step with the unit even once the script beside it
                belongs to you. A unit that changes nothing gets an empty file,
                since the script's <code>include</code> has to find something.
              </p>
            </div>

            {sheetFrom ? (
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">Texture sheet</span>
                <p className="text-xs text-muted-foreground">
                  This unit mixes parts with pieces lifted from a game, so
                  export always writes one sheet of their textures,{" "}
                  <code>{sheetNames.texture1}</code>, and one of their second
                  textures, <code>{sheetNames.texture2}</code>, to{" "}
                  <code>unittextures</code>. Both are made again from the build
                  every time, from:
                </p>
                <ul className="text-xs text-muted-foreground">
                  {sheetFrom.map((source) => (
                    <li key={source.id}>{source.label}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">
                  {imported ? "Textures" : "Texture"}
                </span>
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="lego-export-texture"
                    checked={withTexture && (imported ? true : !!installed)}
                    disabled={!imported && !installed}
                    onCheckedChange={(checked) =>
                      setWithTexture(checked === true)
                    }
                    className="mt-0.5"
                  />
                  <div>
                    <Label htmlFor="lego-export-texture">
                      Also place the {imported ? "textures" : "texture"}
                    </Label>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {imported ? (
                        <>
                          Copies this unit's own{" "}
                          {imported.place.length === 1 ? "texture" : "textures"}{" "}
                          into <code>unittextures</code>, under the{" "}
                          {imported.place.length === 1 ? "name" : "names"} the
                          model already gives{" "}
                          {imported.place.length === 1 ? "it" : "them"}. A file
                          already at that name is left alone unless "Replace
                          textures already there" below is checked, since it may
                          be the game's own.
                        </>
                      ) : (
                        <>
                          Copies the atlas into <code>unittextures</code> as{" "}
                          <code>{atlasFile}</code>. Every unit sampling this
                          atlas uses it, so this only needs doing once per game.
                          A file already at that name is left alone unless
                          "Replace textures already there" below is checked.
                        </>
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-2">
                  <Checkbox
                    id="lego-export-texture-overwrite"
                    checked={withOverwriteTexture}
                    disabled={!imported && !installed}
                    onCheckedChange={(checked) =>
                      setWithOverwriteTexture(checked === true)
                    }
                    className="mt-0.5"
                  />
                  <div>
                    <Label htmlFor="lego-export-texture-overwrite">
                      Replace {imported ? "textures" : "a texture"} already
                      there
                    </Label>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Off by default, so a file the game already has under that
                      name is left alone, since it may be the game's own. Turn
                      this on to overwrite it with this export's copy instead.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {imported || installed || sheetFrom ? null : (
              <p className="text-xs text-muted-foreground">
                <code>{atlas}</code> is not installed, so the texture cannot be
                copied and the Blender files cannot be written. The{" "}
                <code>.s3o</code> still names it, so installing the atlas pack
                and exporting again completes the unit.
              </p>
            )}

            <div className="flex flex-col gap-2 border-t border-border/60 pt-4">
              <span className="text-sm font-medium">For Blender</span>
              <p className="text-xs text-muted-foreground">
                Neither is read by the engine. Both are for taking the unit into
                Blender, to check it against the <code>.s3o</code> or finish it
                by hand, and both go into a <code>blender</code> folder
                alongside the game's own.
              </p>
              {blender ? (
                <p className="text-xs text-muted-foreground">
                  Blender reads no <code>.dds</code>, so this unit's textures
                  are decoded to PNG on the way in, and one over 2048 across is
                  written smaller. The full size copy still goes to{" "}
                  <code>unittextures</code> for the engine.
                  {blender.mask ? (
                    <>
                      {" "}
                      <code>{blender.mask.writeAs}</code> goes in beside them:
                      it is the model's second texture, which the engine reads
                      as glow, shine and visibility rather than as colour, so
                      neither file samples it.
                    </>
                  ) : null}
                </p>
              ) : null}
            </div>

            <div className="flex items-start gap-2">
              <Checkbox
                id="lego-export-glb"
                checked={withGlb && (blender || sheetFrom ? true : !!installed)}
                disabled={!blender && !installed && !sheetFrom}
                onCheckedChange={(checked) => setWithGlb(checked === true)}
                className="mt-0.5"
              />
              <div>
                <Label htmlFor="lego-export-glb">Also write a .glb</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  <code>{project.unitName}.glb</code>, with{" "}
                  {blender ? (
                    blender.colour ? (
                      <>
                        <code>{blender.colour.writeAs}</code> embedded
                      </>
                    ) : (
                      "no texture, since this unit's could not be found"
                    )
                  ) : (
                    "the texture embedded"
                  )}
                  .
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2 pl-6">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={
                    (!blender && !installed && !sheetFrom) ||
                    glbSave.state === "working" ||
                    heldBack !== null
                  }
                  onClick={() => void saveGlb()}
                >
                  {glbSave.state === "working" ? "Saving" : "Save GLB…"}
                </Button>
                <span className="text-xs text-muted-foreground">
                  Builds a .glb on its own and saves it wherever you like,
                  without touching the game folder.
                </span>
              </div>
              {glbSave.state === "done" ? (
                <div className="flex items-center gap-2 text-xs">
                  <code className="break-all">{glbSave.path}</code>
                  <ShowMe path={glbSave.path} variant="ghost" />
                </div>
              ) : null}
              {glbSave.state === "failed" ? (
                <p className="text-xs text-destructive">{glbSave.message}</p>
              ) : null}
            </div>

            <div className="flex items-start gap-2">
              <Checkbox
                id="lego-export-obj"
                checked={withObj && (blender || sheetFrom ? true : !!installed)}
                disabled={!blender && !installed && !sheetFrom}
                onCheckedChange={(checked) => setWithObj(checked === true)}
                className="mt-0.5"
              />
              <div>
                <Label htmlFor="lego-export-obj">
                  Also write an .obj and .mtl
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  <code>{project.unitName}.obj</code> and{" "}
                  <code>{project.unitName}.mtl</code>
                  {blender && !blender.colour ? (
                    ", with no material texture, since this unit's could not be found."
                  ) : (
                    <>
                      , with a copy of{" "}
                      <code>
                        {sheetFrom
                          ? sheetNames.texture1
                          : blender
                            ? blender.colour?.writeAs
                            : atlasFile}
                      </code>{" "}
                      next to them so the material resolves.
                    </>
                  )}
                </p>
              </div>
            </div>

            {claimable
              .filter((unit) => definitionsThere.includes(unit.path))
              .map((unit) => (
                <div
                  key={unit.path}
                  className="flex items-center gap-2 text-xs"
                >
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={adopting}
                    title={unit.path}
                    onClick={() => void adoptDefinition(unit)}
                  >
                    {unit.id
                      ? `Treat ${unit.unitName}.lua as coilbox's`
                      : "Treat this file as coilbox's"}
                  </Button>
                </div>
              ))}

            {/* What a rename left in the game folder. Shown rather than cleared
                on its own: two units under two names is occasionally what
                somebody wanted, and a game folder is theirs. But it is never
                left unsaid, which is the bug in issue #2680. */}
            {leftovers && leftovers.length > 0 ? (
              <div className="flex flex-col gap-3 rounded border border-border bg-muted/40 p-3">
                <span className="text-sm font-medium">
                  Left behind by a rename
                </span>
                <p className="text-xs text-muted-foreground">
                  Export names its files after the unit, so renaming one and
                  exporting again writes a second set rather than moving the
                  first. The game reads what is left as another unit, which it
                  will build and spawn.
                </p>
                {leftovers.map((entry) => (
                  <div
                    key={`${entry.stale.dir}/${entry.stale.unitName}`}
                    className="flex flex-col gap-1.5 text-xs"
                  >
                    <span className="font-medium">
                      Still there as <code>{entry.stale.unitName}</code>
                    </span>
                    {entry.ours.map((path) => (
                      <code key={path} className="break-all">
                        {path}
                      </code>
                    ))}
                    {/* The explanation goes above the paths it is about, so it
                        is clear which of the files it names. */}
                    {entry.kept.length > 0 ? (
                      <>
                        <p className="pt-1 text-muted-foreground">
                          {entry.kept.length === 1
                            ? "This one is not"
                            : "These are not"}{" "}
                          what coilbox wrote, so removing{" "}
                          {entry.kept.length === 1 ? "it" : "them"} is not
                          offered. Either the file was edited after the export,
                          or the game had one of that name already.
                        </p>
                        {entry.kept.map((path) => (
                          <code key={path} className="break-all">
                            {path}
                          </code>
                        ))}
                      </>
                    ) : null}
                    <div className="flex flex-wrap gap-2 pt-0.5">
                      {entry.ours.length > 0 ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={clearing !== null}
                          onClick={() => void clearStale(entry)}
                        >
                          {clearing === entry.stale.unitName
                            ? "Removing"
                            : `Remove the ${entry.ours.length} file${entry.ours.length === 1 ? "" : "s"}`}
                        </Button>
                      ) : null}
                      <ShowMe
                        path={entry.ours[0] ?? entry.kept[0]}
                        variant="ghost"
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {project.picture ? (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="lego-export-picture"
                  checked={withPicture}
                  onCheckedChange={(checked) =>
                    setWithPicture(checked === true)
                  }
                />
                <Label htmlFor="lego-export-picture">
                  Also write the build picture
                </Label>
              </div>
            ) : null}

            <div className="flex flex-col gap-2 border-t border-border/60 pt-4">
              {credits.length > 0 ? (
                <ul className="text-xs text-muted-foreground">
                  {credits.map((credit) => (
                    <li key={credit}>{credit}</li>
                  ))}
                </ul>
              ) : null}
              {heldBack ? (
                <p className="text-xs text-muted-foreground">{heldBack}</p>
              ) : null}
              <Button
                onClick={() => void runExport()}
                disabled={
                  !dir || result.state === "working" || heldBack !== null
                }
              >
                {result.state === "working" ? "Exporting" : "Export"}
              </Button>
            </div>

            {batch ? (
              <ul className="flex flex-col gap-1 text-xs">
                {batch.map((line) => (
                  <li
                    key={line.unitName}
                    className={line.problem ? "text-destructive" : undefined}
                  >
                    {line.problem
                      ? `${line.unitName} was not written: ${line.problem}`
                      : `${line.unitName} written`}
                  </li>
                ))}
              </ul>
            ) : null}

            {result.state === "done" ? (
              <div className="flex flex-col gap-2 text-xs">
                <p className="text-muted-foreground">Written:</p>
                <code className="break-all">{result.model}</code>
                {result.texture ? (
                  <code className="break-all">{result.texture}</code>
                ) : null}
                {result.textureKept ? (
                  <p className="text-muted-foreground">
                    A texture called <code>{atlasFile}</code> was already there
                    and has been left alone. Turn on "Replace textures already
                    there" and export again to replace it.
                  </p>
                ) : null}
                {result.textures.map((written) => (
                  <code key={written} className="break-all">
                    {written}
                  </code>
                ))}
                {result.texturesKept.length > 0 ? (
                  <p className="text-muted-foreground">
                    {result.texturesKept.join(", ")} was already there and has
                    been left alone, since that name is the game's own. Turn on
                    "Replace textures already there" and export again to replace
                    it.
                  </p>
                ) : null}
                {result.script ? (
                  <code className="break-all">{result.script}</code>
                ) : null}
                {result.scriptKept ? (
                  <p className="text-muted-foreground">
                    The unit script there has been changed since coilbox wrote
                    it, or coilbox did not write it, so it has been left alone.
                  </p>
                ) : null}
                {result.cobVars ? (
                  <code className="break-all">{result.cobVars}</code>
                ) : null}
                {result.cobVars || result.cobVarsKept ? (
                  <p className="text-muted-foreground">
                    {result.cobVarsKept
                      ? "lualibs/cob_vars.lua was already there and has been left alone. "
                      : null}
                    This unit's script can keep shared COB unit values as rules
                    params. For the game's synced gadgets to set them, and its
                    gadgets and widgets to read them, put{" "}
                    <code>VFS.Include("lualibs/cob_vars.lua")</code> on the
                    first line of <code>LuaRules/main.lua</code>,{" "}
                    <code>LuaRules/draw.lua</code> and <code>luaui.lua</code>{" "}
                    (or <code>LuaUI/main.lua</code>).
                  </p>
                ) : null}
                {result.pieceCollision ? (
                  <code className="break-all">{result.pieceCollision}</code>
                ) : null}
                {result.unitDef ? (
                  <code className="break-all">{result.unitDef}</code>
                ) : null}
                {result.unitDefKept ? (
                  <KeptDefinition
                    kept={result.unitDefKept}
                    weapons={result.weaponSlots > 0}
                  />
                ) : null}
                <FieldChanges
                  changes={result.unitDefFields}
                  built={result.built}
                />
                {result.wreckModel ? (
                  <code className="break-all">{result.wreckModel}</code>
                ) : null}
                {result.wreckFeature ? (
                  <code className="break-all">{result.wreckFeature}</code>
                ) : null}
                {result.wreckFeatureKept ? (
                  <p className="text-muted-foreground">
                    The wreck's feature file there has been changed since
                    coilbox wrote it, or coilbox did not write it, so it has
                    been left alone.
                  </p>
                ) : null}
                {result.weapons.map((written) => (
                  <code key={written} className="break-all">
                    {written}
                  </code>
                ))}
                {result.weaponsMissing.map((line) => (
                  <p key={line} className="text-destructive">
                    Weapon left out: {line}
                  </p>
                ))}
                {result.language ? (
                  <code className="break-all">{result.language}</code>
                ) : null}
                {result.picture ? (
                  <code className="break-all">{result.picture}</code>
                ) : null}
                {result.pictureKept ? (
                  <p className="text-muted-foreground">
                    A build picture was already there that coilbox did not
                    write, and has been left alone.
                  </p>
                ) : null}
                {result.pictureProblem ? (
                  <p className="text-destructive">
                    The unit is exported, but the build picture is not:{" "}
                    {result.pictureProblem}
                  </p>
                ) : null}
                {result.glb ? (
                  <code className="break-all">{result.glb}</code>
                ) : null}
                {result.obj ? (
                  <code className="break-all">{result.obj}</code>
                ) : null}
                {result.mtl ? (
                  <code className="break-all">{result.mtl}</code>
                ) : null}
                {result.blenderTextures.map((written) => (
                  <code key={written.path} className="break-all">
                    {written.path}
                  </code>
                ))}
                {result.blenderTextures.some((written) => written.scaled) ? (
                  <p className="text-muted-foreground">
                    A texture larger than 2048 was written smaller for Blender,
                    at{" "}
                    {result.blenderTextures
                      .filter((written) => written.scaled)
                      .map((written) => `${written.width}x${written.height}`)
                      .join(", ")}
                    . The game's own copy in <code>unittextures</code> is
                    untouched.
                  </p>
                ) : null}
                {result.blenderProblem ? (
                  <p className="text-destructive">
                    The unit is exported, but the Blender files are not:{" "}
                    {result.blenderProblem}
                  </p>
                ) : null}
                <ShowMe path={result.model} />
              </div>
            ) : null}

            {result.state === "failed" ? (
              <p className="text-xs text-destructive">{result.message}</p>
            ) : null}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
