import { Button } from "@picoframe/frame";
import {
  ChevronRight,
  CircleCheck,
  CircleHelp,
  CircleX,
  Loader2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Details, ResultCard, Verdict } from "@/components/ResultCard";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { type Firewall, mpFirewall, mpFirewallAllow } from "../bindings";

/**
 * Answering Windows Firewall from the hosting drawer, before a game depends on
 * the answer (issue #2799).
 *
 * Windows asks whether to allow a program the first time it opens a port for
 * incoming connections. Hosting sets that off for up to three programs, and the
 * last of them is the engine, which asks while the game is starting: the
 * question arrives behind a loading screen, and a host who dismisses it or
 * never sees it gets a battle nobody can join. Nothing on the machine can see
 * that afterwards, which is why `hostingRoute.ts` lists a firewall prompt
 * nobody answered among the things the reachability check cannot explain.
 *
 * Drawn only on Windows, and only because Rust said so. The backend answers
 * `supported: false` everywhere else, which is a better gate than reading the
 * user agent for something that ends in an operating system call.
 *
 * The answer sits in the same {@link ResultCard} the reachability check above it
 * uses, because they are the same kind of thing: something coilbox asked the
 * machine, and what came back. Windows' own words go behind Details rather than
 * into the drawer, after a host saw six lines of PowerShell error record where
 * the verdict should have been.
 */
export function WindowsFirewall({ engine }: { engine: string | null }) {
  const [state, setState] = useState<Firewall | null>(null);
  const [asking, setAsking] = useState(false);

  // Asked again whenever the engine changes, because Windows remembers an
  // answer per program file and each engine version is its own file. A host who
  // switches engine has a program nothing has allowed yet.
  useEffect(() => {
    let live = true;
    mpFirewall({ engine })
      .then((answer) => {
        if (live) setState(answer);
      })
      .catch(() => {
        // Not knowing is not a firewall problem, and a panel drawn on the
        // strength of a failed call would claim one.
      });
    return () => {
      live = false;
    };
  }, [engine]);

  const allow = useCallback(async () => {
    setAsking(true);
    try {
      setState(await mpFirewallAllow({ engine }));
    } catch (e) {
      setState((was) => ({
        supported: true,
        programs: was?.programs ?? [],
        problem: {
          title: "Coilbox could not reach Windows Firewall",
          details: [e instanceof Error ? e.message : String(e)],
          fault: true,
        },
      }));
    } finally {
      setAsking(false);
    }
  }, [engine]);

  if (!state?.supported || state.programs.length === 0) return null;

  const { problem } = state;
  const settled = state.programs.every((p) => p.allowed === true);
  if (settled && !problem) {
    return (
      <ResultCard tone="quiet">
        <Verdict
          icon={<CircleCheck className="size-3.5 shrink-0 text-emerald-500" />}
        >
          Windows Firewall already allows every program hosting needs
        </Verdict>
      </ResultCard>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">Windows Firewall</span>
      <p className="text-xs text-muted-foreground">
        Windows asks whether to allow a program the first time it opens a port.
        The engine asks while your game is starting, which is the worst moment
        to be answering questions. Answer for all of them now instead.
      </p>

      <ResultCard
        tone={problem?.fault ? "alarm" : "quiet"}
        role={problem?.fault ? "alert" : undefined}
      >
        <Verdict
          icon={
            asking ? (
              <Loader2 className="size-3.5 shrink-0 motion-safe:animate-spin" />
            ) : problem?.fault ? (
              <CircleX className="size-3.5 shrink-0" />
            ) : (
              <CircleHelp className="size-3.5 shrink-0" />
            )
          }
          strong={!problem?.fault}
        >
          {asking
            ? "Waiting for Windows"
            : (problem?.title ?? verdict(state.programs))}
        </Verdict>

        <ul className="flex flex-col gap-0.5 pl-5">
          {state.programs.map((program) => (
            <li key={program.path}>
              <span className="font-medium text-foreground">
                {program.name}
              </span>{" "}
              {program.allowed === true
                ? "is allowed in"
                : program.allowed === false
                  ? "is not allowed in"
                  : "could not be checked"}
            </li>
          ))}
        </ul>

        {/* Said whenever coilbox could not read the rules, because that is
            exactly when the button looks pointless and is not: the read is what
            Windows refused, and adding them asks for administrator rights. */}
        {state.programs.some((p) => p.allowed === null) && !asking && (
          <span className="pl-5">
            You can still add the rules. Windows keeps one per program, so doing
            it twice changes nothing.
          </span>
        )}

        <Details lines={problem?.details ?? []} />

        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={allow}
          disabled={asking}
          className="ml-5 self-start"
        >
          Allow them through the firewall
        </Button>
      </ResultCard>

      <Collapsible>
        <CollapsibleTrigger className="group flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronRight
            aria-hidden
            className="size-3 motion-safe:transition-transform group-data-[state=open]:rotate-90"
          />
          What does this change?
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-1.5 flex flex-col gap-1.5 pl-4 text-xs text-muted-foreground">
          <p>
            It adds one Windows Defender Firewall rule per program, allowing
            incoming connections to that program and nothing else. Windows asks
            you to confirm as an administrator once, and coilbox changes nothing
            if you say no.
          </p>
          <p>
            The rules are grouped under Coilbox, so you can find and remove them
            in Windows Defender Firewall whenever you like.
          </p>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

/** The line above the list, when there is nothing wrong to say instead. */
function verdict(programs: Firewall["programs"]): string {
  const blocked = programs.filter((p) => p.allowed === false).length;
  if (blocked === 1) return "One program is not allowed in yet";
  return `${blocked} programs are not allowed in yet`;
}
