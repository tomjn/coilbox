/**
 * The two ways an IPv6 host is written, and which one each use wants (issues
 * #3407 and #3420).
 *
 * Brackets are for showing an address and for a `host:port` string, where they
 * are the only way to tell the last group of the address from the port. A dial
 * takes the host and the port as two values and wants no brackets: Rust's
 * `TcpStream::connect((host, port))` looks `[::1]` up as a name. A URL is the
 * other way round, so a Tachyon server's host stays in brackets.
 *
 * This only changes how a host is written. What counts as a host, and whether
 * two spellings are one server, is decided in `address.ts`.
 */

/** A host as the dial takes it: an IPv6 address without its brackets. Pure. */
export function dialHost(host: string): string {
  const inside = /^\[(.*)\]$/.exec(host);
  return inside ? inside[1] : host;
}

/** A host as a URL or `host:port` string takes it: an IPv6 address in brackets. Pure. */
export function bracketedHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

/**
 * The `host:port` half of a connection key (`username@host:port`), with an IPv6
 * host in brackets whichever way the key was built. Pure.
 *
 * A key is built from the host as it was saved or typed, so a bare `::1` gives
 * `me@::1:8200`, where the port cannot be told from the address's last group
 * by the first colon but can by the last one, since a port has no colon in it.
 */
export function addressOfKey(serverKey: string): string {
  const address = serverKey.slice(serverKey.indexOf("@") + 1);
  const colon = address.lastIndexOf(":");
  if (colon < 0) return address;
  return `${bracketedHost(address.slice(0, colon))}${address.slice(colon)}`;
}
