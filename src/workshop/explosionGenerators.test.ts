import { describe, expect, it } from "vitest";
import {
  addExplosionGenerator,
  addExplosionSpawn,
  cegFieldValue,
  cegKeyFromFieldValue,
  cegWeaponField,
  checkExplosionGeneratorName,
  type ExplosionGenerators,
  moveExplosionSpawn,
  newExplosionGenerator,
  newExplosionSpawn,
  parseExplosionGenerators,
  removeExplosionGenerator,
  removeExplosionSpawn,
  setExplosionGenerator,
  setExplosionSpawn,
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

describe("newExplosionGenerator", () => {
  it("starts with one spawn of the given class and no ground flash", () => {
    const generator = newExplosionGenerator("flash", "CBitmapMuzzleFlame");
    expect(generator.spawns).toHaveLength(1);
    expect(generator.spawns[0].class).toBe("CBitmapMuzzleFlame");
    expect(generator.groundFlash).toBeUndefined();
    expect(generator.useDefaultExplosions).toBe(false);
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
    const next = setExplosionGenerator(generators, "flash", {
      useDefaultExplosions: true,
    });
    expect(next?.flash.useDefaultExplosions).toBe(true);
    expect(next?.flash.spawns[0].class).toBe("CBitmapMuzzleFlame");
  });

  it("sets and clears a ground flash through a patch", () => {
    let generators: ExplosionGenerators = {
      flash: newExplosionGenerator("flash", "CBitmapMuzzleFlame"),
    };
    generators =
      setExplosionGenerator(generators, "flash", {
        groundFlash: { size: 100 },
      }) ?? generators;
    expect(generators.flash.groundFlash).toEqual({ size: 100 });

    generators =
      setExplosionGenerator(generators, "flash", { groundFlash: undefined }) ??
      generators;
    expect(generators.flash.groundFlash).toBeUndefined();
  });

  it("removes a generator by key", () => {
    const generators = {
      flash: newExplosionGenerator("flash", "CBitmapMuzzleFlame"),
    };
    expect(removeExplosionGenerator(generators, "flash")).toEqual({});
  });
});

describe("addExplosionSpawn, removeExplosionSpawn, setExplosionSpawn and moveExplosionSpawn", () => {
  it("appends a spawn of the given class", () => {
    let generators: ExplosionGenerators = {
      flash: newExplosionGenerator("flash", "CBitmapMuzzleFlame"),
    };
    generators =
      addExplosionSpawn(generators, "flash", "CSimpleParticleSystem") ??
      generators;
    expect(generators.flash.spawns).toHaveLength(2);
    expect(generators.flash.spawns[1].class).toBe("CSimpleParticleSystem");
  });

  it("removes a spawn by index", () => {
    let generators: ExplosionGenerators = {
      flash: newExplosionGenerator("flash", "CBitmapMuzzleFlame"),
    };
    generators =
      addExplosionSpawn(generators, "flash", "CSimpleParticleSystem") ??
      generators;
    generators = removeExplosionSpawn(generators, "flash", 0) ?? generators;
    expect(generators.flash.spawns).toHaveLength(1);
    expect(generators.flash.spawns[0].class).toBe("CSimpleParticleSystem");
  });

  it("patches one spawn's fields by index, leaving the others alone", () => {
    let generators: ExplosionGenerators = {
      flash: newExplosionGenerator("flash", "CBitmapMuzzleFlame"),
    };
    generators =
      addExplosionSpawn(generators, "flash", "CSimpleParticleSystem") ??
      generators;
    generators =
      setExplosionSpawn(generators, "flash", 1, { particles: 20 }) ??
      generators;
    expect(generators.flash.spawns[0].particles).toBeUndefined();
    expect(generators.flash.spawns[1].particles).toBe(20);
  });

  it("swaps two spawns when moved", () => {
    let generators: ExplosionGenerators = {
      flash: newExplosionGenerator("flash", "CBitmapMuzzleFlame"),
    };
    generators =
      addExplosionSpawn(generators, "flash", "CSimpleParticleSystem") ??
      generators;
    generators = moveExplosionSpawn(generators, "flash", 1, "up") ?? generators;
    expect(generators.flash.spawns[0].class).toBe("CSimpleParticleSystem");
    expect(generators.flash.spawns[1].class).toBe("CBitmapMuzzleFlame");
  });

  it("is a no-op moving past either end", () => {
    const generators = {
      flash: newExplosionGenerator("flash", "CBitmapMuzzleFlame"),
    };
    expect(moveExplosionSpawn(generators, "flash", 0, "up")).toBe(generators);
    expect(moveExplosionSpawn(generators, "flash", 0, "down")).toBe(generators);
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

  it("drops a spawn naming a class the engine handler does not know", () => {
    const generator = {
      ...newExplosionGenerator("flash", "CBitmapMuzzleFlame"),
      spawns: [
        { ...newExplosionSpawn("CBitmapMuzzleFlame"), class: "CNotARealClass" },
      ],
    };
    expect(parseExplosionGenerators({ flash: generator })).toEqual({
      flash: { key: "flash", spawns: [], useDefaultExplosions: false },
    });
  });

  it("reads several spawns and a ground flash together", () => {
    let generator = newExplosionGenerator("flash", "CBitmapMuzzleFlame");
    generator = {
      ...generator,
      spawns: [...generator.spawns, newExplosionSpawn("CSimpleParticleSystem")],
      groundFlash: { color: { r: 1, g: 1, b: 0.8 }, size: 100, lifetime: 20 },
      useDefaultExplosions: true,
    };
    expect(parseExplosionGenerators({ flash: generator })).toEqual({
      flash: generator,
    });
  });

  it("carries the optional colour and texture fields through on a spawn", () => {
    const generator = newExplosionGenerator("flash", "CSimpleParticleSystem");
    generator.spawns[0] = {
      ...generator.spawns[0],
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

  describe("migrating a generator saved before issue #3066", () => {
    it("turns a single legacy spawn into a one-spawn generator", () => {
      const legacy = {
        key: "purpleflash",
        class: "CBitmapMuzzleFlame",
        count: 1,
        ground: true,
        water: true,
        air: true,
        underwater: true,
        texture: "flare.tga",
        color: { r: 1, g: 0, b: 1 },
        size: 8,
        lifetime: 30,
      };
      expect(parseExplosionGenerators({ purpleflash: legacy })).toEqual({
        purpleflash: {
          key: "purpleflash",
          spawns: [
            {
              class: "CBitmapMuzzleFlame",
              count: 1,
              ground: true,
              water: true,
              air: true,
              underwater: true,
              texture: "flare.tga",
              color: { r: 1, g: 0, b: 1 },
              size: 8,
              lifetime: 30,
            },
          ],
          useDefaultExplosions: false,
        },
      });
    });

    it("turns a legacy ground flash into a lone ground flash with no spawns", () => {
      const legacy = {
        key: "bigflash",
        class: "CStandardGroundFlash",
        count: 1,
        ground: false,
        water: false,
        air: false,
        underwater: false,
        color: { r: 1, g: 1, b: 0.8 },
        size: 100,
        lifetime: 20,
      };
      expect(parseExplosionGenerators({ bigflash: legacy })).toEqual({
        bigflash: {
          key: "bigflash",
          spawns: [],
          groundFlash: {
            color: { r: 1, g: 1, b: 0.8 },
            size: 100,
            lifetime: 20,
          },
          useDefaultExplosions: false,
        },
      });
    });
  });
});
