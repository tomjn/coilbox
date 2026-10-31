import { useLingui } from "@lingui/react/macro";
import type { NavItem } from "@picoframe/plugin-sdk";
import { Channel } from "@tauri-apps/api/core";
import { useState } from "react";
import { describeError } from "@/i18n/uiError";
import { OpenAnnihilationIcon } from "../../multiplayer/OpenAnnihilationIcon";
import { useOpenAnnihilation } from "../../multiplayer/openAnnihilation";
import { type OaEvent, playOaLaunch } from "../../play/bindings";
import { getGameMatcher } from "../../profile/profile";
import { ToolCard } from "./ToolCards";

/**
 * The tool id the card is drawn, and given art, under. It is not a nav item, so
 * nothing else uses it, but a distribution's per-tool art settings key on it
 * like any other card's.
 */
export const OA_CARD_ID = "multiplayer.open-annihilation";

/** Where the card goes when Open Annihilation is not set up. */
export const CORE_PRIME_URL = "https://play.coreprime.net";

/**
 * A welcome card for Open Annihilation (issue #4945), in the Multiplayer group
 * beside the other cards.
 *
 * With the program path from #4943 set, pressing it starts OA on its own main
 * menu: `--skip-intro` and nothing else. Without one it opens Core Prime's page
 * in the browser, which `ToolCard` already does for an item with an `href`. The
 * two states are the card's label and action, with no explanation on the card.
 *
 * It is {@link ToolCard} with a synthetic nav item, so it has the same shell,
 * art, focus ring and external-link mark as the cards around it. The group
 * hands it `compact` for the same reason it hands it to them.
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
  if (getGameMatcher() !== null) return null;

  const launch = async () => {
    if (!program) return;
    setError(null);
    try {
      // One channel per call: a channel reused across commands stops delivering.
      await playOaLaunch({
        executable: program.path,
        args: ["--skip-intro"],
        runId: crypto.randomUUID(),
        onEvent: new Channel<OaEvent>(),
      });
    } catch (e) {
      setError(describeError(e));
    }
  };

  const item: NavItem = {
    id: OA_CARD_ID,
    label: program ? t`Play Open Annihilation` : t`Get Open Annihilation`,
    icon: OpenAnnihilationIcon,
    // Set only without a program: `ToolCard` opens it in the browser and marks
    // the card as external. With a program the card runs `launch` instead.
    href: program ? undefined : CORE_PRIME_URL,
  };

  return (
    <div className="flex w-full flex-col gap-2 sm:w-64">
      <ToolCard
        item={item}
        compact={compact}
        onPress={program ? launch : undefined}
      />
      {error && (
        <p role="alert" className="break-words text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
