import { Card } from "@/components/ui/card";
import { useWriteRoot } from "../../../downloads/config";
import { MapPacksBanner } from "../../../downloads/pages/components/MapPacksBanner";
import { useGetStartedOffer } from "../../getStartedOffer";
import { SuggestionsList } from "./SuggestionsList";

/**
 * Welcome-screen card offering curated game/map downloads once setup (content
 * folder + engine) is complete but the user still has no content. Self-hides
 * once every suggestion has been downloaded (issue #530: no manual dismiss).
 *
 * What it offers, and when that is known, is {@link useGetStartedOffer}'s. That
 * is a shared collector rather than this card's own working out, because the
 * home page has to know whether this card is offering maps before it can place
 * the suggested map card, and the two must not answer differently (issue #1109).
 * This file is the card.
 */
export function GetStartedCard() {
  const writeRoot = useWriteRoot();
  const { offer, installed, refresh } = useGetStartedOffer();

  if (!offer || !installed) return null;
  if (offer.games.length === 0 && offer.maps.length === 0) return null;

  return (
    <Card className="gap-4 rounded-lg border-border p-4 shadow-none">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">Get started</h2>
        <p className="text-xs text-muted-foreground">
          Download a game or map to start playing.
        </p>
      </div>

      {offer.games.length > 0 && (
        <SuggestionsList
          kind="game"
          heading="Games"
          items={offer.games}
          writeRoot={writeRoot}
          onComplete={refresh}
        />
      )}
      {offer.maps.length > 0 && (
        <>
          <SuggestionsList
            kind="map"
            heading="Maps"
            items={offer.maps}
            writeRoot={writeRoot}
            onComplete={refresh}
          />
          <MapPacksBanner
            installed={installed.maps}
            writePath={writeRoot.path}
          />
        </>
      )}
    </Card>
  );
}
