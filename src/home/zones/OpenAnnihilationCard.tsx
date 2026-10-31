import { useLingui } from "@lingui/react/macro";
import type { NavItem } from "@picoframe/plugin-sdk";
import { Channel } from "@tauri-apps/api/core";
import { useState } from "react";
import { describeError } from "@/i18n/uiError";
import { OpenAnnihilationIcon } from "../../multiplayer/OpenAnnihilationIcon";
import { useOpenAnnihilation } from "../../multiplayer/openAnnihilation";
import { type OaEvent, playOaLaunch } from "../../play/bindings";
import { getGameMatcher } from "../../profile/profile";
import { OA_CARD_ID } from "../openAnnihilationArt";
import { ToolCard } from "./ToolCards";

export { OA_CARD_ID };

/** Where the Get Open Annihilation link goes when OA is not set up. */
export const CORE_PRIME_URL = "https://play.coreprime.net";

/**
 * Which shape Open Annihilation takes on the home page (issue #4973): a `card`
 * once the program path is set, a `link` out to Core Prime until then, and
 * neither under a profile's game filter. The grid reads it so the row's height
 * counts the card's picture only while the card is showing.
 */
export function useOpenAnnihilationOffer(): {
  card: boolean;
  link: NavItem | null;
} {
  const { t } = useLingui();
  const [program] = useOpenAnnihilation();
  if (getGameMatcher() !== null) return { card: false, link: null };
  if (program) return { card: true, link: null };
  return {
    card: false,
    link: {
      id: OA_CARD_ID,
      label: t`Get Open Annihilation`,
      icon: OpenAnnihilationIcon,
      href: CORE_PRIME_URL,
    },
  };
}

/**
 * A welcome card for Open Annihilation (issue #4945), in the Play group beside
 * the other cards (issue #4966).
 *
 * With the program path from #4943 set, pressing it starts OA with no arguments
 * of its own, so its intro plays. Without one it draws nothing: the group shows
 * a Get Open Annihilation link chip in its links card instead (issue #4973), so
 * a game the player has not installed does not take a picture's footprint.
 *
 * It is {@link ToolCard} with a synthetic nav item, so it has the same shell,
 * art and focus ring as the cards around it, and its picture is that of
 * `openAnnihilationArt.ts` unless a distribution overrides it. The group hands
 * it `compact` for the same reason it hands it to the other cards.
 *
 * ## A profile narrowed to a game hides it
 *
 * OA is not a Recoil game, and a `gameFilter` narrows the profile to Recoil
 * games, so any filter at all hides the card. It is the same rule
 * `scopeToProfileGame` applies to battle rows on another engine.
 *
 * ## A refused launch
 *
 * The launch rejects with a message when the stored path has gone stale, when
 * OA refuses an option, and while another OA runs. The card shows it under
 * itself and keeps working, so pressing it again retries and clears the message.
 */
export default function OpenAnnihilationCard({
  compact = false,
}: {
  compact?: boolean;
}) {
  const { t } = useLingui();
  const [program] = useOpenAnnihilation();
  const [error, setError] = useState<string | null>(null);
  if (getGameMatcher() !== null || !program) return null;

  const launch = async () => {
    setError(null);
    try {
      // One channel per call: a channel reused across commands stops delivering.
      await playOaLaunch({
        executable: program.path,
        args: [],
        runId: crypto.randomUUID(),
        onEvent: new Channel<OaEvent>(),
      });
    } catch (e) {
      setError(describeError(e));
    }
  };

  const item: NavItem = {
    id: OA_CARD_ID,
    label: t`Play Open Annihilation`,
    icon: OpenAnnihilationIcon,
  };

  return (
    <div className="flex w-full flex-col gap-2 sm:w-64">
      <ToolCard item={item} compact={compact} onPress={launch} />
      {error && (
        <p role="alert" className="break-words text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
