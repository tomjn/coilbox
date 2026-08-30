import { recordHostingRoute } from "@/direct/hostingRoute";
import { mpLeaveBattle } from "../bindings";

/**
 * Leave the battle this connection is in, and forget the route it took.
 *
 * The route is a module singleton with no battle in it, so anything that reads
 * it after the battle has gone is reading a sentence about a battle this client
 * is no longer in. Issue #2097 is what that cost: the in-game pill called a
 * later skirmish relayed and offered to end it for everybody. Dropping the
 * route here is not what fixed that, and it is not enough to fix it on its own,
 * because a reader can still ask on the way out of a battle nobody left
 * deliberately. It is the half that stops the record outliving the thing it
 * describes in the ordinary case, which is somebody pressing Leave.
 *
 * Every way out of a battle that coilbox itself starts comes through here, so
 * this is the one place that has to say so. Being kicked, or the host closing
 * the battle, does not: those arrive as lobby state rather than as an action,
 * and a reader who cannot tell a stale route from a live one is why nothing
 * downstream reads this without asking which game it is about.
 *
 * Dropped after the leave lands rather than before it, which is the opposite of
 * what the hosting forms do with the same record. They drop it first so a host
 * that fails leaves nothing behind. Here the failure is the other way round: a
 * leave that did not happen leaves this client sitting in its own relayed
 * battle, and a host who then presses Start would launch a game nothing knows
 * is relayed, which is a missing warning on a button that ends everybody's
 * game.
 */
export function leaveBattle(serverKey: string) {
  return mpLeaveBattle({ serverKey }).then((answer) => {
    recordHostingRoute(null);
    return answer;
  });
}
