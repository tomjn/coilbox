import {
  ChevronRight,
  CircleCheck,
  CircleX,
  Info,
  Loader2,
} from "lucide-react";
import { Fragment, type ReactNode, useEffect, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { CopyButton } from "./CopyButton";
import {
  type DirectReachability,
  type DirectTransport,
  isReachabilityProblem,
  joinAddress,
  methodLabel,
  reachabilityState,
} from "./reachability";
import { type PortSpec, useReachablePorts } from "./useReachablePorts";

/**
 * "Open ports on my router": the toggle that asks the host's router to open the
 * ports, and the answer, in the place they asked.
 *
 * Named for what it does. It used to be "Reachable over the internet", which
 * read as though unticking it kept a battle off the internet. It never did. An
 * unticked host is still advertised at their own address, with nobody having
 * checked that anybody can reach it.
 *
 * Off by default in a LAN room, which needs none of it, and the join approval
 * toggle next to it is off for the same reason. The lobby hosting form has no
 * toggle at all and checks through `always`, because a battle on a lobby server
 * only works if the internet can reach the game port, and without the check the
 * relay is never reached either. That form hands the port back when it is
 * closed without hosting, so opening it to look costs nothing.
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
  onReport,
  always = false,
  relayWillCarry = false,
  onCheckingChange,
}: {
  /** The ports to open, or null to close whatever is open. The caller builds
   *  this from its own port fields, so a host who moves their room takes the
   *  mapping with them. */
  ports: PortSpec[] | null;
  /** What ticking this does, in the caller's own terms. The two host paths open
   *  a different number of ports for different reasons. With `always` there is
   *  nothing to tick, so it is only for a note the card cannot give. */
  help?: string;
  /** Hear what the router and the internet said, so the form above can pick a
   *  hosting route from it (issue #2020). Null while this is switched off,
   *  which is a route decision in its own right: nothing was measured.
   *
   *  Must keep the same identity between renders, or this notifies on every
   *  one. A `useState` setter is the intended argument. */
  onReport?: (report: DirectReachability | null) => void;
  /** Check without asking, and show no toggle. For a form with no reason not
   *  to check, which is the lobby hosting form: a battle on a lobby server only
   *  works if the internet can reach the game port, and the check is the only
   *  evidence the route ladder has. Left out, the toggle is there and starts
   *  off. */
  always?: boolean;
  /** The battle goes through the server's relay when nothing opens, so a
   *  refusal is not a fault to draw in red. The ways to fix it are still shown,
   *  because a direct game has the better ping. */
  relayWillCarry?: boolean;
  /** Hear whether the check is still running, so the form can hold its submit
   *  button until there is an answer to pick a route from. Must keep the same
   *  identity between renders, like `onReport`. */
  onCheckingChange?: (checking: boolean) => void;
}) {
  const [ticked, setTicked] = useState(false);
  const enabled = always || ticked;
  const net = useReachablePorts(enabled ? ports : null);

  useEffect(() => {
    onReport?.(net.report);
  }, [net.report, onReport]);

  // The same test the answer below uses to show it is still looking, so the
  // form and the panel cannot disagree about whether there is an answer yet.
  const checking =
    enabled && ports !== null && (net.busy || (!net.report && !net.error));
  useEffect(() => {
    onCheckingChange?.(checking);
  }, [checking, onCheckingChange]);

  // Nothing to answer with no ports asked for, which is a form that has decided
  // it does not need the router at all.
  const answer = enabled && ports !== null && (
    <Answer
      busy={net.busy}
      error={net.error}
      report={net.report}
      relayWillCarry={relayWillCarry}
      asked={ports}
    />
  );

  if (always) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Game port</span>
        {help && <span className="text-xs text-muted-foreground">{help}</span>}
        {answer}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the Checkbox control (implicit label association) */}
      <label className="flex items-start gap-2 text-sm">
        <Checkbox
          checked={ticked}
          onCheckedChange={(checked) => setTicked(checked === true)}
          className="mt-0.5"
        />
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">Open ports on my router</span>
          <span className="text-xs text-muted-foreground">{help}</span>
        </span>
      </label>

      {/* Indented under the checkbox's words, which are what it answers. */}
      {answer && <div className="pl-6">{answer}</div>}
    </div>
  );
}

/**
 * What the check found, as one card: a verdict that reads at a glance, the one
 * thing to do about it when there is something, and the router's own reply
 * folded away for whoever is writing a bug report.
 *
 * The verdict never names a router as the cause of a refusal. Coilbox saw two
 * requests go unanswered, which is also what a machine with no router at all
 * looks like (issue #2114). A machine on its own public address is told it can
 * be reached without a word about routers, because it has none (issue #2054).
 */
function Answer({
  busy,
  error,
  report,
  relayWillCarry,
  asked,
}: {
  busy: boolean;
  error: string | null;
  report: DirectReachability | null;
  relayWillCarry: boolean;
  /** The ports being asked for, named while the check runs. */
  asked: PortSpec[] | null;
}) {
  if (busy || (!report && !error)) {
    return (
      <Card tone="quiet" role="status">
        <Verdict
          icon={
            <Loader2 className="size-3.5 shrink-0 motion-safe:animate-spin" />
          }
        >
          Asking your router to open{" "}
          {asked && asked.length > 0 ? <Ports ports={asked} /> : "the ports"}…
        </Verdict>
      </Card>
    );
  }
  if (error) {
    return (
      <Card tone="alarm" role="alert">
        <Verdict icon={<CircleX className="size-3.5 shrink-0" />}>
          Could not check your router
        </Verdict>
        <Details lines={[error]} />
      </Card>
    );
  }
  if (!report) return null;

  const problem = isReachabilityProblem(report);
  // Still a problem, and still explained, but not a fault to draw in red when
  // the relay is about to carry the battle anyway.
  const alarming = problem && !relayWillCarry;
  const address = joinAddress(report);
  const said = readout(report);
  // The router's own words, only under an outcome they explain. A host already
  // on the internet has "no UPnP gateway answered" against their name because
  // there is no gateway to answer, and that reads as a fault they have not got.
  const lines = [
    ...said.more,
    ...(problem && report.problem ? [report.problem] : []),
  ];
  const icon = !problem ? (
    <CircleCheck className="size-3.5 shrink-0 text-emerald-500" />
  ) : alarming ? (
    <CircleX className="size-3.5 shrink-0" />
  ) : (
    <Info className="size-3.5 shrink-0" />
  );

  return (
    <Card tone={alarming ? "alarm" : "quiet"}>
      <Verdict icon={icon} strong={!alarming}>
        {said.title}
      </Verdict>
      {said.note && <span className="pl-5">{said.note}</span>}
      {address && (
        <span className="pl-5">
          <CopyableAddress address={address} />
        </span>
      )}
      {said.fix && <span className="pl-5">{said.fix}</span>}
      <Details lines={lines} />
    </Card>
  );
}

/** What one outcome says: the verdict, a line under it, what to do, and what
 *  goes behind Details. Pure. */
function readout(report: DirectReachability): {
  title: ReactNode;
  note?: ReactNode;
  fix?: ReactNode;
  more: string[];
} {
  const lan = report.lanAddress;
  switch (reachabilityState(report)) {
    case "direct":
      return {
        title: "Players can reach you",
        note: "This machine is on the internet under its own address.",
        more: [],
      };
    case "open":
      return {
        title: "Players can reach you",
        note: (
          <>
            {methodLabel(report.method)} opened <Ports ports={report.ports} />.
          </>
        ),
        more: [],
      };
    case "noAddress":
      return {
        title: (
          <>
            <Ports ports={report.ports} /> {isOrAre(report.ports)} open
          </>
        ),
        note: "No server would say what your public address is.",
        fix: lan ? (
          <>
            Find it another way, or on this network use <Code>{lan}</Code>.
          </>
        ) : (
          "Find it another way to share it."
        ),
        more: [],
      };
    case "doubleNat":
      return {
        title: "Your internet provider blocks the way in",
        note: (
          <>
            Your router opened <Ports ports={report.ports} />, but your
            provider's own NAT sits in front of it.
          </>
        ),
        fix: "No router setting fixes this. Ask your provider for a public address.",
        more: report.routerAddress
          ? [
              `Your router's own address is ${report.routerAddress}, which the internet does not route to.`,
            ]
          : [],
      };
    case "refused":
      return {
        title: (
          <>
            <Ports ports={report.wanted} />{" "}
            {report.wanted.length > 1 ? "aren't" : "isn't"} open
          </>
        ),
        fix: (
          <>
            Turn on UPnP or NAT-PMP in your router, or forward{" "}
            <Ports ports={report.wanted} />
            {lan ? (
              <>
                {" "}
                to <Code>{lan}</Code>
              </>
            ) : (
              " by hand"
            )}
            .
          </>
        ),
        // Folded away rather than said to everybody. Coilbox is a desktop app
        // and a cloud server is a rare place to run it, but its report reads
        // exactly like a home router with UPnP off (issue #2114).
        more: [
          "On a cloud server there is no router, so open the port in the provider's firewall instead.",
        ],
      };
  }
}

function isOrAre(ports: { port: number }[]): string {
  return ports.length > 1 ? "are" : "is";
}

/** The card every state sits in, looking included, so the panel keeps its shape
 *  from the moment it starts to the moment it has an answer. */
function Card({
  tone,
  role,
  children,
}: {
  tone: "quiet" | "alarm";
  role?: "status" | "alert";
  children: ReactNode;
}) {
  return (
    <div
      role={role}
      className={cn(
        "flex flex-col gap-1.5 rounded-md border p-2.5 text-xs",
        tone === "alarm"
          ? "border-destructive/50 bg-destructive/10 text-destructive"
          : "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      {children}
    </div>
  );
}

/** The one line to read first. Everything under it lines up with its words,
 *  not its icon. */
function Verdict({
  icon,
  strong = true,
  children,
}: {
  icon: ReactNode;
  /** Drawn in the foreground colour, which a red card overrides. */
  strong?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 text-sm font-medium",
        strong && "text-foreground",
      )}
    >
      <span aria-hidden className="contents">
        {icon}
      </span>
      <span>{children}</span>
    </span>
  );
}

/** Ports as a router's settings page names them, each one set as code. */
function Ports({
  ports,
}: {
  ports: { port: number; transport: DirectTransport }[];
}) {
  return ports.map((p, i) => (
    <Fragment key={`${p.transport}-${p.port}`}>
      {i > 0 && " and "}
      <Code>{`${p.transport.toUpperCase()} ${p.port}`}</Code>
    </Fragment>
  ));
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-background px-1 py-px font-mono text-foreground">
      {children}
    </code>
  );
}

/** What only a bug report needs, one press from view. Nothing at all when there
 *  is nothing to show. */
function Details({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <Collapsible className="pl-5">
      <CollapsibleTrigger className="group flex items-center gap-1 opacity-80 hover:opacity-100">
        <ChevronRight
          aria-hidden
          className="size-3 motion-safe:transition-transform group-data-[state=open]:rotate-90"
        />
        Details
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 flex flex-col gap-1 font-mono text-[11px] opacity-80">
        {lines.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </CollapsibleContent>
    </Collapsible>
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
