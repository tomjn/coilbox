import { type LimitReadiness, noLimitMessage } from "../../unitLimit";

/**
 * The briefing's note for a run with no unit limit (issue #3473). A run saved
 * before this check keeps launching, and this says why every unit is available.
 */
export function UnitLimitNote({
  limit,
  startUnit,
  gameName,
}: {
  limit: LimitReadiness;
  startUnit?: string;
  gameName: string;
}) {
  if (limit.kind !== "ready" || limit.limit.kind !== "none") return null;
  return (
    <p className="text-xs text-muted-foreground">
      {noLimitMessage(limit.limit.reason, startUnit, gameName)}
    </p>
  );
}
