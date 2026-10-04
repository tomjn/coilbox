import { useCallback, useEffect, useRef, useState } from "react";
import {
  lookupTag,
  type OptionEdit,
  type PendingMap,
  reconcilePending,
} from "./battleOptions";
import { AUTOHOST_COMMAND_GAP_MS } from "./tweakDelivery";

/** How long to wait for the server to echo an edit before reverting the control. */
const ECHO_TIMEOUT_MS = 8000;

/** Coalesce rapid edits to one option (spinner auto-repeat, per-keystroke typing)
 *  into a single wire send so the autohost's flood protection doesn't ban us. The
 *  trailing value wins; the optimistic control still updates on every change. */
const SEND_DEBOUNCE_MS = 400;

/**
 * Owns the optimistic-pending state for battle option edits. On `setOption` it
 * records the target value (and the confirmed value at that instant) immediately,
 * then debounces the wire send (see `SEND_DEBOUNCE_MS`) so a number spinner's
 * auto-repeat or per-keystroke typing coalesces to one command instead of flooding
 * the autohost. The 8s echo-revert timer starts only once the value is actually
 * sent. Pending entries clear when the server echoes the change into `scriptTags`
 * (confirmed value moves off `prev`) or when the echo timer fires (covers rejected
 * / insufficient-privilege edits — the only revert signal on the founder path,
 * which has no per-tag reject reply).
 *
 * `send(tagKey, spadsName, value)` performs the actual dispatch (founder
 * `mpSetScriptTags` vs autohost `!bSet`); this hook is agnostic to which.
 *
 * `setOptions` is the same for many edits at once (a reset). It is not
 * debounced, since a click is one decision and not a stream, and it hands the
 * whole set to `sendMany` in one call so the caller can batch or pace it
 * rather than fire one command per option. A run through an autohost sends one
 * option every `AUTOHOST_COMMAND_GAP_MS`, so each edit's echo wait is lengthened
 * by its place in the run when `paced`, and a later option does not snap back
 * while still queued.
 */
export function useBattleOptions(
  scriptTags: Record<string, string>,
  send: (tagKey: string, spadsName: string, value: string) => void,
  sendMany?: (edits: OptionEdit[]) => void,
  paced = false,
) {
  const [pending, setPending] = useState<PendingMap>({});
  // Echo-revert timers (started once a value is sent) and the debounced-send
  // timers (one pending send per option key), cleared together per key.
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const sendTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const clearTimer = useCallback((lower: string) => {
    const t = timers.current[lower];
    if (t) {
      clearTimeout(t);
      delete timers.current[lower];
    }
    const s = sendTimers.current[lower];
    if (s) {
      clearTimeout(s);
      delete sendTimers.current[lower];
    }
  }, []);

  // Reconcile against server echoes whenever the confirmed tags change.
  useEffect(() => {
    setPending((prev) => {
      const next = reconcilePending(prev, scriptTags);
      for (const key of Object.keys(prev)) if (!next[key]) clearTimer(key);
      return next;
    });
  }, [scriptTags, clearTimer]);

  const setOption = useCallback(
    (tagKey: string, spadsName: string, value: string) => {
      const lower = tagKey.toLowerCase();
      const prev = lookupTag(scriptTags, tagKey) ?? "";
      // Optimistic control immediately; clear any in-flight send/echo for this key.
      setPending((p) => ({ ...p, [lower]: { target: value, prev } }));
      clearTimer(lower);
      // Debounce the wire send so spinner auto-repeat / per-keystroke typing
      // coalesces to one command (the trailing value wins).
      sendTimers.current[lower] = setTimeout(() => {
        delete sendTimers.current[lower];
        send(tagKey, spadsName, value);
        // Start the echo-revert timer only once the value is actually on the wire.
        timers.current[lower] = setTimeout(() => {
          setPending(({ [lower]: _dropped, ...rest }) => rest);
          delete timers.current[lower];
        }, ECHO_TIMEOUT_MS);
      }, SEND_DEBOUNCE_MS);
    },
    [scriptTags, send, clearTimer],
  );

  const setOptions = useCallback(
    (edits: OptionEdit[]) => {
      if (edits.length === 0 || !sendMany) return;
      const prevs = edits.map((e) => lookupTag(scriptTags, e.tagKey) ?? "");
      setPending((p) => {
        const next = { ...p };
        edits.forEach((e, i) => {
          next[e.tagKey.toLowerCase()] = { target: e.value, prev: prevs[i] };
        });
        return next;
      });
      edits.forEach((e, i) => {
        const lower = e.tagKey.toLowerCase();
        // Cancels a debounced send of an earlier edit to this option, which
        // would otherwise land after the reset and undo it.
        clearTimer(lower);
        timers.current[lower] = setTimeout(
          () => {
            setPending(({ [lower]: _dropped, ...rest }) => rest);
            delete timers.current[lower];
          },
          ECHO_TIMEOUT_MS + (paced ? i * AUTOHOST_COMMAND_GAP_MS : 0),
        );
      });
      sendMany(edits);
    },
    [scriptTags, sendMany, paced, clearTimer],
  );

  // Clear any outstanding timers on unmount (both echo-revert and debounced-send).
  useEffect(() => {
    const echo = timers.current;
    const sends = sendTimers.current;
    return () => {
      for (const t of Object.values(echo)) clearTimeout(t);
      for (const t of Object.values(sends)) clearTimeout(t);
    };
  }, []);

  return { pending, setOption, setOptions };
}
