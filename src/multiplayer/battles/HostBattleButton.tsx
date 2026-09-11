import { Button, useDrawer } from "@picoframe/frame";
import { useEffect, useRef } from "react";
import { nextDrawerKey } from "@/general/drawerKey";
import { HostBattleForm, type OpenBattleArgs } from "./HostBattleForm";

/**
 * "Host a battle" on a lobby server: a button that opens {@link HostBattleForm}
 * in the frame's drawer.
 *
 * A drawer rather than the popover it used to be, because the form outgrew one.
 * With the router's answer and the relay choice in it, the popover ran off the
 * bottom of a short window with no way to scroll back to the Host button.
 *
 * The drawer keeps the element it was opened with, so `onHost` goes through a
 * ref. The form calls whatever the page's handler is when Host is pressed, not
 * the one it happened to be when the drawer opened.
 */
export function HostBattleButton({
  disabled,
  relayAvailable,
  onHost,
  initialMap,
  initialGame,
  initialTitle,
  autoOpen,
}: {
  disabled: boolean;
  /** Whether this lobby server has a relay to host through, from
   *  `relayHostingAvailable`. */
  relayAvailable: boolean;
  /** Rejects when the battle did not open, which is what the form shows. */
  onHost: (args: OpenBattleArgs) => Promise<void>;
  /** Preselect this map (e.g. from a content map detail's "Host a battle here"). */
  initialMap?: string;
  /** Preselect this game (e.g. from a skirmish preset's "Host as battle"). */
  initialGame?: string;
  /** Preselect this title (e.g. a skirmish preset's name). */
  initialTitle?: string;
  /** Open the drawer on arrival, paired with `initialMap`/`initialGame` for the
   *  same jump. */
  autoOpen?: boolean;
}) {
  const drawer = useDrawer();
  const latest = useRef(onHost);
  latest.current = onHost;

  const open = () =>
    drawer.open({
      title: "Host a battle",
      // The width the LAN form has, for the same reason: the router's answer
      // and the relay choice are sentences, and a narrow drawer stacks them
      // into a column taller than a laptop window.
      width: "30rem",
      content: (
        <HostBattleForm
          key={nextDrawerKey()}
          relayAvailable={relayAvailable}
          onHost={(args) => latest.current(args)}
          initialMap={initialMap}
          initialGame={initialGame}
          initialTitle={initialTitle}
        />
      ),
    });

  // Once, on arrival, the way the popover used to start open. Reopening
  // whenever a prop changed would put the form back over a page the host had
  // already closed it on.
  const openOnArrival = useRef(open);
  useEffect(() => {
    if (autoOpen) openOnArrival.current();
  }, [autoOpen]);

  return (
    <Button
      variant="secondary"
      className="h-8 px-3"
      disabled={disabled}
      onClick={open}
    >
      Host a battle
    </Button>
  );
}
