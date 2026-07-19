import type { GalaxyDoc } from "./model";

/**
 * The node a faction's header card should focus the camera on:
 *
 * 1. its capital, if the faction still owns it;
 * 2. otherwise the still-owned system geometrically nearest that lost capital
 *    (so a routed faction focuses where it's retreated to, near home);
 * 3. otherwise any owned system (faction with no authored capital);
 * 4. otherwise `null` — the faction has been wiped out and has nothing to focus.
 *
 * A capital is identified by its *initial* owner (`node.owner`), which never
 * changes even after the capital is captured; current control comes from
 * `owners` (the run's live ownership).
 */
export function factionFocusNode(
  galaxy: GalaxyDoc,
  owners: Record<string, string>,
  factionId: string,
): string | null {
  const capital = galaxy.nodes.find(
    (n) => n.kind === "capital" && n.owner === factionId,
  );
  if (capital && owners[capital.id] === factionId) return capital.id;

  const owned = galaxy.nodes.filter((n) => owners[n.id] === factionId);
  if (owned.length === 0) return null;
  if (!capital) return owned[0].id;

  // Lost the capital: focus the owned system closest to it (squared distance —
  // monotonic, so no need for the sqrt).
  const [cx, cy] = capital.pos;
  let best = owned[0];
  let bestD = Number.POSITIVE_INFINITY;
  for (const n of owned) {
    const dx = n.pos[0] - cx;
    const dy = n.pos[1] - cy;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best.id;
}
