import { Check, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  type MapLoad,
  mapLoadFailed,
  mapLoading,
  mapLoadRows,
  type StageState,
} from "./mapLoad";

/** How long the finished list stays up before it goes, so the last tick is
 *  seen rather than blinked away. A choice, not a measurement. */
const LINGER_MS = 1200;

function StageIcon({ state }: { state: StageState }) {
  if (state === "loading") {
    return (
      <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
    );
  }
  if (state === "failed") {
    return <X className="size-3 shrink-0 text-destructive" />;
  }
  return <Check className="size-3 shrink-0 text-emerald-400" />;
}

/**
 * What the scene is still reading, floating over it while it fills in.
 *
 * One line a stage, each with a spinner, a tick or a cross, and the count of
 * models as they stand up. Goes once everything has landed, and stays while
 * anything has failed, because a failed read is something to act on.
 */
export function MapLoadIndicator({ load }: { load: MapLoad }) {
  const rows = mapLoadRows(load);
  const busy = mapLoading(load);
  const failed = mapLoadFailed(load);
  const [shown, setShown] = useState(true);

  useEffect(() => {
    if (busy || failed) {
      setShown(true);
      return;
    }
    const timer = setTimeout(() => setShown(false), LINGER_MS);
    return () => clearTimeout(timer);
  }, [busy, failed]);

  if (!shown || rows.length === 0) return null;

  return (
    <ul
      aria-live="polite"
      aria-label="Map loading"
      className="w-fit rounded bg-card/80 px-2 py-1.5 text-left text-[11px] text-foreground backdrop-blur"
    >
      {rows.map((row) => (
        <li key={row.key} className="flex items-center gap-1.5">
          <StageIcon state={row.state} />
          <span>{row.label}</span>
          {row.detail && (
            <span className="font-mono text-muted-foreground">
              {row.detail}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
