import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import type { ConversationDescriptor } from "./conversation";

/**
 * Read a one-shot `?channel=` or `?dm=` query param off the chat route and
 * strip it from the URL, returning the conversation it names once (issue
 * #2406). This is the shape `conversationHref` builds: the address a mention
 * in another channel, a message notification, or the match-result drawer's
 * link to a debriefing channel all resolve to, so any of them can send
 * somebody here without the chat page knowing which one sent them.
 *
 * The shape `useOneShotParam` and `useImportParam` already use, with the
 * param stripped after reading because it is an instruction, not a filter: a
 * value left on the URL would re-fire every time the page re-renders, fighting
 * whatever conversation the reader picks next.
 *
 * This only parses the address off the URL. Whether it names something the
 * reader may actually open, such as a channel already joined, is for the
 * caller to decide against live state (see `resolveConversationRequest`).
 */
export function useConversationParam(): ConversationDescriptor | undefined {
  const [params, setParams] = useSearchParams();
  const [value, setValue] = useState<ConversationDescriptor | undefined>(
    undefined,
  );

  useEffect(() => {
    const channel = params.get("channel");
    const dm = params.get("dm");
    if (!channel && !dm) return;
    setValue(
      channel
        ? { kind: "channel", name: channel }
        : { kind: "dm", peer: dm as string },
    );
    const next = new URLSearchParams(params);
    next.delete("channel");
    next.delete("dm");
    setParams(next, { replace: true });
  }, [params, setParams]);

  return value;
}
