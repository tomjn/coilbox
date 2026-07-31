import type { Side, SkirmishAi } from "@/content/bindings";
import type { BattleRestrictions, SkirmishDraft } from "@/play/drafts";
import { standardAi } from "@/play/gameAi";
import { hexToRgb, PALETTE, type Participant } from "@/play/participants";
import type { Battle, User } from "../bindings";
import { MODOPT_PREFIX } from "./battleOptions";
import { colorIntToHex, startPosTypeOf } from "./config";
import { disabledFromTags } from "./restrictTags";

/**
 * Convert a live multiplayer battle into a launchable singleplayer `SkirmishDraft`
 * so the player can save it and refight it solo later. This is the one real
 * transform in the "save any battle as a preset" feature (conquest/warpath already
 * produce a `SkirmishDraft`):
 *
 * - A skirmish has one human ("you") and AIs, so every *other* human becomes an AI
 *   opponent/ally on a real playing AI (the conquest fallback pool skips do-nothing
 *   bots), keeping their team/ally/side/colour. Human spectators aren't combatants,
 *   so they're dropped.
 * - Bots map to an AI reference resolved from the local AI list by their `aiDll`
 *   shortname (so native vs game-Lua is preserved); an unresolved bot falls back to
 *   a known-good AI so the replay still launches.
 * - Colour crosses the lobby's `0xBBGGRR` int space to play's 0..1 float RGB
 *   **through hex** (`colorIntToHex` → `hexToRgb`) — the two spaces are never crossed
 *   directly.
 * - `side` is a lobby integer index; it resolves to the game's side *name* (empty =
 *   engine default when the side list isn't available locally).
 * - Host unit restrictions (`game/restrict/*`) carry over as the faithful-replay
 *   disabled-unit set.
 *
 * Pure: the caller resolves the game's sides and skirmish AI list first.
 */

let idSeq = 0;
const nextId = () => `mp${idSeq++}`;

/** Resolve a bot's `aiDll` shortname against the local AI list, preserving kind. */
function aiByShortName(
  ais: SkirmishAi[],
  shortName: string,
): Participant["ai"] | undefined {
  const found = ais.find(
    (a) => a.shortName.toLowerCase() === shortName.toLowerCase(),
  );
  return found
    ? { kind: found.kind, shortName: found.shortName, name: found.name }
    : undefined;
}

export function battleToSkirmishDraft(opts: {
  battle: Battle;
  me: string | null;
  users?: Record<string, User>;
  sides: Side[];
  ais: SkirmishAi[];
}): SkirmishDraft {
  const { battle, me, sides, ais } = opts;
  const sideName = (i: number) => sides[i]?.name ?? "";
  const colorOf = (int: number) => hexToRgb(colorIntToHex(int));
  const fallbackAi = standardAi(ais);

  // "You" is the logged-in member; if absent (e.g. an autohost battle we only
  // spectate), a spectator "you" keeps the draft valid without a phantom combatant.
  const self = me ? battle.members[me] : undefined;
  const you: Participant = self
    ? {
        id: nextId(),
        kind: "you",
        name: me ?? "You",
        side: sideName(self.battleStatus.side),
        color: colorOf(self.teamColor),
        allyTeam: self.battleStatus.ally,
        spectator: !self.battleStatus.mode,
        handicap:
          self.battleStatus.handicap > 0
            ? self.battleStatus.handicap
            : undefined,
      }
    : {
        id: nextId(),
        kind: "you",
        name: me ?? "You",
        side: "",
        color: PALETTE[0],
        allyTeam: 0,
        spectator: true,
      };

  const opponents: Participant[] = [];
  for (const [name, m] of Object.entries(battle.members)) {
    if (name === me) continue;
    const bs = m.battleStatus;
    if (!bs.mode) continue; // human spectator — not a combatant
    opponents.push({
      id: nextId(),
      kind: "ai",
      name,
      ai: fallbackAi,
      side: sideName(bs.side),
      color: colorOf(m.teamColor),
      allyTeam: bs.ally,
      spectator: false,
      handicap: bs.handicap > 0 ? bs.handicap : undefined,
    });
  }
  for (const [name, b] of Object.entries(battle.bots)) {
    const bs = b.battleStatus;
    if (!bs.mode) continue;
    opponents.push({
      id: nextId(),
      kind: "ai",
      name,
      ai: aiByShortName(ais, b.aiDll) ?? fallbackAi,
      side: sideName(bs.side),
      color: colorOf(b.teamColor),
      allyTeam: bs.ally,
      spectator: false,
      handicap: bs.handicap > 0 ? bs.handicap : undefined,
    });
  }

  const modOptionValues: Record<string, string> = {};
  for (const [k, v] of Object.entries(battle.scriptTags)) {
    if (k.toLowerCase().startsWith(MODOPT_PREFIX)) {
      modOptionValues[k.slice(MODOPT_PREFIX.length)] = v;
    }
  }

  const disabledUnits = disabledFromTags(battle.scriptTags);
  const restrictions: BattleRestrictions | undefined =
    disabledUnits.length > 0 ? { disabledUnits } : undefined;

  return {
    participants: [you, ...opponents],
    gameName: battle.modname,
    mapName: battle.map,
    startPosType: startPosTypeOf(battle),
    modOptionValues,
    ...(restrictions ? { restrictions } : {}),
  };
}
