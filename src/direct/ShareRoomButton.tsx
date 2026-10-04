import { Button } from "@picoframe/frame";
import { Copy, Share2, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { buildRoomLink } from "@/deeplink/build";
import { cn } from "@/lib/utils";
import {
  type DirectLocalAddress,
  type DirectRoomStatus,
  directLocalAddresses,
} from "./bindings";
import { CopyButton } from "./CopyButton";
import { type DirectReachability, directPortStatus } from "./reachability";
import {
  addressText,
  type ShareAddress,
  shareAddresses,
  shareHeadline,
  shareNotices,
} from "./share";

/**
 * The way into a hosted room, behind one button (issue #3460).
 *
 * It used to be a band under the battle room's header with a row of buttons per
 * address, which took a strip off the room for something a host does once. The
 * button sits with Close and Start. The popover holds each address with the
 * invite link as the main action, because a friend on another machine wants a
 * link that opens coilbox and joins, and the bare address as the quieter one, for
 * typing in by hand (issue #1612).
 *
 * The addresses are read once on mount rather than polled, and on mount rather
 * than on opening, because the marker on the button depends on them: a warning
 * has to be visible before anyone opens anything. Ports do not open and close by
 * themselves and an interface does not usually appear while a room is up. What
 * does move is the address the room announces, which comes down on `room` from
 * the shared poll (issue #2116).
 */
export function ShareRoomButton({
  room,
  className,
}: {
  room: DirectRoomStatus;
  /** Appended to the trigger's classes, for a row that wants a smaller button. */
  className?: string;
}) {
  const [addresses, setAddresses] = useState<DirectLocalAddress[] | null>(null);
  const [report, setReport] = useState<DirectReachability | null>(null);
  useEffect(() => {
    let live = true;
    directLocalAddresses({})
      .then((r) => {
        if (live) setAddresses(r.addresses);
      })
      .catch(() => {});
    directPortStatus({})
      .then((r) => {
        if (live) setReport(r.reachability);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const shared = addresses
    ? shareAddresses(addresses, room.port, report, room.ip)
    : null;
  const notices = shared ? shareNotices(shared, room.advertise) : [];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn("relative", className)}>
          <Share2 className="size-4" />
          Share
          {notices.length > 0 && (
            <>
              <span
                aria-hidden
                className="absolute -right-1 -top-1 size-2.5 rounded-full border border-background bg-amber-500"
              />
              <span className="sr-only">, has a warning</span>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="max-h-[min(32rem,var(--radix-popover-content-available-height))] w-80 space-y-4 overflow-y-auto"
      >
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">Invite people to this room</h2>
          {shared && shared.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {shareHeadline(shared)}
            </p>
          )}
          {!shared && (
            <p className="text-xs text-muted-foreground">
              Looking up this machine&apos;s addresses…
            </p>
          )}
        </div>
        {notices.length > 0 && (
          <ul className="space-y-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-400">
            {notices.map((notice) => (
              <li key={notice} className="flex gap-2">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                <span>{notice}</span>
              </li>
            ))}
          </ul>
        )}
        {shared && shared.length > 0 && (
          <ul className="space-y-3">
            {shared.map((address, i) => (
              <AddressBlock
                key={`${address.scope}-${address.address}`}
                address={address}
                first={i === 0}
              />
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** One address: who it is for, the address to read out, and the two ways to take
 *  it. The link is the main action when there is one. */
function AddressBlock({
  address,
  first,
}: {
  address: ShareAddress;
  first: boolean;
}) {
  const text = addressText(address);
  const link = buildRoomLink(address.address, address.port);
  return (
    <li
      className={first ? "space-y-2" : "space-y-2 border-t border-border pt-3"}
    >
      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">{address.label}</div>
        <code className="block select-all rounded bg-muted px-2 py-1 font-mono text-sm text-foreground">
          {text}
        </code>
      </div>
      <div className="flex items-center gap-2">
        {link && (
          <CopyButton
            value={link}
            variant="default"
            className="h-8 px-3"
            label={`Copy a link that joins at ${text}, ${address.who}`}
          >
            Copy link
          </CopyButton>
        )}
        <CopyButton
          value={text}
          variant={link ? "ghost" : "default"}
          className="h-8 px-3"
          label={`Copy ${text}, ${address.who}`}
        >
          <Copy className="size-3.5" />
          Copy address
        </CopyButton>
      </div>
    </li>
  );
}
