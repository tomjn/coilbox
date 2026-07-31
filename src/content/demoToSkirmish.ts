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
 * A decoded replay carries no live "you": every seated player it recorded
 * becomes an AI opponent (a replay can't tell a human from a bot — `DemoInfo`
 * doesn't parse `[AIn]` sections yet — so this treats every non-spectator
 * player alike). "You" is seeded as a spectator placeholder, same as
 * `battleToSkirmishDraft`'s no-self branch, so the draft stays launchable; the
 * player can flip off spectating and take a seat from the Skirmish page
 * afterwards.
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
  if (seated.length === 0) return null;

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
  const opponents: Participant[] = seated.map((p, i) => ({
    id: nextId(),
    kind: "ai",
    name: p.name || `Player ${i + 1}`,
    ai: chosenAi,
    // Keep the recorded faction when it's a real one for the target game (or
    // sides aren't known yet, in which case the Skirmish page heals an invalid
    // one once its own scan lands); an empty/unrecorded side rolls at launch.
    side:
      p.side && (sides.length === 0 || validSide.has(p.side))
        ? p.side
        : RANDOM_SIDE,
    color: p.rgbColor ?? PALETTE[(i + 1) % PALETTE.length],
    allyTeam: p.allyTeam ?? i,
    spectator: false,
  }));

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
