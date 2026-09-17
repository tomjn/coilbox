import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import type { ConversationDescriptor } from "./conversation";

/** A one-shot conversation address off the chat route: the conversation
 * `useConversationParam` read, plus the `serverKey` a `?server=` param
 * named, or null when the link carried none (issue #2843). A null
 * `serverKey` means "the active connection", covering both an old link from
 * before servers were distinguished and a link built with one connection
 * open. */
export interface RequestedConversation {
  descriptor: ConversationDescriptor;
  serverKey: string | null;
}

/**
 * Read a one-shot `?channel=`/`?dm=` query param, with an optional `?server=`
 * beside it, off the chat route and strip them from the URL, returning the
 * conversation they name once (issue #2406, extended by #2843). This is the
 * shape `conversationHref` builds: the address a mention in another channel, a
 * message notification, or the match-result drawer's link to a debriefing
 * channel all resolve to, so any of them can send somebody here without the
 * chat page knowing which one sent them.
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
export function useConversationParam(): RequestedConversation | undefined {
  const [params, setParams] = useSearchParams();
  const [value, setValue] = useState<RequestedConversation | undefined>(
    undefined,
  );

  useEffect(() => {
    const channel = params.get("channel");
    const dm = params.get("dm");
    if (!channel && !dm) return;
    setValue({
      descriptor: channel
        ? { kind: "channel", name: channel }
        : { kind: "dm", peer: dm as string },
      serverKey: params.get("server"),
    });
    const next = new URLSearchParams(params);
    next.delete("channel");
    next.delete("dm");
    next.delete("server");
    setParams(next, { replace: true });
  }, [params, setParams]);

  return value;
}
