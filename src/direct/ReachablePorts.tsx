import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { CopyButton } from "./CopyButton";
import {
  type DirectReachability,
  isReachabilityProblem,
  joinAddress,
  reachabilityAdvice,
  reachabilityHeadline,
} from "./reachability";
import { type PortSpec, useReachablePorts } from "./useReachablePorts";

/**
 * "Reachable over the internet": the toggle that asks the host's router to open
 * the ports, and the answer, in the place they asked.
 *
 * Off by default, in both places it appears. Ticking it opens a port on a home
 * router, which changes what the rest of the internet can reach, and that is not
 * a thing to do to somebody because they opened a form. The LAN case this
 * milestone exists for needs none of it, and the join approval toggle next to it
 * is off for the same reason and says so in its own words.
 *
 * The answer appears here rather than as a toast because failure is the normal
 * outcome and the way out of it is a set of instructions with two port numbers
 * in. A host who has just ticked a box is looking at the box.
 *
 * Ports are not closed when this unmounts. They outlive the form: the point is
 * that they are still open once the host is in their battle room. See
 * {@link useReachablePorts}.
 */
export function ReachablePorts({
  ports,
  help,
}: {
  /** The ports to open, or null to close whatever is open. The caller builds
   *  this from its own port fields, so a host who moves their room takes the
   *  mapping with them. */
  ports: PortSpec[] | null;
  /** What ticking this does, in the caller's own terms. The two host paths open
   *  a different number of ports for different reasons. */
  help: string;
}) {
  const [enabled, setEnabled] = useState(false);
  const net = useReachablePorts(enabled ? ports : null);

  return (
    <div className="flex flex-col gap-1.5">
      {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the Checkbox control (implicit label association) */}
      <label className="flex items-start gap-2 text-sm">
        <Checkbox
          checked={enabled}
          onCheckedChange={(checked) => setEnabled(checked === true)}
          className="mt-0.5"
        />
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">Reachable over the internet</span>
          <span className="text-xs text-muted-foreground">{help}</span>
        </span>
      </label>

      {enabled && (
        <Answer busy={net.busy} error={net.error} report={net.report} />
      )}
    </div>
  );
}

/** What the router and the internet said. Four outcomes, and the way out of the
 *  three that are not success. */
function Answer({
  busy,
  error,
  report,
}: {
  busy: boolean;
  error: string | null;
  report: DirectReachability | null;
}) {
  if (busy || (!report && !error)) {
    return (
      <p className="pl-6 text-xs text-muted-foreground">
        Asking your router… This takes a few seconds, and longer on a router
        that is going to say no.
      </p>
    );
  }
  if (error) {
    return (
      <p
        role="alert"
        className="ml-6 rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive"
      >
        {error}
      </p>
    );
  }
  if (!report) return null;

  const problem = isReachabilityProblem(report);
  const advice = reachabilityAdvice(report);
  const address = joinAddress(report);
  return (
    <div
      className={`ml-6 flex flex-col gap-1.5 rounded-md border p-2 text-xs ${
        problem
          ? "border-destructive/50 bg-destructive/10 text-destructive"
          : "border-border bg-muted/40 text-muted-foreground"
      }`}
    >
      <span className="font-medium">{reachabilityHeadline(report)}</span>
      {address && <CopyableAddress address={address} />}
      {advice && <span>{advice}</span>}
      {/* The router's own words, kept but not led with. They are the only thing
          that helps when the plain English above does not, and they are also
          the only thing a bug report can be written from. */}
      {report.problem && <span className="opacity-70">{report.problem}</span>}
    </div>
  );
}

/** The address to send a friend, and one press to put it on the clipboard. */
function CopyableAddress({ address }: { address: string }) {
  return (
    <span className="flex items-center gap-2">
      <code className="select-all rounded bg-background px-1.5 py-0.5 font-mono text-foreground">
        {address}
      </code>
      <CopyButton
        value={address}
        label={`Copy ${address}, the address somebody outside your network joins at`}
      >
        Copy
      </CopyButton>
    </span>
  );
}
