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
import { useMultiplayer } from "../store";
import {
  type ConversationDescriptor,
  conversationMembers,
  conversationMessages,
} from "./conversation";

export interface ConversationView {
  title: string;
  subtitle?: string;
  messages: ChatMsg[];
  members: User[];
  /** Send text to this conversation (no-op when not connected/empty). */
  send: (text: string) => Promise<void>;
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
  const { mirror, activeKey } = useMultiplayer();
  const state = mirror.state;
  const [ignored] = useIgnored();

  // Hide ignored senders client-side (channels, battles, and DMs alike). Purely
  // local; server-side IGNORE sync is issue #188.
  const messages = useMemo(() => {
    const all = state && desc ? conversationMessages(state, desc) : [];
    if (!activeKey) return all;
    return all.filter((m) => !isIgnored(ignored, activeKey, m.from));
  }, [state, desc, ignored, activeKey]);
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

  return { title, subtitle, messages, members, send };
}
