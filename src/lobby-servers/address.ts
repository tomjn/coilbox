/**
 * One way of writing a lobby server's address, so two spellings of the same
 * server compare equal and two different servers never do (issue #3382).
 *
 * An invite link names its server by address, and a link is written by whoever
 * sent it. Whether that address is a server the player already has a login for
 * decides whether a saved password is offered, so the comparison is made on
 * this form and the player is shown this form, never the text of the link.
 *
 * Anything that could make an address read as one host and dial another is
 * refused rather than tidied: userinfo (`known@other`), a path, an escape, and
 * every character outside ASCII, which is where lookalike letters live. A host
 * with such letters has an `xn--` spelling, which is accepted and shown as
 * written, because that spelling cannot be taken for another name.
 */

/** The longest a host name is in text, and the longest one label of it is
 * (RFC 1035 section 2.3.4). */
const MAX_HOST_LENGTH = 253;
const MAX_LABEL_LENGTH = 63;

/** A server's address in the one form coilbox compares and shows. */
export interface ServerAddress {
  host: string;
  port: number;
  /** `host:port`, which is what a player is shown. */
  address: string;
}

/**
 * The URL parser's own spelling of a host that has already passed the checks
 * below. It lower-cases a name, writes every form of an IPv4 address as four
 * decimal numbers and shortens an IPv6 address one way, and it refuses a host
 * that is none of the three.
 */
function canonicalHost(host: string): string | null {
  try {
    return new URL(`http://${host}/`).hostname || null;
  } catch {
    return null;
  }
}

/**
 * A host in its one form, or null when it is not a host. Pure. An IPv6 address
 * is taken in brackets only, and comes back in them.
 */
export function normaliseHost(raw: string): string | null {
  if (raw.startsWith("[")) {
    if (!/^\[[0-9A-Fa-f:.]+\]$/.test(raw)) return null;
    return canonicalHost(raw);
  }
  if (!/^[A-Za-z0-9.-]+$/.test(raw)) return null;
  // `example.com.` and `example.com` are one name.
  const host = raw.endsWith(".") ? raw.slice(0, -1) : raw;
  if (host === "" || host.length > MAX_HOST_LENGTH) return null;
  const badLabel = host
    .split(".")
    .some(
      (label) =>
        label === "" ||
        label.length > MAX_LABEL_LENGTH ||
        label.startsWith("-") ||
        label.endsWith("-"),
    );
  return badLabel ? null : canonicalHost(host);
}

/**
 * A saved server's host and port in the form a link's address is compared
 * against, or null when they are not an address, which then matches no link.
 * Pure. A saved IPv6 host may be written without brackets, because the port is
 * a field of its own there.
 */
export function normaliseHostPort(
  host: string,
  port: number,
): ServerAddress | null {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const bracketed = host.includes(":") && !host.startsWith("[");
  const normal = normaliseHost(bracketed ? `[${host}]` : host);
  return normal ? { host: normal, port, address: `${normal}:${port}` } : null;
}

/**
 * A `host:port` in its one form, or null when it is not one. Pure. The port is
 * required: an address with none is not dialled on a guess.
 */
export function normaliseServerAddress(raw: string): ServerAddress | null {
  const parts = /^(\[[^\]]*\]|[^:[\]]+):([0-9]{1,5})$/.exec(raw);
  if (!parts) return null;
  return normaliseHostPort(parts[1], Number(parts[2]));
}
