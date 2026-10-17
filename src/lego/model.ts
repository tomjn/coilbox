/**
 * The unit builder's document.
 *
 * TypeScript owns this schema and Rust stores it as an opaque string, the same
 * seam campaigns use. Everything here is pure, so the rules can be tested
 * without a renderer or a filesystem.
 *
 * A piece is either geometry, when it has a `partId` or a `meshId`, or empty.
 * Empty pieces are not a coilbox invention: an s3o piece with no vertices is
 * how the format carries hierarchy, and how flares, aim points and build
 * emitters are expressed. They survive export. Anchors derived from a part's
 * bounding box do not, and exist only to snap against.
 *
 * A unit is either built out of the parts pack, where pieces name parts that
 * sample one atlas, or imported whole from somebody else's `.s3o`, where every
 * piece names a mesh and the unit draws with its own texture.
 * `project.imported` is what says which kind a unit is. A part cannot go into
 * an imported unit: its UVs point onto the atlas, and the unit has one texture.
 *
 * A unit of parts can also hold pieces lifted off its own game's units (#3259).
 * Each of those names a mesh and carries the texture its UVs point onto in
 * `lifted`, so it draws with that rather than the atlas. Its mesh is copied into
 * the unit's own sidecar when it goes in. The lifted pieces have to be from the
 * unit's game, which `projectProblems` checks.
 */

import { comparablePath } from "./exportRecord";
import { type Problem, type ProblemSeverity, problem } from "./problems";
import type { RawGeometry } from "./rawGeometry";
import { ringMembers, validRingCount } from "./ringSet";
import { liftRefusal } from "./unitGame";
import { type LegoWorth, parseWorth } from "./worth";

export const LEGO_SCHEMA_VERSION = 1;

/** Extra snap targets beyond the ones derived from a part's bounding box. */
export interface LegoAnchor {
  id: string;
  name: string;
  position: [number, number, number];
  /**
   * The way out of the part at this anchor, which makes the anchor a connector
   * (issue #3290): a join through it points the joined part along this. Unit
   * length. Absent on an anchor saved before connectors, which then faces out
   * of the nearest face of its part's bounding box (`customConnectors`).
   */
  facing?: [number, number, number];
  /** Along the face and at right angles to `facing`, fixing the twist. Unit
   *  length. Absent means the default for the facing. */
  up?: [number, number, number];
}

/**
 * How a piece is joined to its parent (issue #3273): which of its own
 * connectors meets which connector on the parent, where along the parent's face
 * and with what twist. The connectors themselves belong to the parts, see
 * `connectors.ts`, so this names them by id rather than copying them.
 *
 * The piece's `position` and `rotation` are still stored, as the result of
 * resolving this. Every reader of a transform keeps reading those, and an edit
 * that could move the piece resolves the connection again (`resolveConnections`).
 */
export interface LegoConnection {
  /** The connector on this piece's own part that does the joining. */
  connector: string;
  /** The connector on the parent piece's part it joins. */
  to: string;
  /**
   * How far from the parent connector the join sits, along the parent's face:
   * first along the connector's side direction, then along its up direction,
   * in the parent's own units. Absent means on the connector itself.
   */
  offset?: [number, number];
  /** Radians about the parent connector's facing, turning the piece on the
   *  face. Absent means none. */
  twist?: number;
}

/**
 * Which of a module's connectors joins the unit it is dropped onto (#3297).
 *
 * Names a piece of the module by id and one of that piece's connectors by id,
 * the same connector ids a `LegoConnection` uses. Only a module carries one.
 */
export interface LegoMount {
  piece: string;
  connector: string;
}

/**
 * The shapes the engine will build a collision volume out of.
 *
 * These exact strings because of how the engine reads them: `CollisionVolume`
 * looks at the first character to pick the shape and the last to pick a
 * cylinder's axis, and anything it does not recognise falls through to a
 * sphere. `"cylx"` therefore has to keep both ends, and a typo like `"cube"`
 * would quietly become a sphere rather than fail.
 */
export type CollisionVolumeType =
  | "box"
  | "sphere"
  | "ellipsoid"
  | "cylx"
  | "cyly"
  | "cylz";

/** Every value `type` may take, for validating one that came off disk. */
const COLLISION_VOLUME_TYPES: CollisionVolumeType[] = [
  "box",
  "sphere",
  "ellipsoid",
  "cylx",
  "cyly",
  "cylz",
];

export interface LegoCollisionVolume {
  type: CollisionVolumeType;
  /**
   * The volume's full extent along x, y and z in elmos, not its radii: the
   * engine halves these itself.
   */
  scales: [number, number, number];
  /** From the middle of the model, which is the centre of its bounding box. */
  offsets: [number, number, number];
}

/**
 * What one piece is hit with, when the box the engine measures for it is the
 * wrong answer.
 *
 * The engine builds a box round every piece's own vertices as the model loads
 * and nothing declares that, so this is not a volume the export can write down.
 * It is applied on the live unit by `Spring.SetUnitPieceCollisionVolumeData`,
 * out of the file `pieceCollisionScript.ts` generates. See that file for why it
 * is a file of its own rather than something in the unit script.
 */
export interface LegoPieceCollision {
  /** False tells the engine to hit nothing on this piece at all. */
  hit: boolean;
  /**
   * Absent means the box the engine measures off the piece's own vertices,
   * which is what a piece switched off but not resized carries.
   *
   * Its offsets are in the piece's own space, unlike the unit volume's, which
   * are measured from the aim point.
   */
  volume?: LegoCollisionVolume;
}

/**
 * A texture in the shared store, which is where an imported unit's textures
 * live.
 *
 * `key` is content addressed, `<sha256>.<ext>`, so two units naming the same
 * file hold one copy of it and a file edited outside coilbox gets a new key
 * rather than being served from a stale cache. `name` is what the file was
 * called where it came from, which is what the model header names and what an
 * export writes it back out as. `source` is where it was read from, which is
 * what refreshing it re-reads.
 *
 * `source` is absent whenever there is no file to go back to. A model unpacked
 * out of a packed archive is read out of a temp folder the operating system
 * reclaims, so a path recorded against one points at nothing an hour later
 * (#1903). Refresh is off in that case and says to choose a file, which is the
 * honest answer: coilbox already has its own copy, and the archive never held a
 * path to hand back.
 */
export interface LegoTexture {
  key: string;
  name: string;
  source?: string;
}

/**
 * A unit imported whole from somebody else's `.s3o`, rather than built out of
 * the parts pack.
 *
 * The meshes are not here. They live in `lego/geometry/<projectId>.bin.gz`,
 * because the largest model measured is 15.0 MB as JSON against 3.1 MiB packed
 * and undo keeps sixty whole documents. See `rawGeometry.ts`.
 *
 * The textures are a pointer to what to draw with and nothing more. Changing
 * one swaps the texture and leaves the geometry and its UVs exactly as they
 * are: whether the new image suits them is the user's call to make and to undo.
 */
/**
 * The game a model was opened out of, recorded at the moment it was picked.
 *
 * Only a unit opened through the game picker has one. A unit opened through the
 * file dialog has {@link LegoImported.source} and nothing else, and reading a
 * game's name back out of a path is guesswork, so this is the field anything
 * grouping units by game reads first (#1819).
 */
/**
 * Whether a game archive is a loose folder, so what it names are real files.
 *
 * A `.sdd` is a directory: its models and textures are on disk under their own
 * paths, and an import reads them where they lie. Every other kind holds its
 * members with no path to them, so an import has to unpack what it wants into a
 * temp folder first, and nothing it read is still there afterwards.
 */
export function isLooseArchive(archive: string): boolean {
  return archive.toLowerCase().endsWith(".sdd");
}

export interface LegoImportedGame {
  /** The game's name as unitsync reports it, which is what a list shows. */
  name: string;
  /** The primary archive's file name, e.g. `SpringMCLegacy.sdd`. The identity
   *  behind the name, since two installs of one game share a name and a version
   *  bump changes it. */
  archive: string;
  /** Where the model sits inside that archive, e.g. `objects3d/arm/com.s3o`. */
  member: string;
  /** The unitdef that names this model, when one does. Absent for a feature, a
   *  wreck, or anything else no unitdef points at. */
  unit?: string;
}

/** One installed game as unitsync reported it when it was chosen. */
export interface LegoGameRef {
  /** The game's name as unitsync reports it, which is what a list shows. */
  name: string;
  /** The primary archive's file name. Pins one build, and is what a read of
   *  the game takes. */
  archive: string;
  /** The modinfo short name, which stays the same across versions. Absent
   *  when the game's modinfo has none. */
  shortname?: string;
  /** The modinfo version, when it has one. */
  version?: string;
}

/**
 * The game a unit is for (issue #3257). See `unitGame.ts` for how two of these
 * are compared.
 */
export interface LegoUnitGame extends LegoGameRef {
  /** When the game is a mutator, the game it builds on, traced through any
   *  mutator in between. Kept so the comparison still works once neither is
   *  installed. */
  base?: LegoGameRef;
}

/**
 * Where a piece lifted off one of a game's units came from (issue #3262).
 *
 * Kept on every piece rather than on the module, so it stays with a piece that
 * is copied or moved. It is what keeps the piece in units for its own game
 * (#3268) and off the hub (#3272), so nothing in the builder removes it.
 */
export interface LegoLifted {
  /** The game the piece was read from, recorded as a unit records its game so
   *  the two compare with `sameGame`. */
  game: LegoUnitGame;
  /** The model inside that game's archive, e.g. `objects3d/armcom.s3o`. */
  member: string;
  /** The unitdef that names the model. */
  unit?: string;
  /** The model's colour texture, which the piece's UVs point onto. Kept on the
   *  piece so it still draws with it inside a unit of parts (#3259). */
  texture?: LegoTexture;
  /** The model's second texture, whose alpha hides pixels. */
  texture2?: LegoTexture;
}

/**
 * What a unit that builds is worth, as three unit definition keys.
 *
 * All three go in together, and that is not tidiness. `UnitDef::IsBuilderUnit`
 * is `builder && buildSpeed > 0 && buildDistance > 0`, and `builder` is then
 * `&=`'d against it, so `builder = true` with the engine's own `workerTime`
 * default of zero clears itself and the unit is silently not a builder.
 */
export interface LegoBuilder {
  /** Written as `workerTime`. Build, repair, reclaim and capture speed all
   *  default to this one number. */
  workerTime?: number;
  /** How far it reaches, in elmos. The engine clamps this up to 38. */
  buildDistance?: number;
  /** Whether it can help another unit's build. The engine defaults this to
   *  whatever `builder` is, so absent means true for a builder. */
  canAssist?: boolean;
}

/** What a unit with no `builder` block of its own is worth. `workerTime` has to
 *  be above zero or the engine discards the whole thing: see `LegoBuilder`. */
export const DEFAULT_BUILDER: Required<LegoBuilder> = {
  workerTime: 100,
  buildDistance: 128,
  canAssist: true,
};

/**
 * How the unit moves, once the game maker has picked one of the game's movement
 * classes for it (issue #3255). Absent means it does not move. See `movement.ts`.
 */
export interface LegoMovement {
  /** A class out of the game's `gamedata/movedefs.lua`, as the game spells it. */
  moveClass: string;
  /** Written as `speed`, in elmos a second. Absent until somebody or the game
   *  gives it one, and the unit stays static to the engine until then. */
  speed?: number;
  /** Written as `turnRate`, in the engine's angular units a second. */
  turnRate?: number;
  /** Written as `rSpeed`, in elmos a second. Absent means the unit never
   *  backs up, which is the engine's default of 0. */
  reverseSpeed?: number;
  /** Written as `acceleration`, in elmos a frame squared (the unit the engine
   *  reads it in, and the one BA and Splinter Faction write). */
  acceleration?: number;
  /** Written as `brakeRate`, in the same unit. Absent means the engine brakes
   *  at the acceleration. */
  brakeRate?: number;
  /** Where `speed` came from, when the game suggested it. Gone once it is set
   *  by hand. */
  speedFrom?: string;
  /** Where `turnRate` came from, the same way. */
  turnRateFrom?: string;
  /** Where `reverseSpeed` came from, the same way. */
  reverseSpeedFrom?: string;
  /** Where `acceleration` came from, the same way. */
  accelerationFrom?: string;
  /** Where `brakeRate` came from, the same way. */
  brakeRateFrom?: string;
}

export interface LegoImported {
  /**
   * The `.s3o` this came from, for saying where the unit came from.
   *
   * A file the user pointed at, or, for a model picked out of a game, the
   * archive's own path with the member appended. The second is not a file that
   * can be opened when the archive is packed, so it is a description of where
   * the model was rather than somewhere to read it again.
   */
  source: string;
  /** Present when the model was picked by game and unit rather than by path. */
  game?: LegoImportedGame;
  /** What the unit is painted with. Absent when it could not be found. */
  texture?: LegoTexture;
  /**
   * The second texture an `.s3o` names: glow in red, reflectivity in green, and
   * in alpha the one-bit mask that says whether a pixel is drawn at all. Not
   * decoration. A unit that loses it draws the faces the game cuts away, which
   * is a solid rectangle where a radar dish or a fence should be.
   *
   * Named after the `.s3o` header's own field rather than after what the
   * channels mean, because the last name that made a claim about the meaning was
   * wrong for a year: it was `teamMask`, and the team-colour mask is the first
   * texture's alpha (#1910). A document written before the rename is read below.
   */
  texture2?: LegoTexture;
  /** The texture name the header gave when the file could not be found. */
  missingTexture?: string;
  missingTexture2?: string;
  /**
   * Set on a unit opened from a `.3do` since #4174, whose UVs count the rows of
   * its sheet from the top, which is how the engine reads the PNG. A `.3do`
   * opened before then counted them from the bottom, and has its meshes turned
   * round once when it is read: see `parseLegoProjectData`.
   */
  sheetFromTop?: true;
}

export interface LegoPiece {
  id: string;
  /** Lower case, unique, and safe as a Lua local, because scripts use it as one. */
  name: string;
  /**
   * The name this piece carried in the file it was imported from, before
   * `uniquePieceName` normalised that into `name`. Present only while the two
   * differ and nobody has touched the name since: `renameSelected` drops it the
   * moment a piece is renamed in the builder, and `insertCompound` drops it for
   * a piece pasted, duplicated or dropped in from the library, since neither is
   * the piece the file shipped any more.
   *
   * `SaveModelPopover`'s "Save model" writes this back in place of `name` when
   * it is set, so saving with no edits reproduces the file's own piece names
   * (#2613) instead of the normalised, deduplicated ones #873 introduced for
   * script generation. A full export and a test run write `name` regardless,
   * because the script they build addresses a piece by that name, not this one.
   */
  originalName?: string;
  parentId: string | null;
  /** Null for an empty piece: a hierarchy node, flare, aim point or emitter. */
  partId: string | null;
  /**
   * Geometry taken verbatim from an imported model, by its key in the project's
   * geometry sidecar. Set on a piece of an imported unit, or of a piece lifted
   * into the inventory, whose module has a sidecar of its own. `partId` is
   * then always null.
   */
  meshId?: string;
  /**
   * The box round the mesh `meshId` names, in the mesh's own space and before
   * the pivot, rotation and scale (#3269). A piece with a mesh has no part to
   * take faces from, so its connectors and pivot choices come from this.
   * Recorded when a piece is lifted, from the geometry. Absent on a piece that
   * has not been measured, which then has no connectors.
   */
  meshBox?: { min: [number, number, number]; max: [number, number, number] };
  /** Relative to the parent piece. */
  position: [number, number, number];
  /**
   * Where this piece's origin sits in its part, in the part's own space and
   * before rotation and scale. Absent means the part's middle, which is where
   * the pack recentres every part. This is the point the piece turns about.
   */
  pivot?: [number, number, number];
  /** Radians, XYZ euler. Baked into vertices on export, see the plan's D3. */
  rotation: [number, number, number];
  /**
   * A negative scale on one axis is a mirror, and the only record of one:
   * `mirror.ts` writes it and the exporter reverses winding on it. A separate
   * flag would be a second answer to the same question, free to disagree.
   */
  scale: [number, number, number];
  /** Drives which animation presets apply. Free-form until presets land. */
  role?: string;
  tags?: string[];
  /** Editor only, never affects export. */
  hidden?: boolean;
  customAnchors?: LegoAnchor[];
  /** Set on a piece lifted off a game's unit. See {@link LegoLifted}. */
  lifted?: LegoLifted;
  /**
   * Joined to the parent by a connector. Absent means a free piece, placed by
   * its own `position` and `rotation`, which is every piece made before #3273.
   */
  connection?: LegoConnection;
  /**
   * What this piece is hit with, when the box the engine measures round its own
   * vertices is not what should stop a shot. Absent means that box, which is
   * where every piece starts.
   */
  collision?: LegoPieceCollision;
  /**
   * Flip this piece's own UVs vertically (`v -> 1-v`), for a mesh imported
   * upside down. Only meaningful on a piece with a `meshId`: a part's UVs are
   * correct by construction, so this is never offered for one. See
   * `meshFix.ts`, which every reader of a piece's geometry goes through.
   */
  uvFlip?: boolean;
  /** Mirror this piece's own UVs horizontally (`u -> 1-u`). Same restriction
   *  as `uvFlip`. */
  uvMirror?: boolean;
  /**
   * Recompute this piece's vertex normals from its own geometry, smoothing
   * across faces within this many degrees of each other, rather than drawing
   * with whichever normals the source model shipped. Absent means the
   * imported normals, unmodified. See `meshFix.ts`.
   */
  normalsAngle?: number;
  /**
   * What a turret or aim point fires, and over what arc (issue #3274). Kept on
   * the piece so the weapon goes wherever the module goes: a copy, a mirrored
   * twin or a compound carries it, and deleting the turret deletes it. See
   * `weaponModule.ts`.
   */
  weapon?: LegoPieceWeapon;
  /**
   * The module insert this piece arrived in (#3302). Absent on a piece that
   * did not come from a module. See `LegoModuleRef`.
   */
  module?: LegoModuleRef;
  /**
   * The piece this one is the mirror twin of (#3315). Both pieces of a pair
   * name each other, so either can lead. Symmetry mode moves the other when one
   * is placed, across the centre line of the root (x = 0 in its space), which is
   * implied rather than stored: a piece with `twin` and no `ring` is one of a
   * mirror pair. Stored on the pieces, not as a list on the project, so a copy
   * carries it and the id remap in `compounds.ts` can reach it. Absent on a
   * piece with no twin, which is every piece of a unit saved before this
   * existed.
   */
  twin?: string;
  /**
   * One of a ring of copies spaced evenly round the root's vertical axis
   * (#3317). `next` is the member one step further round and `count` is how
   * many the ring has, original included. A piece is in a mirror pair or a
   * ring, never both. The count is per ring and not per project, because one
   * unit can have a ring of six wheels and a ring of four legs. See
   * `ringSet.ts`.
   */
  ring?: LegoPieceRing;
}

/** A piece's place in a ring of copies. See `LegoPiece.ring`. */
export interface LegoPieceRing {
  next: string;
  count: number;
}

/**
 * Which module a piece came from, and which insert of it.
 *
 * Every piece of one insert shares `instance`, so a unit holding the same
 * module twice can tell the two apart. The script builder groups a role's
 * pieces by instance, which is what lets a second build arm or a second set of
 * legs animate on its own (`roleInstances` in `luaScript.ts`).
 *
 * `insertCompound` writes it. A copy keeps the module id and gets an instance
 * of its own, and `reparentPiece` drops it from a piece moved out of its
 * instance.
 */
export interface LegoModuleRef {
  /** The module's own id, the `id` of the compound document. */
  id: string;
  /** Shared by every piece of one insert, and by no other piece. */
  instance: string;
  /**
   * The module's content stamp when it was inserted (`moduleStamp`, #3304).
   * Compared with the module's stamp now to tell the instance is out of date.
   * Absent on a piece inserted before this existed, which is never offered an
   * update because nothing says what it was inserted at.
   */
  rev?: string;
  /**
   * The piece's name and place when it was inserted (`pieceFingerprint`), so a
   * piece the user has renamed or moved since can be told from one they have
   * not.
   */
  fp?: string;
}

/**
 * The weapon a module fires. A game weapon is named as the game's weapon table
 * keys it. A library weapon is a reference into a workshop project, read again
 * on every export, so the workshop stays the one place it is edited (#3313).
 */
export type LegoWeaponRef =
  | { from: "game"; name: string }
  | { from: "library"; projectId: string; key: string };

export interface LegoPieceWeapon {
  /** Absent until a weapon is picked. */
  fires?: LegoWeaponRef;
  /** Full width of the firing arc in degrees, written as `maxAngleDif`.
   *  Absent means the engine's default of 360. */
  arc?: number;
  /** Where the arc points, in degrees to the right of the unit's front,
   *  written as `mainDir`. Absent means straight ahead. */
  heading?: number;
}

/** A game's own compiled animation script: where it sits in the archive, and
 *  the bytes themselves. */
export interface LegoCompiledScript {
  member: string;
  bytes: number[];
}

export interface LegoProject {
  schemaVersion: typeof LEGO_SCHEMA_VERSION;
  id: string;
  /** What the project is called in the overview. */
  name: string;
  /** Lower case. The base name of every exported file. */
  unitName: string;
  /** The parts library this unit was built against, and its version. */
  packId: string;
  packVersion: string;
  /**
   * The atlas this unit samples, by texture file name, which is what the s3o
   * names. Absent means the base pack's own atlas, so a unit built before atlas
   * packs existed needs no migration. Never the pack id: an atlas is bound to
   * the texture it ships, which is what a game folder ends up holding a copy
   * of, not to whoever shipped it.
   */
  atlas?: string;
  /**
   * Present when the unit was imported whole from somebody else's `.s3o`.
   *
   * Such a unit has no parts and no atlas, so the parts library and the atlas
   * picker are hidden for it and this is what they read to know that. Its
   * pieces name meshes in the geometry sidecar rather than parts in the pack.
   */
  imported?: LegoImported;
  /**
   * The game this unit is for, chosen by the game maker (issue #3257). `null`
   * means "No game", a choice of its own. Absent means a unit saved before
   * this existed, which `unitGame` reads off `imported.game` instead.
   */
  game?: LegoUnitGame | null;
  createdAt: string;
  updatedAt: string;
  rootPieceId: string;
  pieces: LegoPiece[];
  /**
   * On a module: the connector that joins it to the piece it is dropped onto.
   * Absent means no mount, so the module's first piece lands on the target's
   * origin, which is every module saved before this existed.
   */
  mount?: LegoMount;
  /** s3o header values. Computed on export unless pinned here. */
  radius?: number;
  height?: number;
  mid?: [number, number, number];
  /**
   * What the engine collides, clicks and shoots at. Absent means one derived
   * from the model's bounding box, so a unit saved before this existed still
   * opens and still exports a volume that fits it.
   */
  collisionVolume?: LegoCollisionVolume;
  /**
   * Whether shots are tested against each piece instead of the whole unit.
   *
   * There is nothing to store per piece. The engine derives a box around every
   * piece's own vertices when it loads the model, and the only thing a unit
   * definition can say is whether to use them, so this is one flag for the
   * unit. See `collisionVolume.ts`.
   */
  pieceCollision?: boolean;
  /**
   * Whether a click picks the unit off each piece instead of the whole unit.
   *
   * The engine's own second switch, read in `ParseSelectionVolume` rather than
   * `ParseCollisionVolume`, over the same boxes. Separate from
   * `pieceCollision` because it is a separate choice: a unit can be shot at
   * piece by piece and still be clicked as one easy shape.
   */
  pieceSelection?: boolean;
  /**
   * How fast and how far this unit builds, when it builds at all.
   *
   * Absent means the defaults, which is where a unit with a build arm starts:
   * the panel opens on them and touching a field takes them over, the same rule
   * the collision volume and the aim point follow.
   *
   * Whether the keys are written at all is not stored here. It follows from the
   * unit having a piece in a `buildarm.*` role, because a unit with a build arm
   * modelled and nothing driving it is not a thing anybody wants.
   */
  builder?: LegoBuilder;
  /** The movement class, speed and turn rate, when the unit moves. */
  movement?: LegoMovement;
  /**
   * What each kind of part is worth, which sets the unit's health, cost and
   * mass (issue #3280). Absent means the placeholder table in `worth.ts`.
   * Stored on the unit rather than per game, because a unit may be for no
   * game (#3257), and an export then needs nothing from outside the document.
   */
  worth?: LegoWorth;
  unitDef?: Record<string, string | number | boolean>;
  notes?: string;
  /**
   * On a module: what kind of thing it is, as one word or two ("Wheel"), so the
   * module list can be narrowed to it (#3298). Absent means uncategorised,
   * which is every module saved before this existed.
   */
  category?: string;
  /** On a module: free words the module list's search also matches. */
  tags?: string[];
  /** Canned animations applied to this unit, from `animPresets.ts`. */
  animations?: { presetId: string; params: Record<string, number> }[];
  /**
   * The unit's own Lua, once the user has taken it over.
   *
   * Absent means the presets still generate the script, which is where every
   * unit starts and where a unit saved before this existed stays. Present
   * means the presets are done with this unit: this text is what the builder
   * shows and what an export writes, exactly as it stands.
   */
  script?: string;
  /**
   * The compiled animation script the unit's game ships, when it ships one.
   *
   * A `.cob` is bytecode rather than Lua, so it can be played but not edited
   * and not written back by an export. It is kept here, bytes and all, because
   * it is the only copy coilbox has: the game it came out of may not be
   * installed the next time this project is opened.
   *
   * A unit that also has `script` is past this. Taking a script over is a
   * decision, and the text somebody owns beats the file they came in with.
   */
  compiledScript?: LegoCompiledScript;
  /**
   * The definition the unit's game gives it, for a script that reads one.
   *
   * A unit script may read its own definition, and Beyond All Reason's do:
   * `coralab.lua` picks which of two animations it has out of
   * `customParams.litelab`. Without it the script throws at load and the unit
   * does not animate at all.
   *
   * Stored rather than re-read, for the same reason the compiled script is: the
   * game it came out of may not be installed the next time this is opened.
   * Absent for a unit built out of parts, which has no definition to have.
   */
  gameUnitDef?: Record<string, unknown>;
  /**
   * The library files the unit's script pulls in with `include`, keyed by the
   * name it asks for.
   *
   * A game may keep half its animation in a shared library and have every unit
   * pull it in, which is Beyond All Reason's house style. Without the file the
   * script stops on the first line that calls into it.
   *
   * Stored rather than re-read, for the same reason the definition is. Absent
   * for a unit built out of parts, whose script pulls in nothing but coilbox's
   * own collision file.
   */
  gameScriptIncludes?: Record<string, string>;
  /** Where this unit was last exported, so exporting again does not ask. */
  exportDir?: string;
  /** Whether that export also placed the shared atlas. Defaults to true. */
  exportTexture?: boolean;
  /**
   * Whether that export replaces a texture already at that name, rather than
   * leaving it alone. Off by default: a texture the game already has under
   * that name may be its own.
   */
  exportOverwriteTexture?: boolean;
  /** Whether it also wrote a unit script when the game had none. */
  exportScript?: boolean;
  /** Whether that export also wrote a .glb, for taking the unit into Blender. */
  exportGlb?: boolean;
  /** Whether that export also wrote an .obj and .mtl, for the same reason. */
  exportObj?: boolean;
  /** What the last export actually put in a game folder (issue #2651). */
  exported?: LegoExport;
  /**
   * The receipts for every other game folder the unit has been exported into,
   * one per folder (issue #4267).
   *
   * `exported` is the latest export and stays the one the workshop reads. When
   * an export goes into a different folder, the receipt it displaces moves here
   * rather than being dropped, so exporting into a second game does not make
   * the first forget that coilbox wrote its files. A project saved before this
   * field has none, and its single receipt is already `exported`.
   */
  exportedElsewhere?: LegoExport[];
  /**
   * The build picture last taken, which an export writes to
   * `unitpics/<unit>.png` (issue #3347). The picture's bytes are stored beside
   * the thumbnail; this is what it was taken with and when.
   */
  picture?: BuildPicture;
  /**
   * Names this project has exported under in the same folder and no longer
   * uses, whose files are still sitting in the game (issue #2680).
   *
   * An entry goes when the export drawer clears the files or finds them already
   * gone, so an empty list means the rename left nothing behind.
   */
  staleExports?: StaleExport[];
  /**
   * Guide planes the game maker has placed (issue #3318): flat planes drawn in
   * the viewport that a moved piece's anchors snap to. A view aid like the
   * grid. They are saved with the unit and read by nothing that exports: no
   * exporter walks this list, because a guide is not a piece. Absent means
   * none.
   */
  guides?: LegoGuide[];
}

/** The three axes a guide can be aligned to. */
export const GUIDE_AXES = ["x", "y", "z"] as const;
export type GuideAxis = (typeof GUIDE_AXES)[number];

/**
 * A guide in the unit's own space: the root piece's frame, so moving or
 * turning the root carries the guide with it.
 *
 * A plane (no `kind`, as every guide saved before lines) stands across `axis`
 * at `offset`. A line (`kind: "line"`) runs along `axis` through `point`, whose
 * coordinate along `axis` is always 0 since a line does not have one.
 */
export interface LegoGuide {
  id: string;
  name: string;
  axis: GuideAxis;
  kind?: "line";
  /** A plane's distance along `axis` from the root's origin. */
  offset?: number;
  /** A line's place in the unit's space. */
  point?: [number, number, number];
  hidden?: boolean;
}

/** The guides that can be read, or null when there are none. */
function parseGuides(value: unknown): LegoGuide[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const guides: LegoGuide[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const g = raw as Record<string, unknown>;
    if (typeof g.id !== "string" || g.id === "" || seen.has(g.id)) continue;
    const axis = GUIDE_AXES.find((a) => a === g.axis);
    if (!axis) continue;
    const named = (fallback: string) =>
      typeof g.name === "string" && g.name !== "" ? g.name : fallback;
    const hidden = g.hidden === true ? { hidden: true as const } : {};

    if (g.kind === "line") {
      const point = parseVec3(g.point);
      if (!point) continue;
      point[GUIDE_AXES.indexOf(axis)] = 0;
      seen.add(g.id);
      guides.push({
        id: g.id,
        name: named(`${axis} line`),
        kind: "line",
        axis,
        point,
        ...hidden,
      });
      continue;
    }
    if (g.kind !== undefined && g.kind !== "plane") continue;
    if (typeof g.offset !== "number" || !Number.isFinite(g.offset)) continue;
    seen.add(g.id);
    guides.push({
      id: g.id,
      name: named(`${axis} = ${g.offset}`),
      axis,
      offset: g.offset,
      ...hidden,
    });
  }
  return guides.length > 0 ? guides : null;
}

/** The camera directions the build picture can be taken from. */
export const PICTURE_VIEW_IDS = ["right", "left", "front", "side"] as const;
export type PictureViewId = (typeof PICTURE_VIEW_IDS)[number];

/** How a build picture was taken (issue #3347). */
export interface BuildPicture {
  /** Side of the square, in pixels. */
  size: number;
  /** A CSS colour, or null for a transparent picture. */
  background: string | null;
  view: PictureViewId;
  /** When it was taken, ISO. */
  takenAt: string;
  /** What the unit looked like then: see `pictureFingerprint`. */
  fingerprint: string;
}

function parseBuildPicture(raw: unknown): BuildPicture | null {
  if (typeof raw !== "object" || raw === null) return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.size !== "number" || !Number.isInteger(p.size) || p.size < 1)
    return null;
  if (typeof p.fingerprint !== "string") return null;
  const view = PICTURE_VIEW_IDS.find((id) => id === p.view);
  if (!view) return null;
  return {
    size: p.size,
    background: typeof p.background === "string" ? p.background : null,
    view,
    takenAt: typeof p.takenAt === "string" ? p.takenAt : "",
    fingerprint: p.fingerprint,
  };
}

/**
 * A receipt for one export: which game folder it went into, and the definition
 * it wrote there (issue #2651).
 *
 * Separate from `exportDir` and the checkboxes beside it, which are settings
 * for the next export rather than a record of the last one. The workshop reads
 * this to find the units a game folder has been given, so it has to say what
 * was written rather than what the drawer will offer to write.
 *
 * The definition is kept rather than derived again. Deriving it needs the parts
 * library, the atlas and the baked geometry, which is the whole builder, and
 * the workshop would then be showing a definition slightly unlike the file the
 * engine reads whenever any of those has moved on. Storing it makes the two the
 * same table by construction.
 */
export interface LegoExport {
  /** The game folder chosen in the export drawer. */
  dir: string;
  /** When it was written, ISO. */
  at: string;
  /** The internal name it was written under: the file's name and the def's key. */
  unitName: string;
  /** The definition as written, keyed the way the engine reads it: lower case. */
  def: Record<string, unknown>;
  /**
   * Every file coilbox wrote under this name, and the digest of what it wrote
   * (issue #2680).
   *
   * Kept so a rename can prove which of the old name's files are still its own.
   * A file the export kept rather than wrote is deliberately not here: coilbox
   * did not put those contents on disk and has no claim on them. Empty for a
   * receipt written before this was recorded, which means the same thing as far
   * as anything acting on it goes: nothing here is provably ours.
   */
  files: ExportedFile[];
}

/** One file an export wrote, by path and by the digest of the bytes written. */
export interface ExportedFile {
  path: string;
  /** Lower case hex sha256. */
  sha256: string;
}

/**
 * A name a project exported under and no longer uses (issue #2680).
 *
 * Renaming a unit and exporting again writes a second set of files rather than
 * moving the first, so the game ends up holding two units. This is what
 * remembers the first one, since the receipt for it is about to be overwritten
 * and after that nothing anywhere knows the old name.
 *
 * No definition, unlike {@link LegoExport}. Nothing shows a stale unit's fields:
 * either the engine reads the file that is still there, or the unit is broken
 * and there is nothing to show. Carrying one would only grow the project file
 * every time somebody renamed.
 */
export interface StaleExport {
  dir: string;
  at: string;
  unitName: string;
  files: ExportedFile[];
}

function parseExportedFiles(raw: unknown): ExportedFile[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const f = entry as Record<string, unknown>;
    if (typeof f.path !== "string" || f.path === "") return [];
    if (typeof f.sha256 !== "string" || f.sha256 === "") return [];
    return [{ path: f.path, sha256: f.sha256 }];
  });
}

function parseExport(raw: unknown): LegoExport | null {
  if (typeof raw !== "object" || raw === null) return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.dir !== "string" || e.dir === "") return null;
  if (typeof e.unitName !== "string" || e.unitName === "") return null;
  if (typeof e.def !== "object" || e.def === null || Array.isArray(e.def))
    return null;
  return {
    dir: e.dir,
    at: typeof e.at === "string" ? e.at : "",
    unitName: e.unitName,
    def: e.def as Record<string, unknown>,
    files: parseExportedFiles(e.files),
  };
}

/** One receipt per folder, dropping any for the folder `exported` is in. */
function parseOtherExports(raw: unknown, exported?: LegoExport): LegoExport[] {
  if (!Array.isArray(raw)) return [];
  const out: LegoExport[] = [];
  for (const entry of raw) {
    const receipt = parseExport(entry);
    if (!receipt) continue;
    const taken = (other: LegoExport) =>
      comparablePath(other.dir) === comparablePath(receipt.dir);
    if (exported && taken(exported)) continue;
    if (out.some(taken)) continue;
    out.push(receipt);
  }
  return out;
}

function parseStaleExports(raw: unknown): StaleExport[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const e = entry as Record<string, unknown>;
    if (typeof e.dir !== "string" || e.dir === "") return [];
    if (typeof e.unitName !== "string" || e.unitName === "") return [];
    return [
      {
        dir: e.dir,
        at: typeof e.at === "string" ? e.at : "",
        unitName: e.unitName,
        files: parseExportedFiles(e.files),
      },
    ];
  });
}

/**
 * Normalise a name to something a unit script can use as a local.
 *
 * Lower case because the tooling is inconsistent about case and scripts address
 * pieces by name. Leading digits get a prefix because `1foot` is not an
 * identifier. Empty input becomes `piece` rather than nothing.
 */
export function normalisePieceName(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (cleaned === "") return "piece";
  return /^[0-9]/.test(cleaned) ? `p${cleaned}` : cleaned;
}

/** Normalise, then add the smallest numeric suffix that is not already taken. */
export function uniquePieceName(raw: string, taken: Iterable<string>): string {
  const base = normalisePieceName(raw);
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

export function childrenOf(
  project: LegoProject,
  pieceId: string | null,
): LegoPiece[] {
  return project.pieces.filter((piece) => piece.parentId === pieceId);
}

export function pieceById(
  project: LegoProject,
  pieceId: string,
): LegoPiece | undefined {
  return project.pieces.find((piece) => piece.id === pieceId);
}

/** Depth-first from the root, the order pieces are written to an s3o. */
export function walkPieces(project: LegoProject): LegoPiece[] {
  const out: LegoPiece[] = [];
  const visit = (piece: LegoPiece) => {
    out.push(piece);
    for (const child of childrenOf(project, piece.id)) visit(child);
  };
  const root = pieceById(project, project.rootPieceId);
  if (root) visit(root);
  return out;
}

/**
 * Every piece in save order: depth-first from the root, so a parent always
 * comes before its children. Reparenting only changes a piece's `parentId`,
 * not its place in the array, so this is what has to keep that true.
 *
 * A cycle or a missing parent can leave pieces unreachable from the root.
 * Those follow in their existing order rather than being dropped, because
 * silently losing pieces on save would be worse than a document
 * `projectProblems` already flags as broken.
 */
export function orderedPieces(project: LegoProject): LegoPiece[] {
  const ordered = walkPieces(project);
  const reached = new Set(ordered.map((piece) => piece.id));
  const stray = project.pieces.filter((piece) => !reached.has(piece.id));
  return [...ordered, ...stray];
}

/** A piece and everything under it, for deleting or saving as a compound. */
export function descendantIds(project: LegoProject, pieceId: string): string[] {
  const out: string[] = [];
  const visit = (id: string) => {
    out.push(id);
    for (const child of childrenOf(project, id)) visit(child.id);
  };
  visit(pieceId);
  return out;
}

/** A piece's kind, for the tree's type icon: whether it draws something, or
 *  is a hierarchy node, flare, aim point or emitter. An imported flare keeps
 *  its emit point as a mesh with vertices and no triangles, so `raw` is what
 *  tells it apart from a piece that draws. */
export type PieceKind = "geometry" | "empty";

export function pieceKind(
  piece: LegoPiece,
  raw: RawGeometry | null = null,
): PieceKind {
  if (piece.partId) return "geometry";
  if (!piece.meshId) return "empty";
  return raw?.byId.get(piece.meshId)?.iCount === 0 ? "empty" : "geometry";
}

/**
 * Whether a piece is hidden, either itself or because an ancestor is.
 *
 * The viewport hides a piece by making its group invisible, and three.js
 * already stops there without drawing anything under it. This mirrors that
 * for the tree, so a child row does not read as shown when nothing under a
 * hidden ancestor actually is. A cycle stops the walk rather than looping.
 */
export function isEffectivelyHidden(
  project: LegoProject,
  pieceId: string,
): boolean {
  const seen = new Set<string>();
  let current = pieceById(project, pieceId);
  while (current && !seen.has(current.id)) {
    if (current.hidden) return true;
    seen.add(current.id);
    current = current.parentId
      ? pieceById(project, current.parentId)
      : undefined;
  }
  return false;
}

/**
 * Everything wrong with a project, as records whose messages are meant to be
 * shown.
 *
 * Separate from parsing because the editor can hold a document mid-edit that is
 * momentarily invalid, and wants to say so rather than refuse to load it.
 */
export function projectProblems(project: LegoProject): Problem[] {
  const problems: Problem[] = [];
  const add = (
    severity: ProblemSeverity,
    message: string,
    pieceIds: string[] = [],
  ) => problems.push(problem("document", severity, message, pieceIds));
  const byId = new Map(project.pieces.map((piece) => [piece.id, piece]));

  if (!byId.has(project.rootPieceId)) {
    add("error", "The root piece is missing.");
  }

  const names = new Map<string, number>();
  for (const piece of project.pieces) {
    names.set(piece.name, (names.get(piece.name) ?? 0) + 1);
    if (piece.name !== normalisePieceName(piece.name)) {
      add(
        "warning",
        `"${piece.name}" is not usable as a name in a unit script.`,
        [piece.id],
      );
    }
    if (piece.parentId !== null && !byId.has(piece.parentId)) {
      add("error", `"${piece.name}" hangs off a piece that no longer exists.`, [
        piece.id,
      ]);
    }
    if (piece.parentId === null && piece.connection) {
      add(
        "warning",
        `"${piece.name}" is saved as joined to a parent, but it has none.`,
        [piece.id],
      );
    }
    if (piece.twin !== undefined && !byId.has(piece.twin)) {
      add("warning", `"${piece.name}" has a twin that no longer exists.`, [
        piece.id,
      ]);
    }
    if (piece.ring !== undefined && !ringMembers(project.pieces, piece.id)) {
      add("warning", `"${piece.name}" is in a ring that is not whole.`, [
        piece.id,
      ]);
    }
  }
  for (const [name, count] of names) {
    if (count > 1) {
      add(
        "error",
        `${count} pieces are called "${name}".`,
        project.pieces.filter((piece) => piece.name === name).map((p) => p.id),
      );
    }
  }

  // A lifted piece belongs only in a unit for its own game (#3259). Said once
  // per reason, naming the pieces, so a whole turret is one line.
  const misplaced = new Map<string, LegoPiece[]>();
  for (const piece of project.pieces) {
    if (!piece.lifted) continue;
    const refused = liftRefusal(project, piece.lifted.game);
    if (refused)
      misplaced.set(refused, [...(misplaced.get(refused) ?? []), piece]);
  }
  for (const [refused, pieces] of misplaced) {
    add(
      "warning",
      `${refused} Pieces from a game: ${pieces.map((p) => p.name).join(", ")}.`,
      pieces.map((p) => p.id),
    );
  }

  const roots = project.pieces.filter((piece) => piece.parentId === null);
  if (roots.length > 1) {
    add(
      "error",
      `${roots.length} pieces have no parent, but a model has one root.`,
      roots.map((p) => p.id),
    );
  }

  // Anything the walk from the root does not reach is either orphaned or in a
  // cycle. Both would make the exporter recurse forever.
  const reached = new Set(walkPieces(project).map((piece) => piece.id));
  const stranded = project.pieces.filter((piece) => !reached.has(piece.id));
  if (stranded.length > 0) {
    add(
      "error",
      `${stranded.length} pieces cannot be reached from the root, so they are in a loop or detached.`,
      stranded.map((p) => p.id),
    );
  }

  return problems;
}

/** A new project holding a single empty root, which is what an s3o needs. */
export function newProject(options: {
  id: string;
  rootPieceId: string;
  name: string;
  unitName?: string;
  packId: string;
  packVersion: string;
  /** Left off for the base pack's atlas, which is what most units use. */
  atlas?: string;
  /** The game the unit is for, or null for no game. Left off, it is not
   *  written at all. */
  game?: LegoUnitGame | null;
  now: string;
}): LegoProject {
  return {
    schemaVersion: LEGO_SCHEMA_VERSION,
    id: options.id,
    name: options.name,
    unitName: normalisePieceName(options.unitName ?? options.name),
    packId: options.packId,
    packVersion: options.packVersion,
    ...(options.atlas ? { atlas: options.atlas } : {}),
    ...(options.game !== undefined ? { game: options.game } : {}),
    createdAt: options.now,
    updatedAt: options.now,
    rootPieceId: options.rootPieceId,
    pieces: [
      {
        id: options.rootPieceId,
        name: "base",
        parentId: null,
        partId: null,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
    ],
  };
}

/**
 * Parse a stored document.
 *
 * Returns null only when the file is not a project at all. A project that is
 * merely wrong, a duplicate name or a missing part, still loads, because
 * refusing to open it would leave no way to fix it. `projectProblems` reports
 * those.
 */
export function parseLegoProjectJson(json: string): LegoProject | null {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  return parseLegoProjectData(data);
}

/**
 * The same parse as `parseLegoProjectJson`, from already-parsed data.
 *
 * Split out for callers that hold a project nested inside a larger JSON
 * document, such as a clipboard envelope, and would otherwise have to
 * `JSON.stringify` it back out just to parse it again.
 */
export function parseLegoProjectData(data: unknown): LegoProject | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;

  if (
    d.schemaVersion !== LEGO_SCHEMA_VERSION ||
    typeof d.id !== "string" ||
    typeof d.name !== "string" ||
    typeof d.rootPieceId !== "string" ||
    !Array.isArray(d.pieces)
  ) {
    return null;
  }

  // Imported names are made unique the same way rawImport.ts and compounds.ts
  // already make theirs: `uniquePieceName` normalises, so `luaScript.ts` can
  // still assume a name is identifier-safe, and dedupes against siblings, so
  // two pieces that normalise the same way do not collide into one Lua local.
  // A hole punched by rejecting the piece, or losing the whole import by
  // rejecting the document, would both be worse than silently renaming it,
  // and match parseLegoProjectJson's own contract just above: this project is
  // merely wrong, not unparsable.
  const parsed: LegoPiece[] = [];
  const takenNames = new Set<string>();
  for (const raw of d.pieces) {
    const piece = parsePiece(raw);
    if (!piece) return null;
    const name = uniquePieceName(piece.name, takenNames);
    takenNames.add(name);
    parsed.push(name === piece.name ? piece : { ...piece, name });
  }
  if (parsed.length === 0) return null;
  const { imported, pieces } = sheetFromTop(parseImported(d.imported), parsed);

  const mid = parseVec3(d.mid);
  const collisionVolume = parseCollisionVolume(d.collisionVolume);
  const builder = parseBuilder(d.builder);
  const movement = parseMovement(d.movement);
  const worth = parseWorth(d.worth);
  const mount = parseMount(d.mount, pieces);
  const project: LegoProject = {
    schemaVersion: LEGO_SCHEMA_VERSION,
    id: d.id,
    name: d.name,
    unitName:
      typeof d.unitName === "string" ? d.unitName : normalisePieceName(d.name),
    packId: typeof d.packId === "string" ? d.packId : "",
    packVersion: typeof d.packVersion === "string" ? d.packVersion : "",
    ...(typeof d.atlas === "string" && d.atlas !== ""
      ? { atlas: d.atlas }
      : {}),
    ...(imported ? { imported } : {}),
    ...(d.game === null
      ? { game: null }
      : (() => {
          const game = parseUnitGame(d.game);
          return game ? { game } : {};
        })()),
    createdAt: typeof d.createdAt === "string" ? d.createdAt : "",
    updatedAt: typeof d.updatedAt === "string" ? d.updatedAt : "",
    rootPieceId: d.rootPieceId,
    pieces,
    ...(mount ? { mount } : {}),
    ...(typeof d.radius === "number" ? { radius: d.radius } : {}),
    ...(typeof d.height === "number" ? { height: d.height } : {}),
    ...(mid ? { mid } : {}),
    ...(collisionVolume ? { collisionVolume } : {}),
    ...(d.pieceCollision === true ? { pieceCollision: true } : {}),
    ...(d.pieceSelection === true ? { pieceSelection: true } : {}),
    ...(builder ? { builder } : {}),
    ...(movement ? { movement } : {}),
    ...(worth ? { worth } : {}),
    ...(typeof d.unitDef === "object" && d.unitDef !== null
      ? { unitDef: d.unitDef as Record<string, string | number | boolean> }
      : {}),
    ...(typeof d.notes === "string" ? { notes: d.notes } : {}),
    ...(typeof d.category === "string" && d.category.trim() !== ""
      ? { category: d.category.trim() }
      : {}),
    ...(parseTagList(d.tags) ?? {}),
    ...(Array.isArray(d.animations)
      ? { animations: d.animations.map(parseApplied).filter((a) => a !== null) }
      : {}),
    ...(typeof d.script === "string" ? { script: d.script } : {}),
    ...(parseCompiledScript(d.compiledScript) ?? {}),
    ...(typeof d.gameUnitDef === "object" && d.gameUnitDef !== null
      ? { gameUnitDef: d.gameUnitDef as Record<string, unknown> }
      : {}),
    ...(parseScriptIncludes(d.gameScriptIncludes) ?? {}),
    ...(typeof d.exportDir === "string" ? { exportDir: d.exportDir } : {}),
    ...(typeof d.exportTexture === "boolean"
      ? { exportTexture: d.exportTexture }
      : {}),
    ...(typeof d.exportOverwriteTexture === "boolean"
      ? { exportOverwriteTexture: d.exportOverwriteTexture }
      : {}),
    ...(typeof d.exportScript === "boolean"
      ? { exportScript: d.exportScript }
      : {}),
    ...(typeof d.exportGlb === "boolean" ? { exportGlb: d.exportGlb } : {}),
    ...(typeof d.exportObj === "boolean" ? { exportObj: d.exportObj } : {}),
    ...(() => {
      const exported = parseExport(d.exported);
      return exported ? { exported } : {};
    })(),
    ...(() => {
      const elsewhere = parseOtherExports(
        d.exportedElsewhere,
        parseExport(d.exported) ?? undefined,
      );
      return elsewhere.length > 0 ? { exportedElsewhere: elsewhere } : {};
    })(),
    ...(() => {
      const picture = parseBuildPicture(d.picture);
      return picture ? { picture } : {};
    })(),
    ...(() => {
      const stale = parseStaleExports(d.staleExports);
      return stale.length > 0 ? { staleExports: stale } : {};
    })(),
    ...(() => {
      const guides = parseGuides(d.guides);
      return guides ? { guides } : {};
    })(),
  };
  // A document saved before pieces were written in save order, or hand-edited,
  // may not have its parents first. Normalise here so the invariant holds the
  // moment a project is in memory, not only after its next save.
  return { ...project, pieces: orderedPieces(project) };
}

/** A module's tags, trimmed. Blank and non-text entries are dropped. */
function parseTagList(value: unknown): { tags: string[] } | null {
  if (!Array.isArray(value)) return null;
  const tags = value
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim())
    .filter(Boolean);
  return tags.length > 0 ? { tags } : null;
}

/** A module's mount, or null when it is not a piece of the module and a
 *  connector. A mount on a piece that is gone is dropped, so the module falls
 *  back to having none. */
function parseMount(value: unknown, pieces: LegoPiece[]): LegoMount | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.piece !== "string" || typeof v.connector !== "string") {
    return null;
  }
  if (v.connector === "" || !pieces.some((p) => p.id === v.piece)) return null;
  return { piece: v.piece, connector: v.connector };
}

function parsePiece(raw: unknown): LegoPiece | null {
  if (typeof raw !== "object" || raw === null) return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.id !== "string" || p.id === "") return null;
  if (typeof p.name !== "string") return null;

  return {
    id: p.id,
    name: p.name,
    ...(typeof p.originalName === "string" && p.originalName !== ""
      ? { originalName: p.originalName }
      : {}),
    parentId: typeof p.parentId === "string" ? p.parentId : null,
    partId: typeof p.partId === "string" ? p.partId : null,
    ...(typeof p.meshId === "string" && p.meshId !== ""
      ? { meshId: p.meshId }
      : {}),
    ...(() => {
      const box = p.meshBox as { min?: unknown; max?: unknown } | null;
      const min = parseVec3(box?.min);
      const max = parseVec3(box?.max);
      return min && max ? { meshBox: { min, max } } : {};
    })(),
    position: parseVec3(p.position) ?? [0, 0, 0],
    rotation: parseVec3(p.rotation) ?? [0, 0, 0],
    scale: parseVec3(p.scale) ?? [1, 1, 1],
    ...(() => {
      const pivot = parseVec3(p.pivot);
      return pivot ? { pivot } : {};
    })(),
    ...(typeof p.role === "string" ? { role: p.role } : {}),
    ...(Array.isArray(p.tags)
      ? { tags: p.tags.filter((t): t is string => typeof t === "string") }
      : {}),
    ...(p.hidden === true ? { hidden: true } : {}),
    ...(() => {
      const collision = parsePieceCollision(p.collision);
      return collision ? { collision } : {};
    })(),
    ...(Array.isArray(p.customAnchors)
      ? {
          customAnchors: p.customAnchors
            .map(parseAnchor)
            .filter((a): a is LegoAnchor => a !== null),
        }
      : {}),
    ...(() => {
      const connection = parseConnection(p.connection);
      return connection ? { connection } : {};
    })(),
    ...(p.uvFlip === true ? { uvFlip: true } : {}),
    ...(p.uvMirror === true ? { uvMirror: true } : {}),
    ...(typeof p.normalsAngle === "number" && Number.isFinite(p.normalsAngle)
      ? { normalsAngle: p.normalsAngle }
      : {}),
    ...(() => {
      const weapon = parsePieceWeapon(p.weapon);
      return weapon ? { weapon } : {};
    })(),
    ...(() => {
      const module = parseModuleRef(p.module);
      return module ? { module } : {};
    })(),
    ...(() => {
      const lifted = parseLifted(p.lifted);
      return lifted ? { lifted } : {};
    })(),
    ...(typeof p.twin === "string" && p.twin !== "" ? { twin: p.twin } : {}),
    ...(() => {
      const ring = parsePieceRing(p.ring);
      return ring ? { ring } : {};
    })(),
  };
}

/** Where a lifted piece came from, or null without a game and a model. */
export function parseLifted(value: unknown): LegoLifted | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const game = parseUnitGame(v.game);
  if (!game || typeof v.member !== "string" || v.member === "") return null;
  // Read out of a game, so never a path to refresh from: see `parseImported`.
  const texture = parseTexture(v.texture, true);
  const texture2 = parseTexture(v.texture2, true);
  return {
    game,
    member: v.member,
    ...(typeof v.unit === "string" && v.unit !== "" ? { unit: v.unit } : {}),
    ...(texture ? { texture } : {}),
    ...(texture2 ? { texture2 } : {}),
  };
}

/** A piece's ring, or null unless it names a next piece and a usable count. */
function parsePieceRing(value: unknown): LegoPieceRing | null {
  if (typeof value !== "object" || value === null) return null;
  const { next, count } = value as Record<string, unknown>;
  if (typeof next !== "string" || next === "") return null;
  if (typeof count !== "number" || !validRingCount(count)) return null;
  return { next, count };
}

/** A piece's module, or null unless it names both a module and an instance. */
function parseModuleRef(value: unknown): LegoModuleRef | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || v.id === "") return null;
  if (typeof v.instance !== "string" || v.instance === "") return null;
  return {
    id: v.id,
    instance: v.instance,
    ...(typeof v.rev === "string" && v.rev !== "" ? { rev: v.rev } : {}),
    ...(typeof v.fp === "string" && v.fp !== "" ? { fp: v.fp } : {}),
  };
}

/** A piece's weapon, or null when there is nothing usable in it. */
function parsePieceWeapon(value: unknown): LegoPieceWeapon | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const fires = parseWeaponRef(v.fires);
  const number = (x: unknown): x is number =>
    typeof x === "number" && Number.isFinite(x);
  return {
    ...(fires ? { fires } : {}),
    ...(number(v.arc) ? { arc: v.arc } : {}),
    ...(number(v.heading) ? { heading: v.heading } : {}),
  };
}

function parseWeaponRef(value: unknown): LegoWeaponRef | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.from === "game" && typeof v.name === "string" && v.name !== "") {
    return { from: "game", name: v.name };
  }
  if (
    v.from === "library" &&
    typeof v.projectId === "string" &&
    typeof v.key === "string" &&
    v.key !== ""
  ) {
    return { from: "library", projectId: v.projectId, key: v.key };
  }
  return null;
}

/**
 * Where an imported unit came from and what it draws with.
 *
 * A texture that will not parse is dropped rather than failing the project.
 * The unit then draws untextured and says which file it wanted, which is the
 * same call the import itself makes when a texture cannot be found: losing the
 * project over a missing image would be worse than drawing it plain.
 *
 * The second texture is read under `teamMask` as well as under `texture2`,
 * because that is what every document written before #1910 calls it. The old
 * name is only ever read: a save writes the new one, so a unit migrates the next
 * time it is touched and one nobody touches goes on working untouched. Same deal
 * `parseGameIdentity` makes with the spellings that predate #1335.
 */
function parseImported(value: unknown): LegoImported | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.source !== "string") return null;

  const game = parseImportedGame(v.game);
  // A model out of a packed archive was read from a temp folder that is long
  // gone, so a source recorded against one is a path to nothing (#1903). The
  // import stopped writing them, and this is for the documents that already
  // have one: without it those units go on offering a Refresh that can only
  // fail.
  const packed = game !== null && !isLooseArchive(game.archive);
  const texture = parseTexture(v.texture, packed);
  const texture2 = parseTexture(v.texture2 ?? v.teamMask, packed);
  const missingTexture2 = v.missingTexture2 ?? v.missingTeamMask;
  return {
    source: v.source,
    ...(game ? { game } : {}),
    ...(texture ? { texture } : {}),
    ...(texture2 ? { texture2 } : {}),
    ...(typeof v.missingTexture === "string"
      ? { missingTexture: v.missingTexture }
      : {}),
    ...(typeof missingTexture2 === "string" ? { missingTexture2 } : {}),
    ...(v.sheetFromTop === true ? { sheetFromTop: true } : {}),
  };
}

/**
 * A unit opened from a `.3do` before #4174, with every imported mesh turned
 * round to count its sheet's rows from the top.
 *
 * The geometry sidecar holds the UVs the import wrote, which counted the rows
 * from the bottom. Flipping v is exactly the difference, and the Flip UVs fix
 * already does it at draw and export time, so the sidecar is left as it is and
 * each mesh's flag is toggled. Toggled rather than set, so a mesh somebody had
 * flipped by hand comes out the way they saw it.
 */
function sheetFromTop(
  imported: LegoImported | null,
  pieces: LegoPiece[],
): { imported: LegoImported | null; pieces: LegoPiece[] } {
  if (!imported || imported.sheetFromTop) return { imported, pieces };
  if (!/\.3do$/i.test(imported.source)) return { imported, pieces };
  return {
    imported: { ...imported, sheetFromTop: true },
    pieces: pieces.map((piece) => {
      if (!piece.meshId) return piece;
      const { uvFlip, ...rest } = piece;
      return uvFlip ? rest : { ...rest, uvFlip: true };
    }),
  };
}

/**
 * The game a unit was opened out of.
 *
 * The name, the archive and the member are all required, because the three are
 * written together and two of them are no use on their own: a name with no
 * archive cannot be matched against a game and an archive with no member cannot
 * be matched against a model. Half a record is dropped rather than kept, which
 * puts the unit back on the path fallback, exactly where one opened before this
 * field existed already sits.
 */
function parseImportedGame(value: unknown): LegoImportedGame | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.name !== "string" ||
    typeof v.archive !== "string" ||
    typeof v.member !== "string"
  ) {
    return null;
  }
  return {
    name: v.name,
    archive: v.archive,
    member: v.member,
    // Absent for a feature or a wreck, which no unitdef names.
    ...(typeof v.unit === "string" ? { unit: v.unit } : {}),
  };
}

/** One game as a unit records it. Without a name and an archive it is no use,
 *  so it is dropped and the unit reads as one saved before this existed. */
function parseGameRef(value: unknown): LegoGameRef | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.name !== "string" || typeof v.archive !== "string") return null;
  if (v.name === "" || v.archive === "") return null;
  return {
    name: v.name,
    archive: v.archive,
    ...(typeof v.shortname === "string" && v.shortname !== ""
      ? { shortname: v.shortname }
      : {}),
    ...(typeof v.version === "string" && v.version !== ""
      ? { version: v.version }
      : {}),
  };
}

/** The game a unit is for, with the game under it when it is a mutator. */
function parseUnitGame(value: unknown): LegoUnitGame | null {
  const game = parseGameRef(value);
  if (!game) return null;
  const base = parseGameRef((value as Record<string, unknown>).base);
  return base ? { ...game, base } : game;
}

/** One stored texture. `packed` drops the source, for the reason above. */
function parseTexture(value: unknown, packed: boolean): LegoTexture | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.key !== "string" || v.key === "") return null;
  if (typeof v.name !== "string") return null;
  return {
    key: v.key,
    name: v.name,
    ...(!packed && typeof v.source === "string" ? { source: v.source } : {}),
  };
}

/**
 * The script's library files off a saved project.
 *
 * Only the entries that are text, because anything else is not a file a script
 * could have been given. A file dropped here is one `include` reads nothing
 * for, which the preview says when the script asks.
 */
function parseScriptIncludes(
  raw: unknown,
): { gameScriptIncludes: Record<string, string> } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const files = Object.entries(raw as Record<string, unknown>).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  if (files.length === 0) return null;
  return { gameScriptIncludes: Object.fromEntries(files) };
}

/**
 * A compiled script off a saved project, or nothing when there is not one.
 *
 * An empty byte array is nothing rather than an empty script: it would play as
 * a unit that stands still, which is exactly what having no script looks like,
 * and keeping it would mean the panel claiming an animation that is not there.
 */
function parseCompiledScript(
  raw: unknown,
): { compiledScript: LegoProject["compiledScript"] } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.member !== "string" || !Array.isArray(value.bytes)) {
    return null;
  }
  const bytes = value.bytes.filter((byte): byte is number =>
    Number.isInteger(byte),
  );
  if (bytes.length === 0) return null;
  return { compiledScript: { member: value.member, bytes } };
}

/**
 * One applied animation preset. Unknown preset ids survive parsing, because a
 * document written by a newer build should not lose them on a round trip here.
 */
function parseApplied(
  raw: unknown,
): { presetId: string; params: Record<string, number> } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const a = raw as Record<string, unknown>;
  if (typeof a.presetId !== "string" || a.presetId === "") return null;

  const params: Record<string, number> = {};
  if (typeof a.params === "object" && a.params !== null) {
    for (const [key, value] of Object.entries(a.params)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        params[key] = value;
      }
    }
  }
  return { presetId: a.presetId, params };
}

/**
 * A collision volume that was set by hand.
 *
 * All three fields have to be there. A half-written one would be half derived
 * and half set, with nothing to say which half, so it is dropped and the unit
 * goes back to a volume derived from its own geometry.
 */
function parseCollisionVolume(value: unknown): LegoCollisionVolume | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const type = COLLISION_VOLUME_TYPES.find((known) => known === v.type);
  const scales = parseVec3(v.scales);
  const offsets = parseVec3(v.offsets);
  if (!type || !scales || !offsets) return null;
  return { type, scales, offsets };
}

/**
 * A unit's build tuning, keeping only the fields it actually carries.
 *
 * An empty block is dropped rather than stored, so a unit that was opened,
 * looked at and left alone does not gain a key saying nothing. The defaults
 * fill in whatever is absent at write time: see `DEFAULT_BUILDER`.
 */
function parseBuilder(value: unknown): LegoBuilder | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const builder: LegoBuilder = {
    // Zero is a real number here and a broken one: the engine reads a builder
    // with no work rate as not a builder. It is kept rather than swapped for a
    // default, because silently rewriting a number somebody typed is worse
    // than showing them the number that does nothing.
    ...(typeof v.workerTime === "number" && Number.isFinite(v.workerTime)
      ? { workerTime: v.workerTime }
      : {}),
    ...(typeof v.buildDistance === "number" && Number.isFinite(v.buildDistance)
      ? { buildDistance: v.buildDistance }
      : {}),
    ...(typeof v.canAssist === "boolean" ? { canAssist: v.canAssist } : {}),
  };
  return Object.keys(builder).length > 0 ? builder : null;
}

function parseMovement(value: unknown): LegoMovement | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.moveClass !== "string" || v.moveClass.trim() === "") return null;
  const number = (x: unknown) => typeof x === "number" && Number.isFinite(x);
  return {
    moveClass: v.moveClass,
    ...(number(v.speed) ? { speed: v.speed as number } : {}),
    ...(number(v.turnRate) ? { turnRate: v.turnRate as number } : {}),
    ...(number(v.reverseSpeed)
      ? { reverseSpeed: v.reverseSpeed as number }
      : {}),
    ...(number(v.acceleration)
      ? { acceleration: v.acceleration as number }
      : {}),
    ...(number(v.brakeRate) ? { brakeRate: v.brakeRate as number } : {}),
    ...(typeof v.speedFrom === "string" ? { speedFrom: v.speedFrom } : {}),
    ...(typeof v.turnRateFrom === "string"
      ? { turnRateFrom: v.turnRateFrom }
      : {}),
    ...(typeof v.reverseSpeedFrom === "string"
      ? { reverseSpeedFrom: v.reverseSpeedFrom }
      : {}),
    ...(typeof v.accelerationFrom === "string"
      ? { accelerationFrom: v.accelerationFrom }
      : {}),
    ...(typeof v.brakeRateFrom === "string"
      ? { brakeRateFrom: v.brakeRateFrom }
      : {}),
  };
}

/**
 * One piece's collision override.
 *
 * A record saying only `hit: true` with no volume is what a piece switched off
 * and back on again leaves behind, and is the same as no record at all, so it
 * is dropped rather than stored. That keeps "does this unit override anything"
 * an honest question to ask of the document.
 */
function parsePieceCollision(value: unknown): LegoPieceCollision | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const volume = parseCollisionVolume(v.volume);
  const hit = v.hit !== false;
  if (hit && !volume) return null;
  return { hit, ...(volume ? { volume } : {}) };
}

/**
 * A piece's connection, or null when it does not name both connectors. A bad
 * offset or twist is dropped on its own, which leaves the join on the
 * connector, rather than costing the piece its join.
 */
function parseConnection(value: unknown): LegoConnection | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.connector !== "string" || v.connector === "") return null;
  if (typeof v.to !== "string" || v.to === "") return null;
  const offset =
    Array.isArray(v.offset) &&
    v.offset.length === 2 &&
    v.offset.every((n) => typeof n === "number" && Number.isFinite(n))
      ? ([v.offset[0], v.offset[1]] as [number, number])
      : null;
  return {
    connector: v.connector,
    to: v.to,
    ...(offset ? { offset } : {}),
    ...(typeof v.twist === "number" && Number.isFinite(v.twist)
      ? { twist: v.twist }
      : {}),
  };
}

function parseAnchor(raw: unknown): LegoAnchor | null {
  if (typeof raw !== "object" || raw === null) return null;
  const a = raw as Record<string, unknown>;
  const position = parseVec3(a.position);
  if (typeof a.id !== "string" || typeof a.name !== "string" || !position)
    return null;
  const facing = parseDirection(a.facing);
  const up = facing ? parseDirection(a.up) : null;
  return {
    id: a.id,
    name: a.name,
    position,
    ...(facing ? { facing } : {}),
    ...(up ? { up } : {}),
  };
}

/** A direction, scaled to unit length. A zero or malformed one is no direction. */
function parseDirection(value: unknown): [number, number, number] | null {
  const v = parseVec3(value);
  if (!v) return null;
  const length = Math.hypot(...v);
  if (length === 0) return null;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function parseVec3(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  if (!value.every((n) => typeof n === "number" && Number.isFinite(n)))
    return null;
  return [value[0], value[1], value[2]];
}
