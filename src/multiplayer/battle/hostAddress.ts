/**
 * Pre-launch sanity checks on the address a lobby hands out for a battle's host.
 *
 * `BATTLEOPENED` carries a bare IP that the lobby server derives from the host's
 * own connection, and we copy it verbatim into the start script's `HostIP`. No
 * layer in between can tell whether it is right. These checks catch the values
 * that cannot work (placeholders, loopback, non-unicast) and flag the ones that
 * only work in a narrower setup than the player likely expects (private ranges,
 * provider-shared addresses), so a bad address surfaces here rather than as an
 * engine stuck forever on "Connecting to".
 */

export type HostAddressVerdict =
  | { kind: "ok" }
  | { kind: "blocked"; reason: string }
  | { kind: "warning"; reason: string };

/** Addresses meaning "unspecified" rather than naming a reachable machine. */
const PLACEHOLDERS = new Set(["*", "0.0.0.0", "::", "::0"]);

/** Split a dotted quad into its four octets, or null if it is not one. */
function ipv4Octets(addr: string): [number, number, number, number] | null {
  const parts = addr.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets as [number, number, number, number];
}

function blocked(reason: string): HostAddressVerdict {
  return { kind: "blocked", reason };
}

function warning(reason: string): HostAddressVerdict {
  return { kind: "warning", reason };
}

/**
 * Judge the host address and port we are about to write into a joining client's
 * start script. Anything that is not a dotted quad (a hostname, or an IPv6
 * literal beyond the two placeholder forms) passes through untouched for the
 * engine to resolve.
 */
export function checkHostAddress(
  addr: string | undefined,
  port: number | null | undefined,
): HostAddressVerdict {
  const ip = (addr ?? "").trim();
  if (!ip) return blocked("The lobby gave no address for the host.");
  if (!port) return blocked("The lobby gave no port for the host.");
  if (PLACEHOLDERS.has(ip)) {
    return blocked(
      `The lobby gave a placeholder address (${ip}) instead of the host's own.`,
    );
  }
  if (ip === "::1") {
    return blocked(
      `The lobby says the host is at ${ip}, which points back at your own machine.`,
    );
  }

  const octets = ipv4Octets(ip);
  if (!octets) return { kind: "ok" };
  const [a, b] = octets;

  if (a === 0) {
    return blocked(
      `The lobby gave a placeholder address (${ip}) instead of the host's own.`,
    );
  }
  if (a === 127) {
    return blocked(
      `The lobby says the host is at ${ip}, which points back at your own machine.`,
    );
  }
  // 224.0.0.0/4 multicast, 240.0.0.0/4 reserved, and the broadcast address: none
  // of them name one machine, so the engine has nothing to connect to.
  if (a >= 224) {
    return blocked(
      `${ip} is not a single machine's address, so the engine cannot connect to it.`,
    );
  }
  if (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  ) {
    return warning(
      `The host's address (${ip}) is a private one, so this only works if you are on the same network as them.`,
    );
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return warning(
      `The host's address (${ip}) is shared with other customers by their internet provider, so they are unlikely to be able to accept incoming connections.`,
    );
  }
  if (a === 169 && b === 254) {
    return warning(
      `The host's address (${ip}) is a link-local one, so this only works if you are on the same network segment as them.`,
    );
  }
  return { kind: "ok" };
}
