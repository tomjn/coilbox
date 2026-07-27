import { type AiSubstitution, reconcileAi } from "@/conquest/ai";
import type { SkirmishAi } from "@/content/bindings";
import type { Participant } from "./participants";

/**
 * Reconcile every AI slot in a roster against a target game version's actual AI
 * list (issue #501). A preset or draft captures specific AI picks for the game
 * it was authored in, but presets are reused across games and across versions
 * of the same game, so an applied AI may not exist in the target. This remaps
 * each present-but-unavailable AI to that game's own sensible default and
 * reports the swaps so the caller can flag them, rather than leaving a slot
 * pointing at an AI the game doesn't offer (the blank-dropdown bug).
 *
 * Genuinely empty slots (an `ai` participant with no `ai` yet) are left
 * untouched: the launcher's own "fill the default AI" pass owns those, and
 * mixing the two here would have the two passes fight over the same slot. A slot
 * whose AI can't be resolved at all (the game offers no usable AI) is left as-is
 * and counted, never silently blanked.
 *
 * Pure and version-safe: the caller resolves the target game's AI list first
 * (from unitsync, keyed by the installed archive, so it is that version's list).
 * With an empty list (no unitsync AI data) nothing is changed, so a degraded
 * scan never wipes valid picks.
 *
 * `ready` is the caller's "this list is the selected game's own, and it has
 * settled" flag (`!!gameArchive && loaded` from `useSkirmishAis`, mirroring
 * `addableAisReady` in `useBattleRoom`). It is a required argument because
 * getting it wrong is silent and destructive: a query with no game returns the
 * engine's *native* AIs only, so reconciling against it swaps a valid Lua pick
 * (SimpleAI) for a native (BARb), which the real game list then swaps back on
 * the next pass: a flip-flop that rewrites the persisted draft on every visit.
 */
export function reconcileParticipantAis(
  participants: Participant[],
  ais: Pick<SkirmishAi, "shortName" | "kind" | "name">[],
  ready: boolean,
): {
  participants: Participant[];
  substitutions: AiSubstitution[];
  unresolvedCount: number;
  changed: boolean;
} {
  const substitutions: AiSubstitution[] = [];
  let unresolvedCount = 0;
  let changed = false;

  if (!ready || ais.length === 0) {
    return { participants, substitutions, unresolvedCount, changed };
  }

  const next = participants.map((p) => {
    if (p.kind !== "ai" || !p.ai) return p;
    const outcome = reconcileAi(p.ai, ais);
    if (outcome.status === "kept") return p;
    if (outcome.status === "unresolved" || !outcome.ai) {
      unresolvedCount++;
      return p;
    }
    // status === "substituted": the desired AI isn't in this game's list.
    changed = true;
    substitutions.push({ from: p.ai.shortName, to: outcome.ai.shortName });
    return {
      ...p,
      ai: {
        kind: outcome.ai.kind,
        shortName: outcome.ai.shortName,
        name: outcome.ai.name,
      },
    };
  });

  return {
    participants: changed ? next : participants,
    substitutions,
    unresolvedCount,
    changed,
  };
}
