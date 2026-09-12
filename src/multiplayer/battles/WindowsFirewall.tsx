import { Button } from "@picoframe/frame";
import { ChevronRight, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
        problem: e instanceof Error ? e.message : String(e),
      }));
    } finally {
      setAsking(false);
    }
  }, [engine]);

  if (!state?.supported || state.programs.length === 0) return null;

  const settled = state.programs.every((p) => p.allowed === true);
  if (settled && !state.problem) {
    return (
      <p className="text-xs text-muted-foreground">
        Windows Firewall already allows every program hosting needs.
      </p>
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
      <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
        {state.programs.map((program) => (
          <li key={program.path}>
            <span className="font-medium text-foreground">{program.name}</span>{" "}
            {program.allowed === true
              ? "is allowed in"
              : program.allowed === false
                ? "is not allowed in"
                : "could not be checked"}
          </li>
        ))}
      </ul>
      {state.problem && (
        <p className="text-xs text-destructive">{state.problem}</p>
      )}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={allow}
        disabled={asking}
        className="self-start"
      >
        {asking && <Loader2 aria-hidden className="size-3 animate-spin" />}
        {asking ? "Waiting for Windows" : "Allow them through the firewall"}
      </Button>
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
