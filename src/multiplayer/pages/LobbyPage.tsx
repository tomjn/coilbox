/**
 * Placeholder Lobby landing route. Real battle-list / chat / battle-room UI is a
 * follow-up discussion; this exists so the nav entry and route resolve.
 *
 * Default-exported for the frame's lazy route convention.
 */
export default function LobbyPage() {
  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold">Lobby</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Multiplayer lobby client (coming soon).
      </p>
    </div>
  );
}
