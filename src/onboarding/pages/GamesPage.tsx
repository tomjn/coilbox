import { useLingui } from "@lingui/react/macro";
import { SuggestionsList } from "@/content/pages/components/SuggestionsList";
import { useWriteRoot } from "@/downloads/config";
import { useWizardGames } from "../OnboardingProvider";

/**
 * The games the run's decision offers, as `GetStartedCard` shows them. A
 * download goes on the app-wide queue, so it carries on after the wizard
 * closes. Continue and Skip both move on without a choice to save.
 */
export default function GamesPage() {
  const { t } = useLingui();
  const games = useWizardGames();
  const gamesRoot = useWriteRoot("games");

  return (
    <SuggestionsList
      kind="game"
      heading={t`Games`}
      items={games}
      writeRoot={gamesRoot}
    />
  );
}
