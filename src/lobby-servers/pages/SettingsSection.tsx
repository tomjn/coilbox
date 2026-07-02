/**
 * The lobby-servers settings section, hosted in the frame settings page at
 * `/settings/lobby-servers`. Owns the shared lobby server directory (names, hosts,
 * ports, TLS, usernames) plus per-account secrets stored in the OS keychain via the
 * `coilbox-lobby-servers` plugin. Body is filled in during implementation.
 */
export default function LobbyServersSettings() {
  return (
    <div className="space-y-8">
      <p className="text-sm text-muted-foreground">
        Lobby server directory (coming soon).
      </p>
    </div>
  );
}
