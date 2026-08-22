import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { paintTeamColour, TEAM_COLOUR } from "./springTexture";

/**
 * The two markers three's own fragment shader carries, in the order it carries
 * them, so a patch that lands on either is exercised for real rather than
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
      "  gl_FragColor = vec4( diffuseColor.rgb, diffuseColor.a );",
      "}",
    ].join("\n"),
    vertexShader: "",
  };
}

function patch(colour?: THREE.ColorRepresentation) {
  const material = new THREE.MeshStandardMaterial();
  if (colour === undefined) paintTeamColour(material);
  else paintTeamColour(material, colour);
  const shader = stubShader();
  // three hands the material the shader it is about to compile.
  material.onBeforeCompile(
    shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    null as unknown as THREE.WebGLRenderer,
  );
  return shader;
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
    expect(material.customProgramCacheKey()).toBe("coilbox-team-colour");
  });
});
