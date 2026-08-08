import type { SkirmishDraft } from "@/play/drafts";
import { standardAi } from "@/play/gameAi";
import { PALETTE, type Participant, RANDOM_SIDE } from "@/play/participants";
import type { DemoInfo, Side, SkirmishAi } from "./bindings";

/**
 * Convert a decoded replay (`DemoInfo`) into a launchable `SkirmishDraft`, so a
 * finished match can be "refought" solo (issue #368) — mirrors
 * `multiplayer/battle/toSkirmish.ts`'s `battleToSkirmishDraft`, the equivalent
 * transform for a live battle.
 *
 * A decoded replay carries no live "you", so every seat it recorded becomes an
 * AI opponent: each non-spectator `[playerN]`, then each `[aiN]`. A bot keeps
 * the AI it was actually played with when the target game still has it, and
 * falls back to the chosen/standard AI otherwise. "You" is seeded as a
 * spectator placeholder, same as `battleToSkirmishDraft`'s no-self branch, so
 * the draft stays launchable. The player can flip off spectating and take a seat
 * from the Skirmish page afterwards.
 *
 * Pure and testable: the caller resolves the target game's sides/AI list
 * first (see `useRefightSetup`), and supplies which AI fills every converted
 * player slot. Returns `null` for a roster with no seated players (spectator-
 * only or malformed) — nothing to refight.
 */
export function demoInfoToSkirmishDraft(opts: {
  info: DemoInfo;
  /** AIs available for the target game; used only for the fallback pick when
   * `ai` isn't given. */
  ais: SkirmishAi[];
  /** The target game's sides, to validate the replay's recorded faction names
   * (an empty list means "not known yet" — recorded sides are kept as-is and
   * healed later once the Skirmish page's own sides load). */
  sides: Side[];
  /** AI reference to fill every converted player slot. Falls back to a
   * sensible default (skips do-nothing test bots) when omitted or unresolved. */
  ai?: Participant["ai"];
}): SkirmishDraft | null {
  const { info, ais, sides, ai } = opts;
  const fallback = standardAi(ais);
  const chosenAi: Participant["ai"] | undefined =
    ai ??
    (fallback
      ? {
          kind: fallback.kind,
          shortName: fallback.shortName,
          name: fallback.name,
        }
      : undefined);

  const seated = info.players.filter((p) => !p.spectator);
  const bots = info.ais ?? [];
  if (seated.length === 0 && bots.length === 0) return null;

  const you: Participant = {
    id: nextId(),
    kind: "you",
    name: "You",
    side: "",
    color: PALETTE[0],
    allyTeam: 0,
    spectator: true,
  };

  const validSide = new Set(sides.map((s) => s.name));
  // Keep the recorded faction when it's a real one for the target game, or when
  // sides aren't known yet and the Skirmish page will heal an invalid one once
  // its own scan lands. An empty or unrecorded side rolls at launch.
  const keepSide = (side?: string) =>
    side && (sides.length === 0 || validSide.has(side)) ? side : RANDOM_SIDE;

  const opponents: Participant[] = seated.map((p, i) => ({
    id: nextId(),
    kind: "ai",
    name: p.name || `Player ${i + 1}`,
    ai: chosenAi,
    side: keepSide(p.side),
    color: p.rgbColor ?? PALETTE[(i + 1) % PALETTE.length],
    allyTeam: p.allyTeam ?? i,
    spectator: false,
  }));

  // The bots the match was actually played against. Refighting a skirmish
  // against three of them and getting one opponent was the visible half of
  // never parsing `[aiN]` (#1148).
  const installed = new Map(ais.map((a) => [a.shortName.toLowerCase(), a]));
  for (const [i, b] of bots.entries()) {
    const slot = seated.length + i;
    const recorded = installed.get(b.shortName.toLowerCase());
    opponents.push({
      id: nextId(),
      kind: "ai",
      name: b.shortName || b.name || `AI ${i + 1}`,
      ai: recorded
        ? {
            kind: recorded.kind,
            shortName: recorded.shortName,
            name: recorded.name,
          }
        : chosenAi,
      side: keepSide(b.side),
      color: b.rgbColor ?? PALETTE[(slot + 1) % PALETTE.length],
      allyTeam: b.allyTeam ?? slot,
      spectator: false,
    });
  }

  return {
    participants: [you, ...opponents],
    gameName: info.gameType,
    mapName: info.mapName,
    startPosType: info.startPosType ?? 0,
    modOptionValues: { ...info.modOptions },
  };
}

let idSeq = 0;
const nextId = () => `rf${idSeq++}`;
