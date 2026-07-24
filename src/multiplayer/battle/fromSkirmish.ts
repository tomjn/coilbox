import { resolveGameAi } from "@/conquest/ai";
import type { Side, SkirmishAi } from "@/content/bindings";
import type { SkirmishDraft } from "@/play/drafts";
import {
  effectiveTeams,
  resolveRandomSides,
  rgbToHex,
} from "@/play/participants";
import { MODOPT_PREFIX, STARTPOSTYPE_KEY } from "./battleOptions";
import { restrictTagsFor } from "./restrictTags";

/**
 * One bot to add via `mp_add_bot` once the hosted room is open. Colour stays a
 * hex core (`#rrggbb`) here, like everywhere else pre-wire. The lobby's
 * `0xBBGGRR` int only exists at the actual `mpAddBot` call site.
 */
export interface HostSeedBot {
  name: string;
  aiDll: string;
  side: number;
  colorHex: string;
  teamId: number;
  ally: number;
  handicap: number;
}

/** The host's own seat, taken from the draft's "you" participant. */
export interface HostSeedSelf {
  side: number;
  colorHex: string;
  teamId: number;
  ally: number;
  spectator: boolean;
}

export interface HostSeed {
  /** Mod/map options, start-pos type and unit restrictions, as script tags
   * ready for `mpSetScriptTags`/`applyOptionTags`. */
  scriptTags: Record<string, string>;
  self: HostSeedSelf;
  /** Bots to add via `mp_add_bot` once the room is open, in draft order. */
  bots: HostSeedBot[];
  /**
   * Participants that were neither "you" nor a resolvable AI, dropped rather
   * than turned into a bot, leaving their team/side open for a real player.
   * Zero for any draft built through the Singleplayer UI (see below). Only a
   * hand-edited or imported preset file can produce this.
   */
  openSlots: number;
  /** `kind: "ai"` participants for which no usable AI exists in the hosted
   * game at all (not even a fallback). Can't run as a bot, so skipped. */
  unresolvedAiCount: number;
}

/**
 * The forward bridge from a singleplayer `SkirmishDraft` (a skirmish preset,
 * or the page's current setup) to what hosting it online needs: the option,
 * start-pos-type and unit-restriction script tags to apply once the room is
 * open, the host's own seat, and the bots to add via `mp_add_bot`. Mirrors
 * `battleToSkirmishDraft`'s structure (same `sides` input, for resolving a
 * side name to the numeric index the lobby wire uses), but runs the other
 * way, and is called at the same point in the flow: once the live battle's
 * sides and addable AIs are known (`BattleRoomPage`), not before.
 *
 * A skirmish draft's participant model only ever has one possible human,
 * "you", at index 0. Every other participant is already `kind: "ai"` (a live
 * MP battle saved as a preset already downgraded other humans to AIs when it
 * was captured, see `battleToSkirmishDraft`). So there is no "other human" to
 * convert here in practice. The forward direction just:
 *  - turns "you" into the host's own battle seat (the person doing the
 *    hosting is that human), a spectator "you" hosts as a spectator, and
 *  - turns every `kind: "ai"` participant into a bot, keeping its team, ally,
 *    side, colour and handicap.
 * A preset's game and the hosted game are not guaranteed to be the same
 * install, so the preset's chosen AI might not exist in the hosted game's AI
 * list at all (a live-tested bug this fixes: hosting a preset saved against a
 * different game was adding bots with an AI the hosted game never offered).
 * So each participant's AI is resolved through `resolveGameAi` against the
 * game's own addable AI list (`ais`, the same list the battle room's Add AI
 * dropdown shows): kept if still available there, otherwise remapped to that
 * list's own sensible default. Only when the game has no usable AI at all
 * does a participant go unresolved, counted in `unresolvedAiCount`. A
 * participant that is neither "you" nor `kind: "ai"`, only reachable via a
 * hand-edited or imported preset file (only shallow-validated, see
 * `parsePresetJson`), is treated defensively as a human: dropped rather than
 * added as a bot, counted in `openSlots`, so its team/side is simply left
 * open for a real player to claim after joining rather than being silently
 * turned into a bot.
 *
 * `restrictions.advantage` and `incomeMultiplier` (warpath/conquest per-team
 * perks) have no lobby equivalent, there is no script tag for them, so they
 * are dropped. Only `disabledUnits` carries over, as `game/restrict/*` tags.
 *
 * Pure: the caller resolves the target battle's sides and addable AIs first,
 * mirroring `battleToSkirmishDraft`.
 */
export function draftToHostSeed(opts: {
  draft: SkirmishDraft;
  sides: Side[];
  /** The hosted game's own addable AIs (native + Lua, already validais-filtered). */
  ais: Pick<SkirmishAi, "shortName">[];
  /** 0..1 source for resolving `RANDOM_SIDE` participants, injectable for tests. */
  roll?: () => number;
}): HostSeed {
  const { draft, sides, ais, roll } = opts;
  const resolved = resolveRandomSides(draft.participants, sides, roll);

  const sideIndex = (name: string): number => {
    if (!name) return 0;
    const i = sides.findIndex((s) => s.name === name);
    return i >= 0 ? i : 0;
  };

  const { teamIndexById } = effectiveTeams(resolved);

  const you = resolved.find((p) => p.kind === "you");
  const self: HostSeedSelf = you
    ? {
        side: sideIndex(you.side),
        colorHex: rgbToHex(you.color),
        teamId: teamIndexById.get(you.id) ?? 0,
        ally: you.allyTeam,
        spectator: you.spectator,
      }
    : { side: 0, colorHex: "#ffffff", teamId: 0, ally: 0, spectator: true };

  const bots: HostSeedBot[] = [];
  let openSlots = 0;
  let unresolvedAiCount = 0;
  for (const p of resolved) {
    if (p === you) continue;
    if (p.kind !== "ai") {
      // Defensive only: a real draft can't produce a second human.
      openSlots++;
      continue;
    }
    const resolvedAi = resolveGameAi(p.ai, ais);
    if (!resolvedAi) {
      unresolvedAiCount++;
      continue;
    }
    bots.push({
      name: p.name,
      aiDll: resolvedAi.shortName,
      side: sideIndex(p.side),
      colorHex: rgbToHex(p.color),
      teamId: teamIndexById.get(p.id) ?? 0,
      ally: p.allyTeam,
      handicap: p.handicap ?? 0,
    });
  }

  const scriptTags: Record<string, string> = {
    [STARTPOSTYPE_KEY]: String(draft.startPosType),
  };
  for (const [k, v] of Object.entries(draft.modOptionValues)) {
    scriptTags[`${MODOPT_PREFIX}${k}`] = v;
  }
  const disabledUnits = draft.restrictions?.disabledUnits;
  if (disabledUnits && disabledUnits.length > 0) {
    Object.assign(scriptTags, restrictTagsFor(disabledUnits));
  }

  return { scriptTags, self, bots, openSlots, unresolvedAiCount };
}
