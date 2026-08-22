/**
 * Loading a Spring unit texture into three.js, and painting the team-colour
 * regions an `.s3o` marks in the alpha of the one it is painted with.
 *
 * Shared by the game model viewer, which reads textures out of a game archive,
 * and by the unit builder's imported units, which read them out of coilbox's
 * own store. The two find their bytes in completely different places and agree
 * on everything after that: which loader reads which format, which way up a DDS
 * samples, and how the mask reaches the shader.
 */

import * as THREE from "three";
import { DDSLoader } from "three/addons/loaders/DDSLoader.js";

import { textureArrived } from "./textureArrival";

/**
 * What a team-colour region is drawn in when the caller has no colour of its
 * own.
 *
 * The regions are black in the texture a unit is painted with and marked in its
 * alpha channel, because the engine paints them in the player's colour. A viewer
 * of a lone model has no player to take a colour from, so it picks one. A view
 * that does know whose the unit is, such as the scenario editor, passes that
 * colour instead.
 */
export const TEAM_COLOUR = 0x1028cc;

/** Textures shared for the session, keyed by URL. A game's unit atlas can be
 *  64 MiB and hundreds of its units sample it. */
const textures = new Map<string, THREE.Texture>();

/**
 * Load a texture by URL, picking the loader from its extension.
 *
 * Only two cases, because whatever produced the file has already re-encoded the
 * `.bmp` and `.tga` a webview cannot read. `.dds` goes to the GPU still
 * compressed rather than being decoded anywhere: a shared 8192 square atlas is
 * 64 MiB packed and 256 MiB as RGBA.
 *
 * Always sRGB, because the only Spring texture coilbox draws with is the one a
 * unit is painted with. The team-colour mask rides in that texture's alpha,
 * which no colour space touches.
 */
export function springTexture(url: string): THREE.Texture {
  const cached = textures.get(url);
  if (cached) return cached;

  const clean = url.split(/[?#]/)[0];
  const ext = clean.slice(clean.lastIndexOf(".") + 1).toLowerCase();
  // The callback is the one a view drawn on demand needs: see textureArrival.ts.
  const texture =
    ext === "dds"
      ? new DDSLoader().load(url, textureArrived)
      : new THREE.TextureLoader().load(url, textureArrived);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  // The engine flips every texture to OpenGL's bottom-up order on load,
  // including a DDS. three does that for anything it decodes itself, but a
  // compressed texture is uploaded block by block and cannot be flipped, so the
  // sampling is turned upside down instead.
  if (ext === "dds") {
    texture.flipY = false;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, -1);
    texture.offset.set(0, 1);
  }
  textures.set(url, texture);
  return texture;
}

/**
 * Drop a texture from the shared cache and free it.
 *
 * The builder's store is content addressed, so refreshing an edited texture
 * mints a new URL every time. Without this a session's worth of refreshes on an
 * 8 MiB texture would hold every version of it on the GPU.
 */
export function releaseSpringTexture(url: string): void {
  const texture = textures.get(url);
  if (!texture) return;
  texture.dispose();
  textures.delete(url);
}

/**
 * Paint the team-colour regions the material's own map marks in its alpha.
 *
 * The engine's two model shaders both mix straight from the first texture's
 * alpha and never read the second one for this:
 * `texColor1.rgb = mix(texColor1.rgb, teamCol.rgb, texColor1.a)` in
 * `ModelFragProgGL4.glsl`, and the same line over `gl_FragColor` in
 * `ModelFragProg.glsl`. `S3OTextureHandler.cpp` says it in words: the first
 * texture is "diffuse color (RGB) and teamcolor (A)", the second is "glow (R),
 * reflectivity (G) and 1-bit Alpha (A)".
 *
 * Only for an `.s3o`. A `.3do`'s texture alpha is reflectivity, which the engine
 * moves into the second texture's green rather than reading as a mask.
 *
 * A patch on the standard material rather than a material of our own:
 * everything else about it, the lighting and the colour space, is what the rest
 * of the app already uses. The alpha itself never leaves the shader, because
 * three's own `opaque_fragment` sets it back to 1 for a material that is not
 * transparent.
 */
export function paintTeamColour(
  material: THREE.MeshStandardMaterial,
  colour: THREE.ColorRepresentation = TEAM_COLOUR,
): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.teamColour = { value: new THREE.Color(colour) };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform vec3 teamColour;",
      )
      .replace(
        "#include <map_fragment>",
        "#include <map_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, teamColour, diffuseColor.a);",
      );
  };
  // Without this three reuses the unpatched program it compiled for another
  // material with the same parameters.
  material.customProgramCacheKey = () => "coilbox-team-colour";
}
