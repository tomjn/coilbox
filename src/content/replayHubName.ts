import type { DemoInfo } from "./bindings";

/** A login, as `lobbyServers.accounts` keeps it. */
interface Login {
  serverId: string;
  username: string;
  lastUsedAt?: number;
}

/**
 * The lobby names the user has signed in to Coilbox with (issue #5493): every
 * saved login that has connected at least once, and the last login, which a
 * login saved before connections were stamped may be the only record of.
 */
export function signedInLobbyNames(
  accounts: readonly Login[],
  lastLogin: { serverId: string; username: string } | null,
): string[] {
  const names = accounts
    .filter((a) => a.lastUsedAt !== undefined)
    .map((a) => a.username);
  if (lastLogin) names.push(lastLogin.username);
  return [...new Set(names)];
}

/**
 * The name the user was in this battle under, as the replay spells it, or null
 * when none of their names is a player or a spectator in it. The hub compares
 * the name exactly, so the replay's spelling is the one sent. A lobby treats
 * names alike whatever their case, so a login matches either way.
 */
export function userNameInReplay(
  info: Pick<DemoInfo, "players">,
  names: readonly string[],
): string | null {
  const seated = info.players.map((p) => p.name);
  for (const name of names) {
    if (seated.includes(name)) return name;
  }
  for (const name of names) {
    const lower = name.toLowerCase();
    const found = seated.find((n) => n.toLowerCase() === lower);
    if (found) return found;
  }
  return null;
}
