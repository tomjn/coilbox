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

import { onTextureArrived, textureArrived } from "./textureArrival";

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
 * What a texture the loader gave up on is marked with, because the file is not
 * there or is in a format the webview does not decode.
 *
 * A `.tif` is the one that turns up in a real game: Basically OTA paints
 * `CORE_T1_BOT_Crasher` with one, and macOS's webview reads it where Windows's
 * and Linux's do not. three leaves such a texture empty rather than saying so,
 * and an empty texture samples as zero, which matters to whoever is reading it
 * as a mask.
 */
const FAILED = "springTextureFailed";

/** Whether the loader gave up on this texture, so nothing will ever be in it. */
export function springTextureFailed(texture: THREE.Texture): boolean {
  return texture.userData[FAILED] === true;
}

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
  const gaveUp = () => {
    texture.userData[FAILED] = true;
    textureArrived();
  };
  // The callback is the one a view drawn on demand needs: see textureArrival.ts.
  const texture: THREE.Texture =
    ext === "dds"
      ? new DDSLoader().load(url, textureArrived, undefined, gaveUp)
      : new THREE.TextureLoader().load(url, textureArrived, undefined, gaveUp);
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
 * What one material has had patched into it, so a second patch keeps the first.
 *
 * three gives a material one `onBeforeCompile`, and an `.s3o` wants two things
 * from it. The unit builder asks for them a frame apart, once each texture has
 * answered for itself, so the last one to arrive cannot simply overwrite what is
 * already there.
 */
interface SpringShading {
  teamColour?: THREE.Color;
  cutOut?: boolean;
}

const shading = new WeakMap<THREE.Material, SpringShading>();

/**
 * Rewrite the material's shader patch with `change` folded into whatever is
 * already there.
 *
 * A patch on the standard material rather than a material of our own:
 * everything else about it, the lighting and the colour space, is what the rest
 * of the app already uses.
 */
function shade(
  material: THREE.MeshStandardMaterial,
  change: SpringShading,
): void {
  const shaded: SpringShading = { ...shading.get(material), ...change };
  shading.set(material, shaded);
  const { teamColour, cutOut } = shaded;

  material.onBeforeCompile = (shader) => {
    if (teamColour) {
      shader.uniforms.teamColour = { value: teamColour };
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nuniform vec3 teamColour;",
        )
        .replace(
          "#include <map_fragment>",
          "#include <map_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, teamColour, diffuseColor.a);",
        );
    }
    if (cutOut) {
      // three's own chunk reads green and multiplies. The engine reads alpha,
      // and multiplying would fold in the team-colour mask the line above has
      // already used, cutting the team-colour regions out of the model.
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <alphamap_fragment>",
        "diffuseColor.a = texture2D( alphaMap, vAlphaMapUv ).a;",
      );
    }
  };
  // Without a key of its own three reuses the unpatched program it compiled for
  // another material with the same parameters.
  material.customProgramCacheKey = () =>
    `coilbox-spring:${teamColour ? "team" : ""}:${cutOut ? "cutout" : ""}`;
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
 * The alpha itself never leaves the shader, because three's own
 * `opaque_fragment` sets it back to 1 for a material that is not transparent.
 */
export function paintTeamColour(
  material: THREE.MeshStandardMaterial,
  colour: THREE.ColorRepresentation = TEAM_COLOUR,
): void {
  shade(material, { teamColour: new THREE.Color(colour) });
}

/** Below this the engine draws nothing. One bit, not a gradient. */
export const CUT_OUT_ALPHA = 0.5;

/**
 * Throw away the pixels the `.s3o`'s second texture masks out, the way the
 * engine does.
 *
 * `ModelFragProgGL4.glsl` line 97 reads
 * `float alpha = teamCol.a * float(texColor2.a >= 0.5)` and discards on it, and
 * the opaque model pass sets the test to "greater than 0.5" in
 * `ModelDrawerState.cpp` line 330. So a fragment survives exactly when the
 * second texture's alpha is at least a half. `ModelFragProg.glsl` line 95 is the
 * same rule through the fixed-function alpha test, and calls it a one-bit mask
 * in so many words. Modellers cut shapes out of flat quads with it: a radar
 * dish's mesh, a camo net, a chain link fence.
 *
 * An alpha test rather than transparency, which in three are separate things. A
 * transparent material stops writing depth and is sorted per object, and one
 * unit can have dozens of cut-out surfaces inside a single mesh, which no
 * per-object sort can order. The engine does not blend either: it keeps or drops
 * the whole fragment.
 *
 * A second texture with no alpha channel is not a reason to stop drawing. GL
 * samples the missing channel as 1, so nothing is cut, which is also what the
 * engine does with a second texture it cannot find: it stands in a single opaque
 * pixel, in `S3OTextureHandler.cpp` line 160.
 *
 * A second texture that never loads is a different matter, and is why the mask
 * comes back off again when the loader gives up. An empty texture samples as
 * zero, so a mask the webview cannot decode would mask off the entire model:
 * measured at 0 pixels of 4096 on a plain white quad. Drawing the model whole is
 * the right answer there, and it is what coilbox did before it read the mask at
 * all.
 */
export function cutOutHiddenPixels(
  material: THREE.MeshStandardMaterial,
  mask: THREE.Texture,
): void {
  material.alphaMap = mask;
  material.alphaTest = CUT_OUT_ALPHA;
  shade(material, { cutOut: true });

  const drawWhole = () => {
    material.alphaMap = null;
    material.alphaTest = 0;
    material.needsUpdate = true;
    shade(material, { cutOut: false });
    // Out of the notification this is answering, so the views that have already
    // been told about it this time round get told again.
    queueMicrotask(textureArrived);
  };

  if (springTextureFailed(mask)) {
    drawWhole();
    return;
  }
  const stop = onTextureArrived(() => {
    if (springTextureFailed(mask)) {
      stop();
      drawWhole();
      return;
    }
    // A width is what a texture that holds anything has, decoded or still
    // compressed. The same test `readyToCapture` makes.
    if ((mask.image as { width?: number } | undefined)?.width) stop();
  });
  material.addEventListener("dispose", stop);
}
