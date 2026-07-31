/**
 * Telling a view drawn on demand that a texture it is already using arrived.
 *
 * three's loaders hand back a texture straight away and fill in its pixels
 * later, and they report to whoever asked for the texture rather than to
 * whoever is drawing with it. A view that draws only when something changes has
 * therefore drawn its last frame before the pixels land. An unloaded texture
 * samples as a single black pixel, so the model stays black until something
 * unrelated makes the view redraw, and under reduced motion, where there is no
 * frame loop, nothing does.
 *
 * So a loader says when a texture arrived and `useCanvas3D` draws one more
 * frame. One frame per texture, not a loop.
 */

const listeners = new Set<() => void>();

/** Draw again whenever any texture finishes loading. Answers with the way off. */
export function onTextureArrived(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A texture has its pixels. Called by whoever loaded it. */
export function textureArrived(): void {
  for (const listener of listeners) listener();
}
