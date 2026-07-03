import { useCallback, useEffect, useRef, useState } from "react";
import { lookupTag, type PendingMap, reconcilePending } from "./battleOptions";

/** How long to wait for the server to echo an edit before reverting the control. */
const ECHO_TIMEOUT_MS = 8000;

/**
 * Owns the optimistic-pending state for battle option edits. On `setOption` it
 * records the target value (and the confirmed value at that instant), fires the
 * wire send, and starts an 8s timer. Pending entries clear when the server echoes
 * the change into `scriptTags` (confirmed value moves off `prev`) or when the
 * timer fires (covers rejected / insufficient-privilege edits — the only revert
 * signal on the founder path, which has no per-tag reject reply).
 *
 * `send(tagKey, spadsName, value)` performs the actual dispatch (founder
 * `mpSetScriptTags` vs autohost `!bSet`); this hook is agnostic to which.
 */
export function useBattleOptions(
  scriptTags: Record<string, string>,
  send: (tagKey: string, spadsName: string, value: string) => void,
) {
  const [pending, setPending] = useState<PendingMap>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const clearTimer = (lower: string) => {
    const t = timers.current[lower];
    if (t) {
      clearTimeout(t);
      delete timers.current[lower];
    }
  };

  // Reconcile against server echoes whenever the confirmed tags change.
  useEffect(() => {
    setPending((prev) => {
      const next = reconcilePending(prev, scriptTags);
      for (const key of Object.keys(prev)) if (!next[key]) clearTimer(key);
      return next;
    });
  }, [scriptTags]);

  const setOption = useCallback(
    (tagKey: string, spadsName: string, value: string) => {
      const lower = tagKey.toLowerCase();
      const prev = lookupTag(scriptTags, tagKey) ?? "";
      setPending((p) => ({ ...p, [lower]: { target: value, prev } }));
      clearTimer(lower);
      timers.current[lower] = setTimeout(() => {
        setPending(({ [lower]: _dropped, ...rest }) => rest);
        delete timers.current[lower];
      }, ECHO_TIMEOUT_MS);
      send(tagKey, spadsName, value);
    },
    [scriptTags, send],
  );

  // Clear any outstanding timers on unmount.
  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const t of Object.values(map)) clearTimeout(t);
    };
  }, []);

  return { pending, setOption };
}
