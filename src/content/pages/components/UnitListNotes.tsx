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

function count(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/**
 * Says when a replay's build orders do not fit the unit list they are being
 * named from (#3847). Nothing when every order fits.
 */
export function OrderFitNote({ fit }: { fit: OrderFit }) {
  const wrong = misfits(fit);
  if (wrong === 0) return null;
  const reasons = [
    fit.placedMobile > 0 &&
      `${count(fit.placedMobile, "placed order names", "placed orders name")} a unit that moves`,
    fit.queuedStatic > 0 &&
      `${count(fit.queuedStatic, "factory order names", "factory orders name")} a unit that does not`,
    fit.outOfRange > 0 &&
      `${count(fit.outOfRange, "order names", "orders name")} an id past the end of the list`,
  ].filter((reason): reason is string => Boolean(reason));
  return (
    <p className="text-xs text-amber-600 dark:text-amber-400">
      {wrong.toLocaleString()} of{" "}
      {count(fit.orders, "build order", "build orders")}{" "}
      {wrong === 1 ? "does" : "do"} not fit this unit list: {reasons.join(", ")}
      . The list is probably not the one this match was played with, so names
      and costs may be wrong. A game's unit list can change with the match's mod
      options and AIs, and analysing the replay records the list the engine
      really used.
    </p>
  );
}
