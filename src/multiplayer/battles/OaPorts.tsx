import { Trans, useLingui } from "@lingui/react/macro";
import { HelpCircle } from "lucide-react";
import { useEffect } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { directClosePorts } from "../../direct/reachability";
import { OA_PORTS, type OaPortKind, type OaPortRange } from "../oaHost";

/** A range as a router's settings page takes it. A single port stands alone. */
export function portRangeLabel(range: OaPortRange): string {
  const ports =
    range.first === range.last
      ? `${range.first}`
      : `${range.first}-${range.last}`;
  return `${range.transport.toUpperCase()} ${ports}`;
}

/**
 * The ports an Open Annihilation host forwards on their router (issue #4950).
 *
 * Stands where the Recoil host's reachability panel stands, and asks the router
 * for nothing. The ranges are named for the host to forward by hand. Opening
 * them through UPnP would be over a hundred mappings. The existing probe,
 * `mp_probe_host`, is a joiner's check of someone else's game port, so it cannot
 * test this machine's UDP 47624 from outside.
 *
 * There is no relay here. A relay for OA would have to carry TCP, which the
 * server relay does not.
 *
 * A Recoil port opened before the host switched engine is handed back when this
 * mounts, since the panel it came from is gone and so is the battle it was for.
 */
export function OaPorts() {
  const { t } = useLingui();
  useEffect(() => {
    directClosePorts({}).catch(() => {});
  }, []);

  const meaning: Record<OaPortKind, string> = {
    discovery: t`Session discovery`,
    stream: t`Stream messages`,
    datagram: t`Datagrams`,
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1 text-sm font-medium">
        <Trans>Ports to forward</Trans>
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={t`Who needs to forward these ports`}
                className="cursor-help text-muted-foreground transition-colors hover:text-foreground"
              >
                <HelpCircle size={13} />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-left leading-snug">
              <Trans>
                Only the host forwards these. A player behind a router who
                forwarded nothing can still join, because their connections go
                out. A host behind a router that forwards nothing cannot be
                joined.
              </Trans>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </span>
      <ul className="flex flex-col gap-1 text-xs">
        {OA_PORTS.map((range) => (
          <li key={range.kind} className="flex items-center gap-2">
            <code className="rounded bg-background px-1 py-px font-mono text-foreground">
              {portRangeLabel(range)}
            </code>
            <span className="text-muted-foreground">{meaning[range.kind]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
