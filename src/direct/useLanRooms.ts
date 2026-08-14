import { useEffect, useState } from "react";
import {
  type DirectLanRoom,
  directLanRooms,
  directStopDiscovery,
} from "./bindings";
import { LAN_POLL_MS } from "./lan";

/**
 * The rooms being announced on this network, kept fresh while the caller is
 * mounted.
 *
 * Polled rather than subscribed to, because beacons arrive at the Rust side
 * whenever their hosts send them and the plugin emits no events. The first
 * answer binds the listening socket and is usually empty, which is not an error
 * and not worth showing as one: the next answer, two seconds later, has the
 * rooms in it.
 *
 * Listening stops on unmount, so a client that has wandered off the page is not
 * holding the beacon port open against the next coilbox on this machine.
 */
export function useLanRooms(): {
  rooms: DirectLanRoom[];
  /** Why this client cannot listen at all, or null. Binding the beacon port is
   *  the only way this fails, and a page that says nothing about it looks like a
   *  network with no rooms on it. */
  error: string | null;
} {
  const [rooms, setRooms] = useState<DirectLanRoom[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const poll = () => {
      directLanRooms({})
        .then((r) => {
          if (!live) return;
          setRooms(r.rooms);
          setError(null);
        })
        .catch((e) => {
          if (!live) return;
          setError(e instanceof Error ? e.message : String(e));
        });
    };
    poll();
    const timer = setInterval(poll, LAN_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
      directStopDiscovery({}).catch(() => {});
    };
  }, []);

  return { rooms, error };
}
