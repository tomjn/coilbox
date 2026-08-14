import { Button } from "@picoframe/frame";
import { DoorOpen } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { directAnswerJoin, directRoomStatus } from "./bindings";
import { pendingJoinsHeadline, ROOM_POLL_MS } from "./room";

/**
 * The people waiting on the host of a room this client is hosting, kept fresh
 * while the caller is mounted.
 *
 * Polled rather than subscribed to: the direct plugin emits no events, and the
 * command reads a struct out of the room task in this same process. `enabled` is
 * what stops every battle room on a real server from asking a plugin that has no
 * room in it.
 *
 * An answer is applied optimistically, so a name pressed on vanishes at once
 * rather than at the next tick. The room is the authority either way, and the
 * next poll puts back anything that did not take.
 */
export function usePendingJoins(enabled: boolean): {
  /** Names waiting on the host, oldest first. */
  pending: string[];
  answer: (username: string, allow: boolean) => void;
} {
  const [pending, setPending] = useState<string[]>([]);

  useEffect(() => {
    if (!enabled) {
      setPending([]);
      return;
    }
    let live = true;
    const poll = () => {
      directRoomStatus({})
        .then((r) => {
          if (live) setPending(r.room?.pending ?? []);
        })
        .catch(() => {});
    };
    poll();
    const timer = setInterval(poll, ROOM_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [enabled]);

  const answer = useCallback((username: string, allow: boolean) => {
    setPending((names) => names.filter((n) => n !== username));
    // No reason passed: the room's own words ("the host turned you away") are
    // what the person refused reads, and a free-text box here would be one more
    // thing to fill in while somebody waits.
    directAnswerJoin({ username, allow }).catch(() => {});
  }, []);

  return { pending, answer };
}

/**
 * The prompt a host answers when somebody is waiting to be let into their room.
 *
 * It lives in the battle room rather than on the Battles page because that is
 * where a host is looking: starting a room lands them here and this is where they
 * pick the map, the options and their own seat. A prompt on the page they left is
 * a prompt nobody reads, and a joiner waiting on it has nothing to look at but a
 * spinner.
 *
 * Renders nothing when nobody is waiting, so the ordinary battle room is
 * untouched and this is only ever an interruption when there is something to
 * interrupt for.
 */
export function PendingJoinsPanel({
  pending,
  onAnswer,
}: {
  pending: string[];
  onAnswer: (username: string, allow: boolean) => void;
}) {
  if (pending.length === 0) return null;
  return (
    <section
      aria-label="Joins waiting for you"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-amber-500/40 bg-amber-500/10 px-4 py-3"
    >
      <div className="flex items-center gap-2">
        <DoorOpen className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <span className="text-sm font-semibold">
          {pendingJoinsHeadline(pending.length)}
        </span>
      </div>
      {/* The name is in each button rather than beside them, so the thing a
          screen reader announces and the thing a mouse aims at are the same
          words, and a queue three deep has no ambiguous "Approve" in it. */}
      <ul className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        {pending.map((name) => (
          <li key={name} className="flex items-center gap-2">
            <Button size="sm" onClick={() => onAnswer(name, true)}>
              Approve {name}
            </Button>
            {/* Said in a tooltip rather than in the label, because the label is
                what a screen reader announces and "Reject bob" is the whole of
                what the button does. The sentence is what it costs. */}
            <Button
              size="sm"
              variant="secondary"
              title={`${name} cannot ask again while this battle is open.`}
              onClick={() => onAnswer(name, false)}
            >
              Reject {name}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
