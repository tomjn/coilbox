import { useEffect, useRef, useState } from "react";
import {
  type DirectReachability,
  type DirectTransport,
  directClosePorts,
  directOpenPorts,
} from "./reachability";

/** One port to open, as the plugin takes it. */
export interface PortSpec {
  port: number;
  transport: DirectTransport;
  description: string;
}

/**
 * How long a changed set of ports settles before the router is asked about it.
 *
 * A port field is typed one digit at a time, and "8", "83", "830" and "8300" are
 * four different valid ports. Asking a router four times because somebody typed
 * a number is rude to their router and slow on their screen.
 */
const SETTLE_MS = 600;

/**
 * Keep a set of ports open on the host's router for as long as the caller wants
 * them.
 *
 * `ports` of `null` means off, and closes anything this opened. A changed list
 * closes the old set before opening the new one, which the Rust side does in one
 * step so there is no gap and no chance of two sets at once.
 *
 * Deliberately does not close on unmount. Ports outlive the form that asked for
 * them: the whole point is that they are still open once the host is in their
 * battle room. Whoever mounts this owns closing them, and for a room that is the
 * stop button.
 */
export function useReachablePorts(ports: PortSpec[] | null): {
  /** What the router and the internet said, or null before the first answer. */
  report: DirectReachability | null;
  /** A request is in flight. It takes a few seconds: an SSDP search that has to
   *  time out, two NAT-PMP addresses and a STUN round trip. */
  busy: boolean;
  /** The command itself failed, as opposed to the router refusing, which is a
   *  report and not an error. */
  error: string | null;
} {
  const [report, setReport] = useState<DirectReachability | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The list is rebuilt every render by the caller, so the effect keys on what
  // is in it rather than on its identity, and reads the list itself out of a ref
  // rather than out of a closure it would have to be a dependency of.
  const key = ports
    ? ports.map((p) => `${p.transport}:${p.port}`).join(",")
    : null;
  const latest = useRef(ports);
  latest.current = ports;

  useEffect(() => {
    let live = true;
    if (key === null) {
      setReport(null);
      setError(null);
      directClosePorts({}).catch(() => {});
      return;
    }
    const settle = setTimeout(() => {
      setBusy(true);
      setError(null);
      directOpenPorts({ ports: latest.current ?? [] })
        .then((r) => {
          if (live) setReport(r.reachability);
        })
        .catch((e) => {
          if (!live) return;
          setReport(null);
          setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (live) setBusy(false);
        });
    }, SETTLE_MS);
    return () => {
      live = false;
      clearTimeout(settle);
    };
  }, [key]);

  return { report, busy, error };
}
