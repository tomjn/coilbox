import { Trans } from "@lingui/react/macro";
import type { MemberRow } from "./config";

/**
 * Who is in an Open Annihilation battle (issue #4947), by name. Seats, teams and
 * readiness are set in OA's own room, so the lobby's table of them is not drawn.
 */
export function OaPlayerList({ rows }: { rows: MemberRow[] }) {
  return (
    <ul className="flex min-h-24 flex-col gap-1 overflow-y-auto rounded-lg border border-border/50 bg-card p-3 text-sm">
      {rows
        .filter((r) => r.kind === "human")
        .map((r) => (
          <li key={r.name} className="flex items-center gap-2">
            <span className="break-words font-medium">{r.name}</span>
            {r.host && (
              <span className="text-xs text-muted-foreground">
                <Trans>Host</Trans>
              </span>
            )}
            {r.self && (
              <span className="text-xs text-muted-foreground">
                <Trans>You</Trans>
              </span>
            )}
          </li>
        ))}
    </ul>
  );
}
