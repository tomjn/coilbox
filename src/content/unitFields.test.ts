import { describe, expect, it } from "vitest";
import {
  ENGINE_UNIT_FIELDS,
  ENGINE_UNPARSED_READS,
  ENGINE_WEAPON_FIELDS,
} from "./engineUnitFields.generated";
import { UNIT_FIELD_NOTES, WEAPON_FIELD_NOTES } from "./unitFieldNotes";
import {
  type DefKind,
  describeField,
  type EngineFieldType,
  engineFields,
  normaliseFieldPath,
  openTables,
} from "./unitFields";

const TYPES: EngineFieldType[] = [
  "any",
  "boolean",
  "float3",
  "float4",
  "integer",
  "number",
  "string",
  "table",
];

/**
 * The floors are what the generator produced at RecoilEngine 2026.07.04. They
 * exist so a regeneration that loses a whole parser file, or a parse that stops
 * recognising one of the engine's call shapes, fails here rather than quietly
 * shipping a shorter list.
 */
describe("the generated registry", () => {
  it("has every unit field the engine read at the pinned tag", () => {
    expect(ENGINE_UNIT_FIELDS.length).toBeGreaterThanOrEqual(269);
  });

  it("has every weapon field the engine read at the pinned tag", () => {
    expect(ENGINE_WEAPON_FIELDS.length).toBeGreaterThanOrEqual(218);
  });

  it("gives every field a key, a known type and somewhere it came from", () => {
    for (const kind of ["unit", "weapon"] as DefKind[]) {
      for (const field of engineFields(kind)) {
        expect(field.key, `${kind} field with an empty key`).not.toBe("");
        expect(TYPES, `${kind}.${field.key}`).toContain(field.type);
        expect(field.sources.length, `${kind}.${field.key}`).toBeGreaterThan(0);
      }
    }
  });

  it("has no duplicate paths", () => {
    for (const kind of ["unit", "weapon"] as DefKind[]) {
      const paths = engineFields(kind).map((f) =>
        f.section === "" ? f.key : `${f.section}.${f.key}`,
      );
      expect(new Set(paths).size).toBe(paths.length);
    }
  });

  it("names the tables a game may put any key into", () => {
    expect(openTables("unit")).toContain("customParams");
    expect(openTables("weapon")).toContain("customParams");
  });
});

/**
 * One key per parser file and per call shape the generator understands. If any
 * of these stops appearing, that shape has stopped parsing and the fields that
 * only that shape produces are gone.
 */
describe("each shape the generator parses", () => {
  it("reads a plain LuaTable getter", () => {
    const f = describeField("unit", "buildTime");
    expect(f.known).toBe(true);
    expect(f.type).toBe("number");
    expect(f.default).toBe(100);
  });

  it("reads a getter nested in a default slot as a fallback key", () => {
    expect(describeField("unit", "health").engine?.fallsBackTo).toContain(
      "maxDamage",
    );
    expect(describeField("unit", "maxDamage").known).toBe(true);
  });

  it("reads keys out of a sub-table", () => {
    const f = describeField("unit", "collisionVolume.type");
    expect(f.known).toBe(true);
    expect(f.engine?.section).toBe("collisionVolume");
  });

  it("reads the shared solid-object parser", () => {
    expect(describeField("unit", "trackWidth").default).toBe(32);
  });

  it("reads sound keys out of the LoadSounds call sites", () => {
    expect(describeField("unit", "sounds.ok").known).toBe(true);
    expect(describeField("unit", "sounds.underattack").known).toBe(true);
  });

  it("reads a declared weapon tag, help text and all", () => {
    const f = describeField("weapon", "range");
    expect(f.default).toBe(10);
    expect(f.help).toMatch(/Maximum targeting range/);
  });

  it("reads a dummy weapon tag, which no getter mentions", () => {
    expect(describeField("weapon", "collideEnemy").known).toBe(true);
  });

  it("prefers a weapon tag's external name over its C++ member name", () => {
    const f = describeField("weapon", "shield.interceptType");
    expect(f.known).toBe(true);
    expect(f.engine?.fallsBackTo).toContain("shieldInterceptType");
  });

  it("still finds a key whose only getter has a runtime key", () => {
    // soundHit is read only inside wdTable.GetString(soundKey, ...).
    expect(describeField("weapon", "soundHit").known).toBe(true);
    expect(describeField("weapon", "soundHitVolume").known).toBe(true);
  });
});

/**
 * The engine builds a few keys at runtime, so no key can be taken from the
 * read. Pinning the list means a new one shows up as a test failure and gets a
 * decision, instead of being absent from the registry with nobody the wiser.
 */
describe("reads with no literal key", () => {
  it("is the list we have looked at", () => {
    expect(ENGINE_UNPARSED_READS).toHaveLength(14);
  });

  it("says where each one is and what it looks like", () => {
    for (const read of ENGINE_UNPARSED_READS) {
      expect(read.where).toMatch(/^rts\/.+\.cpp:\d+$/);
      expect(read.call).not.toBe("");
    }
  });
});

describe("the hand-written notes", () => {
  it("cannot describe a field the engine does not read", () => {
    for (const [kind, notes] of [
      ["unit", UNIT_FIELD_NOTES],
      ["weapon", WEAPON_FIELD_NOTES],
    ] as [DefKind, Record<string, unknown>][]) {
      for (const path of Object.keys(notes)) {
        expect(describeField(kind, path).known, `${kind} note ${path}`).toBe(
          true,
        );
      }
    }
  });

  it("cannot change a field's type or default", () => {
    const f = describeField("unit", "speed");
    expect(f.label).toBe("Speed");
    expect(f.unit).toBe("elmo/s");
    expect(f.type).toBe("number");
  });

  it("leaves an undescribed field rendering under its own key", () => {
    const f = describeField("unit", "seismicSignature");
    expect(UNIT_FIELD_NOTES.seismicSignature).toBeUndefined();
    expect(f.known).toBe(true);
    expect(f.label).toBe("seismicSignature");
  });
});

describe("a key only the game declares", () => {
  it("comes back marked unknown so it can render as a raw row", () => {
    const f = describeField("unit", "unitgroup");
    expect(f.known).toBe(false);
    expect(f.label).toBe("unitgroup");
    expect(f.type).toBe("any");
    expect(f.default).toBeUndefined();
  });

  it("keeps custom parameters unknown, since only the game gives them meaning", () => {
    expect(describeField("unit", "customParams.techlevel").known).toBe(false);
  });
});

describe("array positions in a path", () => {
  it("resolves through the index to the field", () => {
    expect(normaliseFieldPath("weapons.3.mainDir")).toBe("weapons.*.mainDir");
    expect(describeField("unit", "weapons.3.mainDir").known).toBe(true);
  });
});
