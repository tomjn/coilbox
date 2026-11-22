import { useLayoutEffect, useRef } from "react";

/**
 * A ref for a scrolling panel that goes back to its top whenever `key`
 * changes. The panel is one element across selections, so without this a new
 * piece opens at the last piece's scroll offset and its first row can sit
 * half under the edge of the header above (#5404).
 */
export function useScrollTopOnChange<T extends HTMLElement>(key: string) {
  const ref = useRef<T | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: key is the trigger, not a value read inside
  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
  }, [key]);
  return ref;
}
