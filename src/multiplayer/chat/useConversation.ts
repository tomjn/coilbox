import { useCallback, useMemo } from "react";
import type { ChatMsg, User } from "../bindings";
import {
  mpSay,
  mpSayBattle,
  mpSayBattleEx,
  mpSayEx,
  mpSayPrivate,
  mpSayPrivateEx,
} from "../bindings";
import { isIgnored, useIgnored } from "../ignore";
import { messageLimit } from "../protocol";
import { useMultiplayer } from "../store";
import { coalesceMessages } from "./coalesce";
import {
  type ConversationDescriptor,
  conversationMembers,
  conversationMessages,
} from "./conversation";

export interface ConversationView {
  title: string;
  subtitle?: string;
  messages: ChatMsg[];
  /**
   * How many lines this conversation holds in the snapshot, which is the count
   * unread bookkeeping has to be marked with.
   *
   * Not `messages.length`. That list has ignored senders filtered out and
   * consecutive lines from one sender coalesced into single entries, so it runs
   * short of what the unread counters measure against, and marking seen with it
   * leaves a count that never reaches zero.
   */
  total: number;
  members: User[];
  /** Send text to this conversation (no-op when not connected/empty). */
  send: (text: string) => Promise<void>;
  /** The longest one message may be on this connection, or null where the
   * protocol sets no limit. */
  maxChars: number | null;
}

/**
 * Bind a conversation descriptor to the live mirror: its title, messages,
 * members, and a `send` that targets the right wire command. This is the single
 * place that knows channel-vs-DM differences, so `ChatPane` stays presentational
 * and the future battle GUI reuses the same component.
 */
export function useConversation(
  desc: ConversationDescriptor | null,
): ConversationView {
  const { mirror, activeKey, protocol } = useMultiplayer();
  const state = mirror.state;
  const [ignored] = useIgnored();

  // Hide ignored senders client-side (channels, battles, and DMs alike). This local
  // filter is belt-and-braces: once #188's server-side IGNORE is set the server also
  // stops relaying them, but this still hides anything the server does relay.
  //
  // Coalescing happens here, above `ChatPane`, because callers derive per-message
  // state from the text they are handed: highlight matching (#193) runs on these,
  // so a mention on the third line of a block has to be part of that block's text
  // by the time it is tested. It runs after the ignore filter, so a hidden sender
  // can't split someone else's block, and is memoised because it is O(n) over the
  // conversation's whole history on every snapshot.
  const all = useMemo(
    () => (state && desc ? conversationMessages(state, desc) : []),
    [state, desc],
  );
  const messages = useMemo(() => {
    const visible = activeKey
      ? all.filter((m) => !isIgnored(ignored, activeKey, m.from))
      : all;
    return coalesceMessages(visible);
  }, [all, ignored, activeKey]);
  const members = useMemo(
    () => (state && desc ? conversationMembers(state, desc) : []),
    [state, desc],
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!activeKey || !desc || !trimmed) return;
      // `/me <text>` is an IRC-style action: strip the prefix and route to the
      // EX (action) wire command. Bare `/me` with no body is a no-op.
      const action = trimmed.match(/^\/me\s+(.+)$/s);
      if (action) {
        const body = action[1];
        if (desc.kind === "channel") {
          await mpSayEx({
            serverKey: activeKey,
            channel: desc.name,
            message: body,
          });
        } else if (desc.kind === "battle") {
          await mpSayBattleEx({ serverKey: activeKey, message: body });
        } else {
          await mpSayPrivateEx({
            serverKey: activeKey,
            username: desc.peer,
            message: body,
          });
        }
        return;
      }
      if (desc.kind === "channel") {
        await mpSay({
          serverKey: activeKey,
          channel: desc.name,
          message: trimmed,
        });
      } else if (desc.kind === "battle") {
        await mpSayBattle({ serverKey: activeKey, message: trimmed });
      } else {
        await mpSayPrivate({
          serverKey: activeKey,
          username: desc.peer,
          message: trimmed,
        });
      }
    },
    [activeKey, desc],
  );

  const battle =
    desc?.kind === "battle" ? state?.battles[String(desc.id)] : undefined;
  const title = !desc
    ? ""
    : desc.kind === "channel"
      ? `#${desc.name}`
      : desc.kind === "battle"
        ? battle?.title || `Battle ${desc.id}`
        : desc.peer;
  const subtitle =
    desc?.kind === "channel"
      ? (state?.channels[desc.name]?.topic ?? undefined)
      : desc?.kind === "battle"
        ? (battle?.map ?? undefined)
        : undefined;

  return {
    title,
    subtitle,
    messages,
    total: all.length,
    members,
    send,
    maxChars: messageLimit(protocol),
  };
}
