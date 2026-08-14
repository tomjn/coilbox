import { type ReactNode, useEffect } from "react";
import { notify } from "@/notify/notify";
import { readHostedRoom, subscribeHostedRoom } from "./hostedRoom";
import { newPendingNames, waitingJoinNotice } from "./room";

/**
 * App-level: keeps one reading of the hosted room alive, and tells the host
 * when somebody starts waiting on them.
 *
 * The join prompt lives in the battle room, which is the right place for it and
 * the wrong place for it to be the only one: a host who has gone to Content to
 * install a map hears nothing, and the person waiting has a spinner and no idea
 * whether anybody is there (issue #1600). So the fact leaves the page it is
 * drawn on and goes through `notify`, which is already focus aware and puts an
 * OS banner up when the window is behind something else.
 *
 * Fired wherever the host is, the battle room included. The panel is only on
 * screen while that route is mounted *and* the window is in front, and a host
 * looking at their own room with the window buried is exactly the case this is
 * for. A toast next to a panel saying the same thing costs a second's reading.
 *
 * Renders its children and nothing else. The watcher is a plain subscription
 * rather than a hook on the store's value, so a reading every two seconds does
 * not re-render the application.
 */
export function HostedRoomProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    // A room outlives the frontend that started it, so ask once on the way up.
    // In dev that is every hot reload, and the answer is null for everybody who
    // is not hosting, which stops the clock before it starts.
    void readHostedRoom();

    let seen: string[] = [];
    return subscribeHostedRoom((room) => {
      const pending = room?.pending ?? [];
      const arrived = newPendingNames(seen, pending);
      seen = pending;
      if (arrived.length === 0) return;
      void notify({
        ...waitingJoinNotice(arrived),
        level: "info",
        to: "/battle",
      });
    });
  }, []);

  return <>{children}</>;
}
