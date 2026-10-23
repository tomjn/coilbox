import { createContext, useContext } from "react";
import type { SuggestedGame } from "@/content/branding";
import type {
  EnqueueInput,
  QueueItem,
} from "@/downloads/DownloadQueueProvider";

/**
 * What `OnboardingProvider` hands the wizard's pages. Kept apart from the
 * provider, which imports the wizard and through it every page, so a page
 * reading these does not import the provider back.
 */

const NO_DOWNLOADS: QueueItem[] = [];
export const WizardDownloadsContext = createContext<QueueItem[]>(NO_DOWNLOADS);

/**
 * The downloads the wizard follows, for its pages to show: the background
 * engine and game, then any game the player started on the games page.
 */
export function useWizardDownloads(): QueueItem[] {
  return useContext(WizardDownloadsContext);
}

export const NO_GAMES: SuggestedGame[] = [];
export const WizardGamesContext = createContext<{
  games: SuggestedGame[];
  track(input: EnqueueInput): void;
}>({ games: NO_GAMES, track: () => {} });

/**
 * The games the games page offers: the `pick` decision's games as the plan
 * froze, and empty otherwise. Frozen with the plan, because a download started
 * from the page installs a game, which turns the live decision to `none` and
 * would empty the page under the player.
 */
export function useWizardGames(): SuggestedGame[] {
  return useContext(WizardGamesContext).games;
}

/** Adds a download the player started to the ones the wizard follows. */
export function useTrackWizardDownload(): (input: EnqueueInput) => void {
  return useContext(WizardGamesContext).track;
}
