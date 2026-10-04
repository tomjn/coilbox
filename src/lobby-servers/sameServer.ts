/**
 * Whether a connection key and a saved server, or two connection keys, are the
 * same lobby server (issue #3437).
 *
 * A connection key is `username@host:port`, built from the host exactly as it
 * was saved. The same server saved as `::1` and as `[::1]`, or as `Lobby.com`
 * and as `lobby.com.`, gives two different keys, so text comparison on the key
 * tells two spellings apart. These compare in the one form `address.ts` writes.
 *
 * A host the normaliser refuses (a zone id, an underscore, a letter outside
 * ASCII) has no such form. It is compared by its text, so a server that matched
 * itself before still does, and two such hosts are never one server unless they
 * are written the same.
 */

import {
  normaliseHost,
  normaliseHostPort,
  normaliseServerAddress,
} from "./address";
import { addressOfKey, bracketedHost } from "./hostForms";

/** The two fields of a saved server that decide which server it is. */
export interface ServerAddressFields {
  host: string;
  port: number;
}

/** Whether the key's `host:port` is written exactly as the saved server's. */
function keyIsSpelledAs(serverKey: string, server: ServerAddressFields) {
  return serverKey.endsWith(`@${server.host}:${server.port}`);
}

/**
 * Whether `serverKey` (`username@host:port`) is a connection to `server`, with
 * the host written either way. Pure.
 */
export function keyIsOnServer(
  serverKey: string,
  server: ServerAddressFields,
): boolean {
  if (keyIsSpelledAs(serverKey, server)) return true;
  const saved = normaliseHostPort(server.host, server.port);
  const keyed = normaliseServerAddress(addressOfKey(serverKey));
  return saved != null && keyed != null && saved.address === keyed.address;
}

/**
 * The saved server `serverKey` is a connection to, or undefined. Pure.
 *
 * An entry whose host is written exactly as the key's is preferred to one that
 * only matches once normalised. Two entries can hold one server under two
 * spellings, each with logins of its own, and a key made from one has to find
 * that one, not whichever comes first in the list.
 */
export function serverForKey<T extends ServerAddressFields>(
  serverKey: string,
  servers: readonly T[],
): T | undefined {
  return (
    servers.find((s) => keyIsSpelledAs(serverKey, s)) ??
    servers.find((s) => keyIsOnServer(serverKey, s))
  );
}

/**
 * A host in the form two hosts are compared in: the normalised host, or for one
 * the normaliser refuses its lower-cased text, bracketed if it is an IPv6
 * address so a key and a saved entry read the same. Pure.
 */
export function hostIdentity(host: string): string {
  const bracketed = bracketedHost(host);
  return normaliseHost(bracketed) ?? bracketed.toLowerCase();
}

/** The host half of a connection key, in the form {@link hostIdentity} gives. Pure. */
export function hostOfKey(serverKey: string): string {
  const address = addressOfKey(serverKey);
  const colon = address.lastIndexOf(":");
  return hostIdentity(colon < 0 ? address : address.slice(0, colon));
}
