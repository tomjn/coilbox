/**
 * Custom explosion generators the project writes as `effects/<name>.lua`
 * (issue #2643): a form over the four emitter classes people actually use,
 * bound to a weapon's impact, bounce or trail field.
 *
 * The engine loads every `effects/*.lua` file as a table of CEG name to a
 * table of spawn entries (`gamedata/explosions.lua`'s `LoadLuas`, in
 * `cont/base/springcontent`, called from
 * `CExplosionGeneratorHandler::ParseExplosionTables`,
 * `rts/Sim/Projectiles/ExplosionGenerator.cpp:208`). A weapon names one
 * through three fields, read straight off `WeaponDef.cpp:282-284`:
 *
 *  - `explosionGenerator` (impact) and `bounceExplosionGenerator` (bounce)
 *    are read with whatever prefix the value carries, so a custom one has to
 *    be written `custom:<name>` by hand.
 *  - `cegTag` (trail, emitted every frame) always gets `custom:` added by
 *    the engine (`LoadCustomGeneratorID`, `ExplosionGenerator.h:60`), so it
 *    is written as the bare name.
 *
 * A generator holds a list of spawns (each one of the three particle
 * classes, with its own colour, texture, size, count and lifetime), plus an
 * optional ground flash and a `useDefaultExplosions` toggle, matching the
 * engine's own general case (several spawns, an optional `groundflash`
 * sub-table alongside them, `useDefaultExplosions` layering the built-in
 * explosion on top) rather than the single spawn issue #2643 shipped with
 * (issue #3066).
 *
 * `CStandardGroundFlash` is the odd one out, which is why it is not one of
 * the spawn classes: every real CEG file measured for this issue uses the
 * engine's reserved `groundflash` key rather than a generic spawn entry for
 * it (`ExplosionGenerator.cpp:1027-1039` parses that key unconditionally,
 * outside the spawn loop, and always adds the ground gating flag itself), so
 * `compile.rs` writes it that way rather than as a `class =
 * "CStandardGroundFlash"` spawn, and it takes neither a repeat count nor the
 * gating flags the three spawn classes do.
 *
 * A project saved before this issue holds one spawn's fields directly on
 * the generator (a `class` field alongside `count` and the gating flags).
 * `parseExplosionGenerators` migrates that shape on read into a single
 * spawn, or into a lone ground flash when the old `class` was
 * `CStandardGroundFlash`, so a generator saved by #2643 loads unchanged and
 * still writes the same CEG file. There is no `kindVersion` bump for this:
 * the migration is lossless and the old shape is still recognisable from
 * its own fields.
 */

/** The four emitter classes the form covers, in engine spelling
 *  (`rts/Rendering/Env/Particles/Classes/*.cpp`, `rts/Rendering/GroundFlash.cpp`). */
export type CegClass =
  | "CBitmapMuzzleFlame"
  | "CSimpleParticleSystem"
  | "CHeatCloudProjectile"
  | "CStandardGroundFlash";

/** The classes, in the order the form offers them. */
export const CEG_CLASSES: { value: CegClass; label: string }[] = [
  { value: "CBitmapMuzzleFlame", label: "Muzzle flame" },
  { value: "CSimpleParticleSystem", label: "Particle system" },
  { value: "CHeatCloudProjectile", label: "Heat cloud" },
  { value: "CStandardGroundFlash", label: "Ground flash" },
];

/** The three classes a spawn can be. `CStandardGroundFlash` is not one of
 *  them: it is the generator's separate `groundFlash` slot instead, matching
 *  the engine's own reserved `groundflash` key (see this module's doc
 *  comment). */
export type SpawnClass = Exclude<CegClass, "CStandardGroundFlash">;

/** The spawn classes, in the order the form offers them. */
export const SPAWN_CLASSES: { value: SpawnClass; label: string }[] =
  CEG_CLASSES.filter(
    (c): c is { value: SpawnClass; label: string } =>
      c.value !== "CStandardGroundFlash",
  );

/** A constant colour, 0 to 1 per channel, the way `CColorMap::LoadFromDefString`
 *  and a ground flash's `color` field both read one
 *  (`rts/Rendering/Textures/ColorMap.cpp:98`, `System/Color.h`'s float
 *  constructor). */
export interface CegColor {
  r: number;
  g: number;
  b: number;
}

/** One spawn: one of the three particle classes, fired some number of times
 *  and gated on what was actually hit. */
export interface ExplosionSpawn {
  class: SpawnClass;
  /** How many times the spawn fires per explosion. */
  count: number;
  /** Gating flags, OR'd by the engine against what was actually hit
   *  (`GetFlagsFromTable`, `ExplosionGenerator.cpp:60`). */
  ground: boolean;
  water: boolean;
  air: boolean;
  underwater: boolean;
  /** `sidetexture`/`fronttexture` (muzzle flame) or `texture` (particle
   *  system, heat cloud). */
  texture?: string;
  /** A constant colour: a two-stop colormap. Unused by heat cloud, which has
   *  no colour of its own. */
  color?: CegColor;
  /** `size` (muzzle flame, heat cloud) or `particlesize` (particle system). */
  size?: number;
  /** `ttl` in frames (muzzle flame) or `particlelife` (particle system) or
   *  `heatfalloff` (heat cloud, which has no fixed lifetime: this is how
   *  fast its heat drains rather than a frame count). */
  lifetime?: number;
  /** `numparticles`. Particle system only. */
  particles?: number;
}

/** A generator's optional ground flash: the engine's reserved `groundflash`
 *  key, which takes neither a repeat count nor the gating flags a spawn
 *  does. */
export interface GroundFlash {
  /** The `color` float3. */
  color?: CegColor;
  /** `flashSize`. */
  size?: number;
  /** `ttl` in frames. */
  lifetime?: number;
}

/** One custom explosion generator: a list of spawns, plus an optional ground
 *  flash and the engine's `useDefaultExplosions` toggle (issue #3066). */
export interface ExplosionGenerator {
  /** Its name, which is the file's own `effects/<key>.lua` and the CEG's key
   *  inside it. */
  key: string;
  spawns: ExplosionSpawn[];
  /** Present when the generator also scorches the ground, independently of
   *  whatever spawns it has. */
  groundFlash?: GroundFlash;
  /** Whether the engine's own built-in explosion also plays alongside this
   *  generator's spawns. */
  useDefaultExplosions: boolean;
}

/** The project's explosion generators, by key. */
export type ExplosionGenerators = Record<string, ExplosionGenerator>;

const KEY_PATTERN = /^[a-z0-9_]+$/;

/** Why a name can or cannot be an explosion generator's, the same rule a
 *  library weapon's name follows (`weaponLibrary.ts`), since this name also
 *  becomes a file name in the generated game. */
export type CegNameVerdict = "empty" | "invalid" | "taken" | "ok";

export interface CegNameCheck {
  key: string;
  verdict: CegNameVerdict;
  ok: boolean;
}

export function checkExplosionGeneratorName(
  raw: string,
  generators: ExplosionGenerators | undefined,
): CegNameCheck {
  const key = raw.trim().toLowerCase();
  const verdict: CegNameVerdict = !key
    ? "empty"
    : !KEY_PATTERN.test(key)
      ? "invalid"
      : generators && Object.hasOwn(generators, key)
        ? "taken"
        : "ok";
  return { key, verdict, ok: verdict === "ok" };
}

/** A name to offer for a new generator: `effect`, numbered from the second. */
export function suggestExplosionGeneratorKey(
  generators: ExplosionGenerators | undefined,
): string {
  const taken = (key: string) => !!generators && Object.hasOwn(generators, key);
  if (!taken("effect")) return "effect";
  let n = 2;
  while (taken(`effect${n}`)) n += 1;
  return `effect${n}`;
}

/** A fresh spawn of the given class, with the gating flags on so it actually
 *  fires (issue #2643's own reading of `Explosion()`'s OR, not an AND,
 *  `ExplosionGenerator.cpp:1097`). */
export function newExplosionSpawn(cegClass: SpawnClass): ExplosionSpawn {
  return {
    class: cegClass,
    count: 1,
    ground: true,
    water: true,
    air: true,
    underwater: true,
  };
}

/** A fresh generator holding one spawn of the given class. */
export function newExplosionGenerator(
  key: string,
  cegClass: SpawnClass,
): ExplosionGenerator {
  return {
    key,
    spawns: [newExplosionSpawn(cegClass)],
    useDefaultExplosions: false,
  };
}

/** Add a generator. One already under that key is left as it is. */
export function addExplosionGenerator(
  generators: ExplosionGenerators | undefined,
  generator: ExplosionGenerator,
): ExplosionGenerators | undefined {
  if (generators && Object.hasOwn(generators, generator.key)) return generators;
  return { ...generators, [generator.key]: generator };
}

/** Replace one generator's fields. */
export function setExplosionGenerator(
  generators: ExplosionGenerators | undefined,
  key: string,
  patch: Partial<Omit<ExplosionGenerator, "key">>,
): ExplosionGenerators | undefined {
  const generator = generators?.[key];
  if (!generators || !generator) return generators;
  return { ...generators, [key]: { ...generator, ...patch } };
}

/** Take a generator out of the project. */
export function removeExplosionGenerator(
  generators: ExplosionGenerators | undefined,
  key: string,
): ExplosionGenerators | undefined {
  if (!generators || !Object.hasOwn(generators, key)) return generators;
  const { [key]: _gone, ...rest } = generators;
  return rest;
}

/** Add a spawn of the given class to the end of a generator's list. */
export function addExplosionSpawn(
  generators: ExplosionGenerators | undefined,
  key: string,
  cegClass: SpawnClass,
): ExplosionGenerators | undefined {
  const generator = generators?.[key];
  if (!generators || !generator) return generators;
  return {
    ...generators,
    [key]: {
      ...generator,
      spawns: [...generator.spawns, newExplosionSpawn(cegClass)],
    },
  };
}

/** Take one spawn out of a generator by its index. */
export function removeExplosionSpawn(
  generators: ExplosionGenerators | undefined,
  key: string,
  index: number,
): ExplosionGenerators | undefined {
  const generator = generators?.[key];
  if (!generators || !generator?.spawns[index]) return generators;
  return {
    ...generators,
    [key]: {
      ...generator,
      spawns: generator.spawns.filter((_, i) => i !== index),
    },
  };
}

/** Patch one spawn's fields by its index. */
export function setExplosionSpawn(
  generators: ExplosionGenerators | undefined,
  key: string,
  index: number,
  patch: Partial<ExplosionSpawn>,
): ExplosionGenerators | undefined {
  const generator = generators?.[key];
  const spawn = generator?.spawns[index];
  if (!generators || !generator || !spawn) return generators;
  return {
    ...generators,
    [key]: {
      ...generator,
      spawns: generator.spawns.map((s, i) =>
        i === index ? { ...s, ...patch } : s,
      ),
    },
  };
}

/** Swap a spawn with its neighbour in the given direction. A move past
 *  either end is a no-op, so a caller does not have to check bounds first. */
export function moveExplosionSpawn(
  generators: ExplosionGenerators | undefined,
  key: string,
  index: number,
  direction: "up" | "down",
): ExplosionGenerators | undefined {
  const generator = generators?.[key];
  if (!generators || !generator) return generators;
  const target = direction === "up" ? index - 1 : index + 1;
  if (
    index < 0 ||
    index >= generator.spawns.length ||
    target < 0 ||
    target >= generator.spawns.length
  )
    return generators;
  const spawns = [...generator.spawns];
  [spawns[index], spawns[target]] = [spawns[target], spawns[index]];
  return { ...generators, [key]: { ...generator, spawns } };
}

/** The three weapon fields that can name a custom explosion generator
 *  (`WeaponDef.cpp:282-284`). */
export const CEG_WEAPON_FIELDS = [
  "explosionGenerator",
  "bounceExplosionGenerator",
  "cegTag",
] as const;
export type CegWeaponField = (typeof CEG_WEAPON_FIELDS)[number];

/** Which field a lowercased path is, when it is one of the three, matching
 *  the case-insensitive way the rest of the workshop reads a game's own
 *  field spellings. */
export function cegWeaponField(path: string): CegWeaponField | undefined {
  const lower = path.toLowerCase();
  return CEG_WEAPON_FIELDS.find((f) => f.toLowerCase() === lower);
}

/**
 * The value to write into a weapon field so it names a generator: the bare
 * name for `cegTag`, since the engine adds `custom:` itself
 * (`LoadCustomGeneratorID`), and `custom:<name>` for the other two, which the
 * engine reads with whatever prefix is actually there.
 */
export function cegFieldValue(field: CegWeaponField, key: string): string {
  return field === "cegTag" ? key : `custom:${key}`;
}

/** The generator key a field's current value names, or `undefined` when it
 *  names nothing this project can edit: empty, or (for the two prefixed
 *  fields) missing the `custom:` prefix a built-in generator would also
 *  lack. */
export function cegKeyFromFieldValue(
  field: CegWeaponField,
  value: unknown,
): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  if (field === "cegTag") return value;
  return value.startsWith("custom:")
    ? value.slice("custom:".length)
    : undefined;
}

/** One field the form offers for a class, and how to draw it. */
export interface CegFieldSpec {
  key: "texture" | "color" | "size" | "lifetime" | "particles";
  label: string;
  help: string;
}

/** Which of {@link ExplosionSpawn}'s (or, for ground flash, {@link GroundFlash}'s)
 *  optional fields each class uses, and what to call them: the issue's own
 *  list (colour, texture, size, count and lifetime), read against each
 *  class's real parameter name so the label says what the field actually
 *  is. `count` and the gating flags are drawn separately, since every spawn
 *  class takes them the same way and ground flash takes neither. */
export const CEG_CLASS_FIELDS: Record<CegClass, CegFieldSpec[]> = {
  CBitmapMuzzleFlame: [
    {
      key: "texture",
      label: "Texture",
      help: "sidetexture and fronttexture: the same bitmap used for both faces of the flame.",
    },
    {
      key: "color",
      label: "Colour",
      help: "colormap, held as one constant colour.",
    },
    { key: "size", label: "Size", help: "size" },
    { key: "lifetime", label: "Lifetime", help: "ttl, in frames." },
  ],
  CSimpleParticleSystem: [
    { key: "texture", label: "Texture", help: "texture" },
    {
      key: "color",
      label: "Colour",
      help: "colormap, held as one constant colour.",
    },
    { key: "size", label: "Size", help: "particlesize" },
    { key: "lifetime", label: "Lifetime", help: "particlelife, in frames." },
    { key: "particles", label: "Particles", help: "numparticles, per spawn." },
  ],
  CHeatCloudProjectile: [
    { key: "texture", label: "Texture", help: "texture" },
    { key: "size", label: "Size", help: "size" },
    {
      key: "lifetime",
      label: "Fades over",
      help: "heatfalloff: how fast the cloud's heat drains, not a fixed frame count. This class has no colour of its own.",
    },
  ],
  CStandardGroundFlash: [
    { key: "color", label: "Colour", help: "color" },
    { key: "size", label: "Size", help: "flashSize" },
    { key: "lifetime", label: "Lifetime", help: "ttl, in frames." },
  ],
};

/** Read the project's explosion generators out of untrusted JSON, dropping
 *  anything malformed rather than throwing, the way `parseWeaponLibrary`
 *  does. Migrates a generator saved before issue #3066 (one spawn's fields
 *  directly on the generator) into the current shape, as described in this
 *  module's doc comment. */
export function parseExplosionGenerators(value: unknown): ExplosionGenerators {
  const out: ExplosionGenerators = {};
  if (!isRecord(value)) return out;
  for (const [key, raw] of Object.entries(value)) {
    if (!isRecord(raw) || raw.key !== key || !KEY_PATTERN.test(key)) continue;
    const generator = Array.isArray(raw.spawns)
      ? parseCurrentGenerator(key, raw)
      : isCegClass(raw.class)
        ? migrateLegacyGenerator(key, raw)
        : undefined;
    if (generator) out[key] = generator;
  }
  return out;
}

function parseCurrentGenerator(
  key: string,
  raw: Record<string, unknown>,
): ExplosionGenerator {
  const spawns = (raw.spawns as unknown[])
    .map(parseSpawn)
    .filter((s): s is ExplosionSpawn => s !== undefined);
  const generator: ExplosionGenerator = {
    key,
    spawns,
    useDefaultExplosions: raw.useDefaultExplosions === true,
  };
  if (isRecord(raw.groundFlash)) {
    generator.groundFlash = parseGroundFlash(raw.groundFlash);
  }
  return generator;
}

/** A generator saved before issue #3066 held one spawn's fields directly:
 *  `class` alongside `count` and the gating flags, with `CStandardGroundFlash`
 *  sharing that one slot rather than being a separate ground flash. Migrated
 *  losslessly, since either shape writes the same CEG file. */
function migrateLegacyGenerator(
  key: string,
  raw: Record<string, unknown>,
): ExplosionGenerator {
  if (raw.class === "CStandardGroundFlash") {
    return {
      key,
      spawns: [],
      groundFlash: parseGroundFlash(raw),
      useDefaultExplosions: false,
    };
  }
  const spawn = parseSpawn(raw);
  return {
    key,
    spawns: spawn ? [spawn] : [],
    useDefaultExplosions: false,
  };
}

function parseSpawn(raw: unknown): ExplosionSpawn | undefined {
  if (!isRecord(raw) || !isSpawnClass(raw.class)) return undefined;
  const spawn: ExplosionSpawn = {
    class: raw.class,
    count: typeof raw.count === "number" ? raw.count : 1,
    ground: raw.ground === true,
    water: raw.water === true,
    air: raw.air === true,
    underwater: raw.underwater === true,
  };
  if (typeof raw.texture === "string") spawn.texture = raw.texture;
  if (isCegColor(raw.color)) spawn.color = raw.color;
  if (typeof raw.size === "number") spawn.size = raw.size;
  if (typeof raw.lifetime === "number") spawn.lifetime = raw.lifetime;
  if (typeof raw.particles === "number") spawn.particles = raw.particles;
  return spawn;
}

function parseGroundFlash(raw: unknown): GroundFlash {
  const flash: GroundFlash = {};
  if (!isRecord(raw)) return flash;
  if (isCegColor(raw.color)) flash.color = raw.color;
  if (typeof raw.size === "number") flash.size = raw.size;
  if (typeof raw.lifetime === "number") flash.lifetime = raw.lifetime;
  return flash;
}

function isCegClass(value: unknown): value is CegClass {
  return (
    typeof value === "string" && CEG_CLASSES.some((c) => c.value === value)
  );
}

function isSpawnClass(value: unknown): value is SpawnClass {
  return (
    typeof value === "string" && SPAWN_CLASSES.some((c) => c.value === value)
  );
}

function isCegColor(value: unknown): value is CegColor {
  return (
    isRecord(value) &&
    typeof value.r === "number" &&
    typeof value.g === "number" &&
    typeof value.b === "number"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
