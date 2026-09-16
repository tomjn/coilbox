import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { type DirectVpnRoute, directVpnRoute } from "./bindings";

/**
 * How often the default route is re-read while a warning is on screen.
 *
 * It is read again rather than once, because the point of the warning is to get
 * somebody to turn their VPN off, and a line still telling them to do it a
 * minute after they have is a warning about nothing. The battle list is open
 * for as long as somebody is looking for a game, which is long enough for that
 * to happen. The same ten seconds the relay ping beside it uses, and a much
 * cheaper read: this one asks the OS for its own interfaces and never leaves
 * the machine.
 */
const VPN_CHECK_EVERY_MS = 10_000;

/**
 * The VPN carrying this machine's internet traffic, re-read every
 * {@link VPN_CHECK_EVERY_MS}. `null` when nothing is, and while the first
 * answer is still coming.
 *
 * A call that fails is the same as no VPN. Nothing here is worth a warning
 * raised on a question that went unanswered.
 */
function useVpnRoute(): DirectVpnRoute | null {
  const [vpn, setVpn] = useState<DirectVpnRoute | null>(null);
  useEffect(() => {
    let live = true;
    let asking: ReturnType<typeof setTimeout> | undefined;
    const ask = async () => {
      const answer = await directVpnRoute({}).catch(() => null);
      if (!live) return;
      setVpn(answer?.vpn ?? null);
      asking = setTimeout(ask, VPN_CHECK_EVERY_MS);
    };
    void ask();
    return () => {
      live = false;
      clearTimeout(asking);
    };
  }, []);
  return vpn;
}

/** Which of the two sentences to say, per where it is being said. */
type VpnWarningPlace = "host" | "join";

/** The warning itself, naming the interface it is about. Pure. */
function vpnWarningText(place: VpnWarningPlace, interfaceName: string): string {
  if (place === "join") {
    return `Your internet traffic goes through a VPN (${interfaceName}). Everything you send goes to the VPN's server first, so your ping will be worse than it needs to be. Turn the VPN off while you play.`;
  }
  return `Your internet traffic goes through a VPN (${interfaceName}). Players may not be able to reach you directly, and everything anybody sends you goes through the VPN's server first, so pings will be worse for the whole battle. Turn the VPN off while you play.`;
}

/**
 * One line about the VPN carrying this machine's traffic, drawn only when there
 * is one (issue #2800).
 *
 * Said in two places and worded differently in each. The host is told what it
 * costs the battle, because on a VPN their address is usually not one anybody
 * can dial and their delay is added to everybody else's. Somebody joining is
 * told the shorter thing, because all it costs them is their own ping.
 *
 * Never drawn for Tailscale, ZeroTier or Radmin: those leave the default route
 * alone and the backend answers nothing for them. A false warning here is worse
 * than a missing one, since somebody told their connection is bad when it is
 * fine goes looking for a fault that is not there.
 */
export function VpnWarning({
  place,
  className,
}: {
  place: VpnWarningPlace;
  /** Where the line sits in its page. Taken rather than wrapped, so a page with
   *  no VPN on it is not left holding an empty box with padding on it. */
  className?: string;
}) {
  const vpn = useVpnRoute();
  if (!vpn) return null;
  return (
    <p className={cn("text-xs text-muted-foreground", className)}>
      {vpnWarningText(place, vpn.interface)}
    </p>
  );
}
