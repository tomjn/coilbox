import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  CUT_OUT_ALPHA,
  cutOutHiddenPixels,
  paintTeamColour,
  TEAM_COLOUR,
} from "./springTexture";

/**
 * The markers three's own fragment shader carries, in the order it carries
 * them, so a patch that lands on any of them is exercised for real rather than
 * against a string that happens to contain the word.
 */
function stubShader() {
  return {
    uniforms: {} as Record<string, { value: unknown }>,
    fragmentShader: [
      "#include <common>",
      "void main() {",
      "  vec4 diffuseColor = vec4( diffuse, opacity );",
      "  #include <map_fragment>",
      "  #include <alphamap_fragment>",
      "  #include <alphatest_fragment>",
      "  gl_FragColor = vec4( diffuseColor.rgb, diffuseColor.a );",
      "}",
    ].join("\n"),
    vertexShader: "",
  };
}

/** Run whatever patch a material carries over a stub of three's own shader. */
function compile(material: THREE.MeshStandardMaterial) {
  const shader = stubShader();
  // three hands the material the shader it is about to compile.
  material.onBeforeCompile(
    shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    null as unknown as THREE.WebGLRenderer,
  );
  return shader;
}

function patch(colour?: THREE.ColorRepresentation) {
  const material = new THREE.MeshStandardMaterial();
  if (colour === undefined) paintTeamColour(material);
  else paintTeamColour(material, colour);
  return compile(material);
}

describe("paintTeamColour", () => {
  /**
   * The engine's mix, in both of its model shaders:
   * `mix(texColor1.rgb, teamCol.rgb, texColor1.a)`. The alpha of the texture the
   * unit is painted with, which `<map_fragment>` has just multiplied into
   * `diffuseColor`.
   */
  it("mixes on the alpha of the texture the unit is painted with", () => {
    expect(patch().fragmentShader).toContain(
      "diffuseColor.rgb = mix(diffuseColor.rgb, teamColour, diffuseColor.a);",
    );
  });

  /** The second texture is a glow and reflectivity map. Sampling it here is the
   *  bug this replaced: it painted every glowing part in the player's colour. */
  it("samples no second texture", () => {
    const shader = patch();
    expect(shader.fragmentShader).not.toContain("sampler2D teamMask");
    expect(shader.fragmentShader).not.toContain("texture2D(teamMask");
    expect(Object.keys(shader.uniforms)).toEqual(["teamColour"]);
  });

  it("mixes after the map is sampled, not before", () => {
    const { fragmentShader } = patch();
    expect(fragmentShader.indexOf("#include <map_fragment>")).toBeLessThan(
      fragmentShader.indexOf("mix(diffuseColor.rgb"),
    );
  });

  it("declares the uniform it uses", () => {
    expect(patch().fragmentShader).toContain("uniform vec3 teamColour;");
  });

  it("takes the caller's colour, and its own when there is none", () => {
    const mine = patch(0xff0000).uniforms.teamColour.value as THREE.Color;
    expect(mine.getHex()).toBe(0xff0000);
    const stand = patch().uniforms.teamColour.value as THREE.Color;
    expect(stand.getHex()).toBe(TEAM_COLOUR);
  });

  /** Without a key of its own three reuses the unpatched program it compiled
   *  for another material with the same parameters. */
  it("gives the patched program a cache key", () => {
    const material = new THREE.MeshStandardMaterial();
    paintTeamColour(material);
    expect(material.customProgramCacheKey()).toBe("coilbox-spring:team:");
  });
});

/** The cut-out mask, which is the second texture's alpha. */
describe("cutOutHiddenPixels", () => {
  function masked() {
    const material = new THREE.MeshStandardMaterial();
    cutOutHiddenPixels(material, new THREE.Texture());
    return material;
  }

  /**
   * The engine's rule: `float alpha = teamCol.a * float(texColor2.a >= 0.5)`
   * in `ModelFragProgGL4.glsl`, discarded against a test of "greater than 0.5".
   * three's own `alphatest_fragment` discards below the threshold, which is the
   * same cut.
   */
  it("discards below half the second texture's alpha", () => {
    const material = masked();
    expect(material.alphaTest).toBe(CUT_OUT_ALPHA);
    expect(CUT_OUT_ALPHA).toBe(0.5);
    expect(material.alphaMap).toBeInstanceOf(THREE.Texture);
  });

  /**
   * An alpha test, not transparency. A transparent material stops writing depth
   * and is sorted per object, and one unit has dozens of cut-out surfaces inside
   * a single mesh.
   */
  it("leaves the material opaque", () => {
    expect(masked().transparent).toBe(false);
  });

  /**
   * three's own chunk reads green and multiplies. The engine reads alpha, and
   * multiplying would fold in the first texture's team-colour mask, cutting the
   * team-colour regions out of the model.
   */
  it("reads the mask's alpha rather than three's green", () => {
    const { fragmentShader } = compile(masked());
    expect(fragmentShader).toContain(
      "diffuseColor.a = texture2D( alphaMap, vAlphaMapUv ).a;",
    );
    expect(fragmentShader).not.toContain("#include <alphamap_fragment>");
    expect(fragmentShader).not.toContain("vAlphaMapUv ).g");
  });

  /**
   * three gives a material one `onBeforeCompile`, and an `.s3o` wants both
   * patches. The unit builder asks for them a frame apart, either way round.
   */
  it("keeps the team colour whichever patch is asked for first", () => {
    for (const order of [0, 1]) {
      const material = new THREE.MeshStandardMaterial();
      const mask = () => cutOutHiddenPixels(material, new THREE.Texture());
      const team = () => paintTeamColour(material, 0xff0000);
      if (order === 0) {
        team();
        mask();
      } else {
        mask();
        team();
      }
      const { fragmentShader, uniforms } = compile(material);
      expect(fragmentShader).toContain("mix(diffuseColor.rgb, teamColour");
      expect(fragmentShader).toContain("texture2D( alphaMap, vAlphaMapUv ).a");
      expect((uniforms.teamColour.value as THREE.Color).getHex()).toBe(
        0xff0000,
      );
    }
  });

  /**
   * The team-colour mix reads the first texture's alpha, so it has to run before
   * the cut-out overwrites it with the second texture's.
   */
  it("mixes the team colour before the mask overwrites the alpha", () => {
    const material = new THREE.MeshStandardMaterial();
    paintTeamColour(material);
    cutOutHiddenPixels(material, new THREE.Texture());
    const { fragmentShader } = compile(material);
    expect(fragmentShader.indexOf("mix(diffuseColor.rgb")).toBeLessThan(
      fragmentShader.indexOf("texture2D( alphaMap"),
    );
  });

  /** Two different patches are two different programs. */
  it("keys a masked program apart from a painted one", () => {
    const painted = new THREE.MeshStandardMaterial();
    paintTeamColour(painted);
    const both = new THREE.MeshStandardMaterial();
    paintTeamColour(both);
    cutOutHiddenPixels(both, new THREE.Texture());
    expect(both.customProgramCacheKey()).not.toBe(
      painted.customProgramCacheKey(),
    );
  });
});
