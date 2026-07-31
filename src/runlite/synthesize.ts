import type { SkirmishAi } from "../content/bindings";
import type { SkirmishDraft } from "../play/drafts";
import { aiForDifficulty, type GameAiConfig, isNeverAi } from "../play/gameAi";
import { PALETTE, type Participant, resolveAi } from "../play/participants";
import type { RogueliteRun, RunNode } from "./model";

/**
 * Turn a run's battle node into a launchable {@link SkirmishDraft} — the same
 * shape conquest and campaign produce, so everything downstream (toBattleConfig,
 * launch, result detection) is shared. Pure: the caller resolves the installed
 * game + AI list first. A run has no factions, so the player flies blue against
 * a red enemy line; the enemy count/handicap come baked on the encounter.
 */

let idSeq = 0;
const nextId = () => `rl${idSeq++}`;

const toRef = (a?: SkirmishAi): Participant["ai"] | undefined =>
  a ? { kind: a.kind, shortName: a.shortName, name: a.name } : undefined;

/** Resolve the enemy AI: the encounter's authored key wins (unless it names a
 * banned bot), else the AI this run's difficulty calls for. */
function enemyAi(
  run: RogueliteRun,
  node: RunNode,
  ais: SkirmishAi[],
  config?: GameAiConfig,
): Participant["ai"] | undefined {
  const key = node.battle?.enemyAiKey;
  const fromKey = key ? resolveAi(key, ais) : undefined;
  if (fromKey && !isNeverAi(fromKey, config)) return fromKey;
  return toRef(aiForDifficulty(run.settings.difficulty, ais, config));
}

export function synthesizeEncounter(
  run: RogueliteRun,
  node: RunNode,
  opts: {
    playerName: string;
    /** Exact installed game archive name (resolved from `run.settings.game`). */
    gameName: string;
    ais: SkirmishAi[];
    /** The game's AI catalogue, from branding and the profile. */
    aiConfig?: GameAiConfig;
  },
): SkirmishDraft | null {
  const spec = node.battle;
  if (!spec) return null;
  const ai = enemyAi(run, node, opts.ais, opts.aiConfig);

  const you: Participant = {
    id: nextId(),
    kind: "you",
    name: opts.playerName,
    side: run.settings.side ?? "",
    color: PALETTE[1], // blue
    allyTeam: 0,
    spectator: false,
  };
  const enemies: Participant[] = Array.from(
    { length: spec.enemyAiCount },
    (_, i) => ({
      id: nextId(),
      kind: "ai" as const,
      name: `Hostile ${i + 1}`,
      ai,
      side: "",
      color: PALETTE[0], // red
      allyTeam: 1,
      spectator: false,
      handicap: spec.handicap > 0 ? spec.handicap : undefined,
    }),
  );

  return {
    participants: [you, ...enemies],
    gameName: opts.gameName,
    mapName: spec.mapName,
    startPosType: spec.startPosType ?? 0,
    modOptionValues: spec.modOptionValues ?? {},
  };
}
