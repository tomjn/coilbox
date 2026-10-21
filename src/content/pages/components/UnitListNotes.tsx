import { plural } from "@lingui/core/macro";
import { useLingui as useLocale } from "@lingui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { UnitSource } from "../../replayBuildOrders";
import {
  misfits,
  type OrderFit,
  storedListSentence,
} from "../../replayUnitDefs";

/**
 * Says that units are named from a list kept for this replay, where the list
 * came from and when (#1176). Nothing for any other source: each section words
 * those itself, because what it loses without a list differs.
 *
 * `subject` is what the section reads from the list, such as "Costs and kinds".
 */
export function StoredListNote({
  source,
  subject,
}: {
  source: UnitSource | null;
  subject?: string;
}) {
  if (source?.kind !== "stored") return null;
  return (
    <p className="text-xs text-muted-foreground">
      {storedListSentence(source.list.link, subject)}
    </p>
  );
}

/**
 * Warns when a replay's build orders do not fit the unit list they are being
 * named from (#3847). Nothing when every order fits. One line, because it
 * changes what the reader should believe. Why it happens is in
 * [`UnitListHelp`].
 */
export function OrderFitNote({ fit }: { fit: OrderFit }) {
  useLocale();
  const wrong = misfits(fit);
  if (wrong === 0) return null;
  const orderCount = plural(fit.orders, {
    one: "# build order",
    other: "# build orders",
  });
  return (
    <p className="text-xs text-amber-600 dark:text-amber-400">
      {plural(wrong, {
        one: `# of ${orderCount} does not fit this unit list, so names and costs may be wrong.`,
        other: `# of ${orderCount} do not fit this unit list, so names and costs may be wrong.`,
      })}
    </p>
  );
}

/**
 * The explanation of where unit names come from, for a section's help
 * popover: what a kept list is, why one from a loose folder is weaker, and
 * what it means for orders not to fit a list.
 */
export function UnitListHelp({ fit }: { fit?: OrderFit | null }) {
  const { t } = useLingui();
  const reasons = fit
    ? [
        fit.placedMobile > 0 &&
          plural(fit.placedMobile, {
            one: "# placed order names a unit that moves",
            other: "# placed orders name a unit that moves",
          }),
        fit.queuedStatic > 0 &&
          plural(fit.queuedStatic, {
            one: "# factory order names a unit that does not",
            other: "# factory orders name a unit that does not",
          }),
        fit.outOfRange > 0 &&
          plural(fit.outOfRange, {
            one: "# order names an id past the end of the list",
            other: "# orders name an id past the end of the list",
          }),
      ].filter((reason): reason is string => Boolean(reason))
    : [];
  const reasonList = reasons.join(", ");
  return (
    <>
      <p>
        <Trans>
          A replay names a unit by a number that only means something in the
          build of the game it was played on. Coilbox keeps the unit list a
          replay was read against, so the replay still names its units after the
          game is updated or removed.
        </Trans>
      </p>
      <p>
        <Trans>
          A list read from a loose game folder is what the folder held that day.
          A folder can change under the same name, and a packaged archive
          cannot. Analysing a replay records the list the engine itself used,
          which is the most reliable of the three.
        </Trans>
      </p>
      <p>
        <Trans>
          The installed game is read with the match's own mod options, teams and
          AIs, because a game's unit list can change with them. With the right
          list, a placed order names a building and a factory order names a unit
          that moves. A list can still be the wrong one, for a build that is not
          the match's or a unit that a map adds, and then some orders do not
          fit.
        </Trans>
        {reasons.length > 0 && <> {t`Here ${reasonList}.`}</>}
      </p>
    </>
  );
}
