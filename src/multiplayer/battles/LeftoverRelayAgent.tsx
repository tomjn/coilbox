import { Button } from "@picoframe/frame";
import { useState } from "react";
import { mpAskLeftoverRelayToStop } from "../bindings";

/** What the relay agent did when it was asked to stop. */
export type StopOutcome = Awaited<
  ReturnType<typeof mpAskLeftoverRelayToStop>
>["outcome"];

/**
 * What to tell the host about what the relay agent did. Pure.
 *
 * The two that matter are `stopped` and `carrying`, and they are the two that
 * look identical from coilbox's side until the agent has answered. One is a
 * leftover from a crash with nothing on it. The other is a relay carrying a
 * match that other people are still playing, and the sentence has to say that
 * nothing was cut off, because the host has just pressed a button and is owed
 * an account of what it did.
 *
 * `noAnswer` used to claim the process was no longer the relay agent, on the
 * strength of a note nothing took. It cannot claim that any more, and it should
 * never have: a note is only read once the agent's own coilbox has closed, so
 * an untaken note is an inference. The proof is the lock the agent keeps on its
 * run file, and coilbox now reads that before it ever offers this panel, which
 * means a record naming a process number the OS handed on never reaches here
 * (issue #2078). What is left is the case that genuinely cannot be told apart,
 * and the sentence says so rather than guessing.
 */
export function stopOutcomeMessage(outcome: StopOutcome): string {
  switch (outcome) {
    case "stopped":
      return "It has stopped. Nothing was ever played through it, so nobody was cut off. Host the battle again.";
    case "carrying":
      return "It kept running, because a game is still being played through it. Nobody was cut off. It stops on its own once that game ends, and hosting will work again then.";
    case "noAnswer":
      return "Nothing read the note. coilbox cannot rule out that the process really is the relay agent, so it has changed nothing and hosting is still refused. Restarting this machine clears the record.";
    case "ours":
      return "It is carrying a battle this coilbox is hosting right now. Leave that battle before opening another one.";
    case "gone":
      return "It has already gone. Host the battle again.";
  }
}

/**
 * A relay agent left running by an earlier session, and the way out of it
 * (issue #2062).
 *
 * ## Why this asks rather than offering to end it
 *
 * The relay agent is a separate process so that it keeps carrying a game after
 * coilbox closes. Somebody who closed coilbox mid-match and opened it again is
 * therefore looking at a relay that every other player in that match is
 * connected through, and a leftover from a crash looks exactly the same from
 * here: a process id in a file. coilbox has no pipe to either, because you
 * cannot take over a process's pipes from a parent that did not start it.
 *
 * So the button does not end anything. It leaves the agent a note, and the
 * agent decides, on the one fact only it holds: a relay no player has ever been
 * heard through never carried a game and stops at once, and one that has
 * carried players keeps going. That is why pressing this cannot end somebody's
 * match, and why the wording never offers to clear a stale thing.
 */
export function LeftoverRelayAgent({
  pid,
  ours,
}: {
  /** The process the run file names, which is what the refusal quotes. */
  pid: number;
  /** Whether the agent is carrying a battle this coilbox is hosting. */
  ours: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const [outcome, setOutcome] = useState<StopOutcome | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  async function ask() {
    setAsking(true);
    setFailed(null);
    try {
      const { outcome } = await mpAskLeftoverRelayToStop({});
      setOutcome(outcome);
    } catch (err) {
      setFailed(
        err instanceof Error ? err.message : String(err ?? "it could not be"),
      );
    } finally {
      setAsking(false);
    }
  }

  // Its own battle rather than a leftover, which needs the opposite advice and
  // no button at all.
  if (ours) {
    return (
      <div className="flex flex-col gap-2 rounded-md border p-2 text-xs">
        <p>
          The relay agent running as process {pid} is carrying a battle this
          coilbox is hosting. Leave that battle before opening another one.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border p-2 text-xs">
      <p>
        A relay agent from an earlier session is still running as process {pid}.
        It may be carrying a game other people are still playing, so coilbox
        will not end it. Asking it to stop is safe: it stops only if no player
        has ever been heard through it.
      </p>
      {outcome ? (
        <p role="status">{stopOutcomeMessage(outcome)}</p>
      ) : (
        <Button
          type="button"
          variant="secondary"
          className="h-7 self-start px-2"
          disabled={asking}
          onClick={ask}
        >
          {asking ? "Asking it to stop…" : "Ask it to stop"}
        </Button>
      )}
      {failed && (
        <p role="alert">The relay agent could not be asked: {failed}</p>
      )}
    </div>
  );
}
