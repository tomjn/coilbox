import { useCallback, useMemo } from "react";
import type { ChatMsg, User } from "../bindings";
import { mpSay, mpSayPrivate } from "../bindings";
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

  const messages = useMemo(
    () => (state && desc ? conversationMessages(state, desc) : []),
    [state, desc],
  );
  const members = useMemo(
    () => (state && desc ? conversationMembers(state, desc) : []),
    [state, desc],
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!activeKey || !desc || !trimmed) return;
      if (desc.kind === "channel") {
        await mpSay({
          serverKey: activeKey,
          channel: desc.name,
          message: trimmed,
        });
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

  const title = !desc
    ? ""
    : desc.kind === "channel"
      ? `#${desc.name}`
      : desc.peer;
  const subtitle =
    desc?.kind === "channel"
      ? (state?.channels[desc.name]?.topic ?? undefined)
      : undefined;

  return { title, subtitle, messages, members, send };
}
