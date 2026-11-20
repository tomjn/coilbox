import { useSetting } from "@picoframe/frame";
import { useCallback } from "react";
import type { ChatMsg } from "../bindings";
import {
  HIGHLIGHT_OWN_KEY,
  HIGHLIGHT_WORDS_KEY,
  matchesHighlight,
} from "./highlight";

/**
 * Whether a message mentions you, for the outline the chat page and battle chat
 * draw round it (issue #193). Your own messages never count, even if you type
 * your own name.
 */
export function useIsHighlighted(me: string | null): (m: ChatMsg) => boolean {
  const [words] = useSetting<string[]>(HIGHLIGHT_WORDS_KEY, []);
  const [own] = useSetting<boolean>(HIGHLIGHT_OWN_KEY, true);
  return useCallback(
    (m: ChatMsg): boolean =>
      m.from !== me && matchesHighlight(m.text, words, me, own),
    [me, words, own],
  );
}
