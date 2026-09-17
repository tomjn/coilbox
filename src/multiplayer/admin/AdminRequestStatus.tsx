import { Loader2, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { AdminReply } from "../bindings";
import type { AdminRequestState } from "./adminRequest";

/**
 * Where a Server admin request has got to, shown the same way by every tool
 * (issue #2773).
 *
 * A refusal and a request that never left are alerts, because the action did
 * not happen. Silence is not an alert: for several commands it is the answer,
 * so the tool supplies the words through `unanswered`.
 *
 * The `role="status"` container stays mounted while idle, as in `SaveStatus`,
 * because a live region only reliably announces text added to one already in
 * the page.
 */
export function AdminRequestStatus({
  state,
  sending = "Waiting for the server…",
  unanswered = "The server did not answer.",
  children,
}: {
  state: AdminRequestState;
  /**
   * What "still going" says for this command. `FINDIP` has no end marker
   * and always waits out the full timeout, so it overrides this to say so
   * rather than leave the default wording looking stuck.
   */
  sending?: string;
  /** What silence means for this command. */
  unanswered?: string;
  /** How this tool shows its answer. Without it, an answer reads "Done." */
  children?: (reply: AdminReply) => ReactNode;
}) {
  if (state.status === "refused" || state.status === "failed") {
    return (
      <Alert variant="destructive">
        <TriangleAlert />
        <AlertTitle>
          {state.status === "refused"
            ? "The server refused"
            : "Not sent to the server"}
        </AlertTitle>
        <AlertDescription>
          {state.status === "refused" ? state.reason : state.error}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div
      role="status"
      className={
        state.status === "idle"
          ? "sr-only"
          : "flex flex-col gap-2 text-sm text-muted-foreground"
      }
    >
      {state.status === "sending" && (
        <span className="flex items-center gap-1.5">
          <Loader2 className="size-3.5 shrink-0 motion-safe:animate-spin" />
          {sending}
        </span>
      )}
      {state.status === "unanswered" && <span>{unanswered}</span>}
      {state.status === "answered" &&
        (children ? children(state.reply) : <span>Done.</span>)}
    </div>
  );
}
