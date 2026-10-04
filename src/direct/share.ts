import type { DirectLocalAddress } from "./bindings";
import {
  type DirectReachability,
  isOnPublicAddress,
  joinAddress,
} from "./reachability";
import { announcementNote } from "./room";

/**
 * What a host reads out so somebody else can join their room (issue #1611).
 *
 * A room binds `0.0.0.0`, so it answers on every address this machine has, and
 * they are not interchangeable: one reaches the person sitting next to you, one
 * reaches the internet, and one reaches nobody but this machine. So they are
 * named by who they are for rather than listed as a set of numbers, and none of
 * them is picked on the host's behalf.
 *
 * Pure, and given everything it decides from: the machine's own addresses (see
 * `directLocalAddresses`), the port the room is listening on, and the port
 * mapping report when there is one.
 */

/** Who an address is for. */
export type AddressScope = "network" | "internet";

/** One address, ready to be read out, copied, or turned into a link. */
export interface ShareAddress {
  scope: AddressScope;
  /** The heading beside it: "On this network", or "On en0". */
  label: string;
  /** The address to type in, as `address:port`. */
  address: string;
  port: number;
  /** Who it is for, as the tail of "Copy 192.168.1.5:8200 …". Carries the whole
   *  of what the label leaves implicit, so a button can be named with it. */
  who: string;
  /** What this address does not get somebody, when it gets them less than the
   *  label promises. Absent on a row that delivers everything it says.
   *
   *  Shown beside the row rather than folded into {@link ShareAddress.who},
   *  because `who` only ever reaches a screen reader through a button's name and
   *  this is the sort of thing a host has to read before they send the address
   *  rather than after they have copied it. */
  caveat?: string;
}

/** `address:port`, which is what "Join by address" takes in one field. */
export function addressText(address: ShareAddress): string {
  return `${address.address}:${address.port}`;
}

/**
 * Every address worth giving somebody, best first. Pure.
 *
 * The order is who is most likely to be asking: the local network first, since
 * that is what this milestone is for, then the internet when port mapping
 * worked. This machine's own loopback address is not offered, because the only
 * thing it reaches is a second coilbox on the same computer, which is not
 * somebody a host shares a room with (typing it into the join form still works).
 * A host whose own address is the public one has no local row to come
 * first, so the internet leads instead, which is the same rule read on a machine
 * where the internet is the only network there is.
 *
 * Interfaces are named only when there is more than one to choose between. A VPN,
 * Docker or a virtual machine adapter gives a machine several private addresses
 * and nothing here can tell which one the joiner is on the same side of, so the
 * host is shown all of them with the interface against each rather than being
 * handed one and left to find out it was the wrong one. On the ordinary machine
 * with one network there is nothing to choose, and "On en0" would be noise.
 *
 * `announced` is the address the room is putting in its battle right now, which
 * is what decides whether the outside row can deliver a game as well as a room
 * (issue #2127). Read live off the room rather than worked out here, so a room
 * that moves onto a VPN moves this with it.
 */
export function shareAddresses(
  addresses: DirectLocalAddress[],
  port: number,
  reachability: DirectReachability | null,
  announced: string,
): ShareAddress[] {
  const local = addresses.filter((a) => !a.loopback);
  // The one address this machine holds that the internet also sees, on a VPS or
  // a home line with no NAT. It is a local address by every test here, and
  // calling it one would tell that host their address reaches the room next
  // door (issue #2085), so it is the outside row instead and is not counted
  // among the networks there is a choice between.
  const publicHost =
    reachability && isOnPublicAddress(reachability)
      ? reachability.publicAddress
      : null;
  const named = local.filter((a) => a.address !== publicHost).length > 1;
  const shared: ShareAddress[] = local.map((a) =>
    a.address === publicHost
      ? outsideAddress(a.address, port, announced)
      : {
          scope: "network",
          label: named ? `On ${a.interface}` : "On this network",
          address: a.address,
          port,
          who: named
            ? `for somebody on the same network as this machine's ${a.interface}`
            : "for somebody on the same network as you",
        },
  );

  // Already `address:port`, and the port in it is the router's rather than the
  // room's whenever the router handed back a different one. Skipped when the
  // address is one of this machine's own, which is the direct host above: the
  // row is already there and a second copy of it helps nobody.
  const outside = reachability && joinAddress(reachability);
  if (outside) {
    const [host, mapped] = outside.split(":");
    if (!shared.some((a) => a.address === host)) {
      shared.push(
        outsideAddress(host, mapped ? Number(mapped) : port, announced),
      );
    }
  }

  return shared;
}

/**
 * The row for whoever is not on this network, wherever the address came from.
 *
 * One wording for the address itself, because a joiner outside is a joiner
 * outside whether the router opened a port or this machine was on the internet
 * all along. What differs is what the address buys them, and that is `announced`
 * against this one (issue #2127).
 *
 * A room announces a single address to everybody in it. Somebody who dials this
 * row reaches the room, and their engine then dials whatever the room announced.
 * When those two are the same address, as they are on a machine that is on the
 * internet under its own address, they get the game as well as the room. When
 * they differ, which is every room behind a router that opened a port, the room
 * has handed them this machine's address on this network and their engine sits
 * on "Connecting to" until they give up.
 *
 * So the row says the second half rather than being taken away. The host can
 * read their public address off the panel in the hosting form whatever this does
 * with it, and a row that quietly vanished after the router opened a port would
 * leave a host who had just read that it opened with nothing to square that
 * against. It is the promise that was wrong, not the address.
 */
function outsideAddress(
  address: string,
  port: number,
  announced: string,
): ShareAddress {
  const row: ShareAddress = {
    scope: "internet",
    label: "From outside",
    address,
    port,
    who: "for somebody who is not on your network",
  };
  if (announced === address) return row;
  return {
    ...row,
    who: `${row.who}, who can join this room and chat but cannot start the game`,
    caveat: `They can join this room and chat. They cannot start the game, because the room gives everybody in it ${announced}, which nothing outside your network can dial.`,
  };
}

/** What a host reads when there is nothing to hand out. Every row is an address
 *  somebody else can use, so an empty list is a machine on no network. */
export const NO_ADDRESS =
  "This room has no address another computer can reach, because this machine is on no network.";

/** The one line above the addresses, which changes with what there is to say.
 *  Pure. */
export function shareHeadline(addresses: ShareAddress[]): string {
  if (addresses.length === 0) return NO_ADDRESS;
  if (addresses.filter((a) => a.scope === "network").length > 1) {
    return "Give joiners the address for the network they are on.";
  }
  return "Give joiners this address.";
}

/**
 * What a host has to read before they hand an address out, one sentence each. Pure.
 *
 * Everything here used to sit beside the rows in the band under the header, and
 * now sits behind the Share button, so the button shows a marker when this is
 * not empty and the popover puts it first. Three sources: the machine being on
 * no network, a row that gets a joiner into the room but not into the game (see
 * {@link ShareAddress.caveat}), and a room that is not announcing itself, which
 * the Battles page says in the same words.
 *
 * `advertise` is whether the room announces itself on the network at all. Whether
 * the announcement has been heard is not asked, because the battle room does not
 * listen for it.
 */
export function shareNotices(
  addresses: ShareAddress[],
  advertise: boolean,
): string[] {
  if (addresses.length === 0) return [NO_ADDRESS];
  const notices: string[] = [];
  for (const a of addresses) {
    if (a.caveat) notices.push(`${a.label}: ${a.caveat}`);
  }
  if (!advertise) notices.push(announcementNote(false, false));
  return notices;
}
