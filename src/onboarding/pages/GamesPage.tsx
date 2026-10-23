import { SuggestionsList } from "@/content/pages/components/SuggestionsList";
import { useWriteRoot } from "@/downloads/config";
import { useTrackWizardDownload, useWizardGames } from "../wizardContexts";

/**
 * The games the run's decision offers, as `GetStartedCard` shows them. A
 * download goes on the app-wide queue, so it carries on after the wizard
 * closes, and the wizard follows it in its pill and on the Done page. The
 * wizard title is the heading, and the app behind is inert, so the list draws
 * no heading of its own and no link to settings. Continue and Skip both move on
 * without a choice to save.
 */
export default function GamesPage() {
  const games = useWizardGames();
  const gamesRoot = useWriteRoot("games");
  const track = useTrackWizardDownload();

  return (
    <SuggestionsList
      kind="game"
      centred
      heading={null}
      folderLink={false}
      items={games}
      writeRoot={gamesRoot}
      onQueued={track}
    />
  );
}
