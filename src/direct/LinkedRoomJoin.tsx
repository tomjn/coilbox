import { useDrawer } from "@picoframe/frame";
import { useEffect, useRef } from "react";
import { nextDrawerKey } from "@/general/drawerKey";
import { type JoinRoomArgs, JoinRoomForm } from "./JoinRoomForm";

/**
 * The far end of a `coilbox://room` link (issue #1612): the join form, opened
 * once, with the address and port the link carried already in it.
 *
 * The form rather than a join, because a link comes from outside coilbox and
 * nothing may act on one without the person agreeing. The confirm dialog in
 * `DeepLinkHandler` is the first ask and this is the second, which is also where
 * they put their name in and where a room that has stopped since the link was
 * pasted is reported.
 *
 * Renders nothing. It exists to open a drawer on arrival, and the page it sits
 * on is already the right place to land: the room may also be on the network,
 * in which case it is listed behind this.
 */
export function LinkedRoomJoin({
  target,
  defaultName,
  blocked,
  onJoin,
}: {
  /** The room the link named, or null when this page was not reached by one. */
  target: { address: string; port: number } | null;
  /** The name to offer as this player's, usually their last lobby login. */
  defaultName?: string;
  /** Why joining is unavailable, or null. Said inside the drawer rather than
   *  keeping it shut, so following a link is never a link that does nothing. */
  blocked: string | null;
  onJoin: (args: JoinRoomArgs) => Promise<void>;
}) {
  const drawer = useDrawer();
  // One drawer per link followed. Without this, every re-render of the page
  // reopens the form over whatever the person moved on to, because the link is
  // held in router state and outlives the arrival.
  const opened = useRef<string | null>(null);

  useEffect(() => {
    if (!target) return;
    const key = `${target.address}:${target.port}`;
    if (opened.current === key) return;
    opened.current = key;
    drawer.open({
      title: "Join by address",
      width: "30rem",
      content: (
        <JoinRoomForm
          key={nextDrawerKey()}
          target={{
            address: target.address,
            port: target.port,
            // Unknown, and asked for anyway: the form offers the field to every
            // room, because a beacon two seconds old cannot be trusted about a
            // password either.
            passworded: false,
            from: "link",
          }}
          defaultName={defaultName}
          blocked={blocked}
          onJoin={onJoin}
        />
      ),
    });
  }, [target, drawer, defaultName, blocked, onJoin]);

  return null;
}
