import type { DirectLocalAddress } from "./bindings";
import { type DirectReachability, joinAddress } from "./reachability";

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
export type AddressScope = "network" | "internet" | "machine";

/** One address, ready to be read out, copied, or turned into a link. */
export interface ShareAddress {
  scope: AddressScope;
  /** The heading beside it: "On this network", "On en0", "Same machine". */
  label: string;
  /** The address to type in, as `address:port`. */
  address: string;
  port: number;
  /** Who it is for, as the tail of "Copy 192.168.1.5:8200 …". Carries the whole
   *  of what the label leaves implicit, so a button can be named with it. */
  who: string;
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
 * worked, then this machine, which is only ever a second coilbox running beside
 * this one.
 *
 * Interfaces are named only when there is more than one to choose between. A VPN,
 * Docker or a virtual machine adapter gives a machine several private addresses
 * and nothing here can tell which one the joiner is on the same side of, so the
 * host is shown all of them with the interface against each rather than being
 * handed one and left to find out it was the wrong one. On the ordinary machine
 * with one network there is nothing to choose, and "On en0" would be noise.
 */
export function shareAddresses(
  addresses: DirectLocalAddress[],
  port: number,
  reachability: DirectReachability | null,
): ShareAddress[] {
  const local = addresses.filter((a) => !a.loopback);
  const named = local.length > 1;
  const shared: ShareAddress[] = local.map((a) => ({
    scope: "network",
    label: named ? `On ${a.interface}` : "On this network",
    address: a.address,
    port,
    who: named
      ? `for somebody on the same network as this machine's ${a.interface}`
      : "for somebody on the same network as you",
  }));

  // Already `address:port`, and the port in it is the router's rather than the
  // room's whenever the router handed back a different one.
  const outside = reachability && joinAddress(reachability);
  if (outside) {
    const [host, mapped] = outside.split(":");
    shared.push({
      scope: "internet",
      label: "From outside",
      address: host,
      port: mapped ? Number(mapped) : port,
      who: "for somebody who is not on your network",
    });
  }

  shared.push({
    scope: "machine",
    label: "Same machine",
    address: "127.0.0.1",
    port,
    who:
      local.length === 0
        ? "for another coilbox on this machine, which is the only thing that can reach this room while this machine is on no network"
        : "for another coilbox on this machine",
  });
  return shared;
}

/** The one line above the addresses, which changes with what there is to say.
 *  Pure. */
export function shareHeadline(addresses: ShareAddress[]): string {
  if (!addresses.some((a) => a.scope === "network")) {
    return "This machine is on no network, so nobody else can reach this room.";
  }
  if (addresses.filter((a) => a.scope === "network").length > 1) {
    return "Give joiners the address for the network they are on:";
  }
  return "Give joiners this address:";
}
