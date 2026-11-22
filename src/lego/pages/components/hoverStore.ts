import { useSyncExternalStore } from "react";

/**
 * The piece under the pointer, whether over its mesh in the 3D view or its
 * row in the sidebar tree.
 *
 * Kept out of React state on purpose. As page state, every change of hovered
 * piece re-rendered the whole builder and its piece tree, about 50 ms a change
 * on a unit with 400 pieces, which halved the frame rate while the pointer
 * moved (#5417). Here the viewport draws a change straight away and only the
 * two tree rows whose highlight changes re-render.
 */
export interface HoverStore {
  get(): string | null;
  set(pieceId: string | null): void;
  subscribe(listener: () => void): () => void;
}

export function createHoverStore(): HoverStore {
  let current: string | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set: (pieceId) => {
      if (pieceId === current) return;
      current = pieceId;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const NEVER = () => () => {};

/** Whether this piece is the hovered one. Re-renders only when that answer
 *  changes, not on every change of hovered piece. */
export function useIsHovered(
  store: HoverStore | undefined,
  pieceId: string,
): boolean {
  return useSyncExternalStore(
    store?.subscribe ?? NEVER,
    () => store?.get() === pieceId,
  );
}
