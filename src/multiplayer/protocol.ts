import {
  type LobbyProtocol,
  type LobbyServer,
  serverProtocol,
} from "../lobby-servers/config";

/**
 * The protocol spoken by the connection named by `serverKey`, matched on the
 * `host:port` half of the key (`username@host:port`, see `serverKeyFor`). Pure.
 *
 * The store holds the key rather than the `LobbyServer` a connect was given, and a
 * connection re-adopted after a webview reload never had one at all, so the
 * protocol is read back from the key instead of being remembered at connect time.
 * With no connection, or a key naming a server that is no longer configured, this
 * reads as `tasserver`, which is what every surface assumed before Tachyon.
 */
export function protocolForKey(
  serverKey: string | null,
  servers: LobbyServer[],
): LobbyProtocol {
  if (serverKey == null) return "tasserver";
  const server = servers.find((s) =>
    serverKey.endsWith(`@${s.host}:${s.port}`),
  );
  return server ? serverProtocol(server) : "tasserver";
}

/**
 * Whether a connection runs the ready-time sync the store owns: auto-joining the
 * configured channels, pulling the server ignore list, pulling the friend list and
 * pending friend requests, and publishing our status bits.
 *
 * Each of those is a TASServer command with no Tachyon equivalent. A Tachyon
 * connection skips them here rather than queueing them for the connection task to
 * drop, which is what put four "not sent" lines in the console on every connect.
 */
export function syncsOnReady(protocol: LobbyProtocol): boolean {
  return protocol === "tasserver";
}
