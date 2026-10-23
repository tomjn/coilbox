import { useLingui } from "@lingui/react/macro";
import { cn } from "@picoframe/frame";
import { SuggestionsList } from "@/content/pages/components/SuggestionsList";
import { useWriteRoot } from "@/downloads/config";
import { getGameMatcher } from "@/profile/profile";
import { WIZARD_TITLE_ID } from "../ids";
import { useTrackWizardDownload, useWizardGames } from "../wizardContexts";

/**
 * The games the run's decision offers, as `GetStartedCard` shows them. A
 * download goes on the app-wide queue, so it carries on after the wizard
 * closes, and the wizard follows it in its pill and on the Done page. The app
 * behind is inert, so the list draws no link to settings. Continue and Skip
 * both move on without a choice to save.
 *
 * The page draws the wizard title itself, because it depends on the profile's
 * game filter, the same test the games decision uses. With no filter the list
 * is the catalog's featured games, and the title says so, so a player does not
 * take the list for every game coilbox runs.
 */
export default function GamesPage() {
  const { t } = useLingui();
  const games = useWizardGames();
  const gamesRoot = useWriteRoot("games");
  const track = useTrackWizardDownload();
  const featured = getGameMatcher() === null;

  return (
    <>
      <h2
        id={WIZARD_TITLE_ID}
        className={cn(
          "text-2xl font-semibold tracking-tight",
          featured ? "mb-1" : "mb-5",
        )}
      >
        {featured ? t`Featured games` : t`Download a game`}
      </h2>
      {featured && (
        <p className="mb-5 text-sm text-muted-foreground">
          {t`Coilbox runs other games too. Find them in Games after setup.`}
        </p>
      )}
      <SuggestionsList
        kind="game"
        centred
        heading={null}
        folderLink={false}
        items={games}
        writeRoot={gamesRoot}
        onQueued={track}
      />
    </>
  );
}
