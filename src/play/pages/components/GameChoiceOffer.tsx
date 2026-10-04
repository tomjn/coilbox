import { Button } from "@picoframe/frame";
import type { ReactNode } from "react";
import type { GameOffer } from "../../installedGames";

/**
 * The question a battle asks before it launches when it is not certain which
 * installed game the run uses (issue #3465). Every game is named in full, so a
 * wrong match is easy to see. `note` carries what the caller found out about the
 * move, such as units the new version lacks.
 */
export function GameChoiceOffer({
  offer,
  noun,
  busy,
  note,
  onChoose,
  onDecline,
}: {
  offer: GameOffer;
  /** What the player is playing, as the sentence names it. */
  noun: "warpath" | "conquest";
  busy: boolean;
  note?: ReactNode;
  /** Use this game, by its full name. */
  onChoose: (name: string) => void;
  /** Stay on the current version, and do not offer this newer one again. */
  onDecline: (declinedName: string) => void;
}) {
  return (
    <div
      className="flex flex-col gap-2 text-sm"
      role="group"
      aria-label="Which game to play"
    >
      {offer.kind === "choose" && (
        <>
          <p>
            This {noun} does not say which game it was started on, and{" "}
            {offer.candidates.length} installed games could be it. Pick the one
            to play it on. The {noun} remembers your answer.
          </p>
          <div className="flex flex-col gap-2">
            {offer.candidates.map((g) => (
              <Button
                key={g.name}
                variant="outline"
                disabled={busy}
                onClick={() => onChoose(g.name)}
              >
                {g.name}
              </Button>
            ))}
          </div>
        </>
      )}
      {offer.kind === "continue" && (
        <>
          <p>
            This {noun} was started on{" "}
            <span className="font-medium">{offer.pinnedName}</span>, which is
            not installed. Another version of that game is installed. Continue
            on <span className="font-medium">{offer.newer.name}</span>?
          </p>
          <Button disabled={busy} onClick={() => onChoose(offer.newer.name)}>
            Continue on {offer.newer.name}
          </Button>
        </>
      )}
      {offer.kind === "upgrade" && (
        <>
          <p>
            This {noun} is on{" "}
            <span className="font-medium">{offer.current.name}</span>.{" "}
            <span className="font-medium">{offer.newer.name}</span> is now
            installed. Move the {noun} to it?
          </p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => onChoose(offer.newer.name)}>
              Move to {offer.newer.name}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => onDecline(offer.newer.name)}
            >
              Stay on {offer.current.name}
            </Button>
          </div>
        </>
      )}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
