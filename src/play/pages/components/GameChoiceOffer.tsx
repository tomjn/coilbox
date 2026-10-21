import { Plural, Trans, useLingui } from "@lingui/react/macro";
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
  const { t } = useLingui();
  const nounText = noun === "warpath" ? t`warpath` : t`conquest`;
  const pinnedName = offer.kind === "continue" ? offer.pinnedName : "";
  const currentName = offer.kind === "upgrade" ? offer.current.name : "";
  const newerName = offer.kind === "choose" ? "" : offer.newer.name;
  return (
    <div className="flex flex-col gap-2 text-sm">
      {offer.kind === "choose" && (
        <>
          <p>
            <Trans>
              This {nounText} does not say which game it was started on, and{" "}
              <Plural
                value={offer.candidates.length}
                one="# installed game"
                other="# installed games"
              />{" "}
              could be it. Pick the one to play it on. The {nounText} remembers
              your answer.
            </Trans>
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
            <Trans>
              This {nounText} was started on{" "}
              <span className="font-medium">{pinnedName}</span>, which is not
              installed. Another version of that game is installed. Continue on{" "}
              <span className="font-medium">{newerName}</span>?
            </Trans>
          </p>
          <Button disabled={busy} onClick={() => onChoose(offer.newer.name)}>
            <Trans>Continue on {newerName}</Trans>
          </Button>
        </>
      )}
      {offer.kind === "upgrade" && (
        <>
          <p>
            <Trans>
              This {nounText} is on{" "}
              <span className="font-medium">{currentName}</span>.{" "}
              <span className="font-medium">{newerName}</span> is now installed.
              Move the {nounText} to it?
            </Trans>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => onChoose(offer.newer.name)}>
              <Trans>Move to {newerName}</Trans>
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => onDecline(offer.newer.name)}
            >
              <Trans>Stay on {currentName}</Trans>
            </Button>
          </div>
        </>
      )}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
