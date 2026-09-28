import { Button } from "@picoframe/frame";
import { RotateCw } from "lucide-react";

/**
 * What a screen shows when a unit model read failed, and a way to read it again
 * (issue #1916).
 *
 * `error` is the read's own reason, such as the time limit running out. Without
 * one the read came back with no model, and `fallback` is the screen's own
 * sentence for that.
 */
export function ModelReadFailed({
  error,
  fallback,
  onRetry,
}: {
  error: string | null;
  fallback: string;
  onRetry: () => void;
}) {
  return (
    <span className="inline-flex flex-wrap items-center justify-center gap-2">
      <span>{error ? `Could not read this model: ${error}.` : fallback}</span>
      <Button size="sm" variant="outline" className="gap-1.5" onClick={onRetry}>
        <RotateCw className="size-3.5" /> Try again
      </Button>
    </span>
  );
}
