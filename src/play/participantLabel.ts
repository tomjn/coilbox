import { useLingui } from "@lingui/react/macro";
import type { Participant } from "./participants";

/**
 * What a participant is called on screen. A participant's `name` is the stored
 * name: it goes into the start script as `myPlayerName` and the AI's name, is
 * matched against replay results in `detect.ts` and `aiBonusSuggestion.ts`, and
 * is saved in drafts. So the default names stay "You" and "AI 1" in every
 * language, and only what is drawn is translated.
 *
 * The "you" row is always called You, as its row in the participants table is.
 * An AI named by the setup's own numbering ("AI 1", "AI 2") takes the word AI
 * from the catalog. Any other name is shown as it is stored.
 */
export function participantLabel(
  p: Pick<Participant, "kind" | "name">,
  words: { you: string; ai: string },
): string {
  if (p.kind === "you") return words.you;
  const numbered = /^AI (\d+)$/.exec(p.name);
  return numbered ? `${words.ai} ${numbered[1]}` : p.name;
}

/** `participantLabel` in the app's language. */
export function useParticipantLabel(): (
  p: Pick<Participant, "kind" | "name">,
) => string {
  const { t } = useLingui();
  const words = { you: t`You`, ai: t`AI` };
  return (p) => participantLabel(p, words);
}
