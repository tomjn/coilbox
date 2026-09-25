import { describe, expect, it } from "vitest";
import {
  addExplosionGenerator,
  cegFieldValue,
  cegKeyFromFieldValue,
  cegWeaponField,
  checkExplosionGeneratorName,
  newExplosionGenerator,
  parseExplosionGenerators,
  removeExplosionGenerator,
  setExplosionGenerator,
  suggestExplosionGeneratorKey,
} from "./explosionGenerators";

describe("checkExplosionGeneratorName", () => {
  it("accepts a lowercase name with digits and underscores", () => {
    expect(checkExplosionGeneratorName("purple_flash1", undefined)).toEqual({
      key: "purple_flash1",
      verdict: "ok",
      ok: true,
    });
  });

  it("rejects an empty name", () => {
    expect(checkExplosionGeneratorName("  ", undefined).verdict).toBe("empty");
  });

  it("rejects a name with characters outside a-z0-9_", () => {
    expect(
      checkExplosionGeneratorName("Purple Flash!", undefined).verdict,
    ).toBe("invalid");
  });

  it("rejects a name already in the library", () => {
    const generators = {
      flash: newExplosionGenerator("flash", "CBitmapMuzzleFlame"),
    };
    expect(checkExplosionGeneratorName("flash", generators).verdict).toBe(
      "taken",
    );
  });
});

describe("suggestExplosionGeneratorKey", () => {
  it("suggests effect for an empty library", () => {
    expect(suggestExplosionGeneratorKey(undefined)).toBe("effect");
  });

  it("numbers a second suggestion from 2", () => {
    const generators = {
      effect: newExplosionGenerator("effect", "CHeatCloudProjectile"),
    };
    expect(suggestExplosionGeneratorKey(generators)).toBe("effect2");
  });
});

describe("addExplosionGenerator, setExplosionGenerator and removeExplosionGenerator", () => {
  it("adds a generator under its key", () => {
    const generator = newExplosionGenerator("flash", "CBitmapMuzzleFlame");
    const generators = addExplosionGenerator(undefined, generator);
    expect(generators).toEqual({ flash: generator });
  });

  it("leaves an existing key as it is", () => {
    const first = newExplosionGenerator("flash", "CBitmapMuzzleFlame");
    const generators = addExplosionGenerator(
      { flash: first },
      {
        ...newExplosionGenerator("flash", "CHeatCloudProjectile"),
      },
    );
    expect(generators?.flash).toBe(first);
  });

  it("patches an existing generator's fields", () => {
    const generators = {
      flash: newExplosionGenerator("flash", "CBitmapMuzzleFlame"),
    };
    const next = setExplosionGenerator(generators, "flash", { size: 8 });
    expect(next?.flash.size).toBe(8);
    expect(next?.flash.class).toBe("CBitmapMuzzleFlame");
  });

  it("removes a generator by key", () => {
    const generators = {
      flash: newExplosionGenerator("flash", "CBitmapMuzzleFlame"),
    };
    expect(removeExplosionGenerator(generators, "flash")).toEqual({});
  });
});

describe("weapon field naming", () => {
  it("recognises the three CEG-carrying fields case insensitively", () => {
    expect(cegWeaponField("explosionGenerator")).toBe("explosionGenerator");
    expect(cegWeaponField("explosiongenerator")).toBe("explosionGenerator");
    expect(cegWeaponField("bounceExplosionGenerator")).toBe(
      "bounceExplosionGenerator",
    );
    expect(cegWeaponField("cegTag")).toBe("cegTag");
    expect(cegWeaponField("range")).toBeUndefined();
  });

  it("writes cegTag bare, since the engine adds custom: itself", () => {
    expect(cegFieldValue("cegTag", "myflash")).toBe("myflash");
  });

  it("writes explosionGenerator and bounceExplosionGenerator with the prefix", () => {
    expect(cegFieldValue("explosionGenerator", "myflash")).toBe(
      "custom:myflash",
    );
    expect(cegFieldValue("bounceExplosionGenerator", "myflash")).toBe(
      "custom:myflash",
    );
  });

  it("reads a generator's key back out of a field's value", () => {
    expect(cegKeyFromFieldValue("cegTag", "myflash")).toBe("myflash");
    expect(cegKeyFromFieldValue("explosionGenerator", "custom:myflash")).toBe(
      "myflash",
    );
  });

  it("names nothing this project can edit when the prefix is missing", () => {
    expect(
      cegKeyFromFieldValue("explosionGenerator", "myflash"),
    ).toBeUndefined();
    expect(cegKeyFromFieldValue("explosionGenerator", "")).toBeUndefined();
    expect(
      cegKeyFromFieldValue("explosionGenerator", undefined),
    ).toBeUndefined();
  });
});

describe("parseExplosionGenerators", () => {
  it("reads a well formed library back", () => {
    const generator = newExplosionGenerator("flash", "CBitmapMuzzleFlame");
    expect(parseExplosionGenerators({ flash: generator })).toEqual({
      flash: generator,
    });
  });

  it("is empty for anything that is not a record", () => {
    expect(parseExplosionGenerators(undefined)).toEqual({});
    expect(parseExplosionGenerators([1, 2, 3])).toEqual({});
    expect(parseExplosionGenerators("nope")).toEqual({});
  });

  it("drops an entry whose key does not match its own key field", () => {
    const generator = newExplosionGenerator("flash", "CBitmapMuzzleFlame");
    expect(parseExplosionGenerators({ other: generator })).toEqual({});
  });

  it("drops an entry naming a class the engine handler does not know", () => {
    const generator = {
      ...newExplosionGenerator("flash", "CBitmapMuzzleFlame"),
      class: "CNotARealClass",
    };
    expect(parseExplosionGenerators({ flash: generator })).toEqual({});
  });

  it("carries the optional colour and texture fields through", () => {
    const generator = {
      ...newExplosionGenerator("flash", "CSimpleParticleSystem"),
      texture: "gfx/flash.tga",
      color: { r: 1, g: 0.5, b: 0 },
      size: 8,
      lifetime: 30,
      particles: 12,
    };
    expect(parseExplosionGenerators({ flash: generator })).toEqual({
      flash: generator,
    });
  });
});
