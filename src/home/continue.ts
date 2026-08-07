import { useCampaignProgress, useCampaigns } from "../campaign/campaigns";
import type { Campaign, ProgressFile } from "../campaign/model";
import { resumeMissionId } from "../campaign/progress";
import { useConquestState, useGalaxies } from "../conquest/conquests";
import type { ConquestStateFile, GalaxyDoc } from "../conquest/model";
import { mostRecentOpen } from "../lib/recency";
import type { Battle, LobbyState } from "../multiplayer/bindings";
import { useMultiplayer } from "../multiplayer/store";
import type { SkirmishPreset } from "../play/presets";
import { useSkirmishPresets } from "../play/presets";
import type { RunStatus } from "../runlite/model";
import { useRuns } from "../runlite/runs";

/** Which part of Coilbox a resume candidate came from. */
export type ResumeKind =
  | "battle"
  | "warpath"
  | "conquest"
  | "campaign"
  | "skirmish";

/**
 * One thing the player could pick up again.
 *
 * The wording lives here rather than in the zones so the Continue hero and the
 * resume rail describe the same run identically, and so a card's copy is decided
 * once whichever slot it lands in.
 */
export interface ResumeCandidate {
  /** Unique across kinds, so a React list can key on it. */
  id: string;
  kind: ResumeKind;
  /** The thing itself: a sector name, a campaign, a battle. */
  title: string;
  /** One line of where you got to. */
  detail: string;
  /** Router path the card goes to. */
  to: string;
  /** When it was last touched, in ms since the epoch. Always finite. */
  touchedAt: number;
  /**
   * When this stops being resumable.
   *
   * Absent means it waits indefinitely, which is true of everything saved to
   * disk. A number is a deadline in ms since the epoch. `"soon"` says the window
   * closes on an event nobody can put a clock on, which is the rejoinable battle:
   * the only signal is the host leaving the match, and no source records when
   * that will be.
   */
  expiresAt?: number | "soon";
}

/** Whether the window is still open at `now`. `"soon"` has not closed yet. */
function stillOpen(c: ResumeCandidate, now: number): boolean {
  return typeof c.expiresAt !== "number" || c.expiresAt > now;
}

/** Whether the window closes at all. Anything with an `expiresAt` pre-empts. */
function timeCritical(c: ResumeCandidate): boolean {
  return c.expiresAt !== undefined;
}

/**
 * Order resume candidates best-first.
 *
 * Two rules:
 *
 * 1. Most recently touched wins, whatever its type. Coming back to Coilbox, the
 *    thing you were doing last is the thing you most likely want.
 * 2. Except that an entry whose window closes pre-empts one that waits. A battle
 *    you can still rejoin beats a Warpath run you touched an hour ago, because
 *    the rejoin window shuts and the run does not.
 *
 * Anything whose window has already shut is dropped rather than sorted, so a
 * closed rejoin cannot be promoted by rule 2 into a slot it no longer deserves.
 * So is anything with an unreadable timestamp, because a `NaN` comparison would
 * put the page in an arbitrary order (campaign progress can carry an empty
 * `updatedAt`, which parses to `NaN`).
 *
 * Equal timestamps keep the order they arrived in. `Array.prototype.sort` is
 * stable, so ties resolve to the fixed order {@link collectCandidates} builds,
 * and the page does not shuffle between renders.
 *
 * Pure, so the ranking is tested without a UI or a mocked hook.
 */
export function rankCandidates(
  candidates: readonly ResumeCandidate[],
  now: number = Date.now(),
): ResumeCandidate[] {
  return candidates
    .filter((c) => Number.isFinite(c.touchedAt) && stillOpen(c, now))
    .sort((a, b) => {
      if (timeCritical(a) !== timeCritical(b)) return timeCritical(a) ? -1 : 1;
      return b.touchedAt - a.touchedAt;
    });
}

/**
 * The fields of a saved run {@link warpathCandidate} reads. A real
 * `RogueliteRun` satisfies it, and a test writes six fields rather than thirty.
 */
export type RunSummary = {
  name: string;
  updatedAt: string;
  settings: { game: { shortname: string } };
  progress: { status: RunStatus; hull: number; maxHull: number };
};

/**
 * The Warpath run to offer: the most recently updated one still in progress.
 *
 * One per source, not one per run. The rail shows at most three runners-up, and
 * three of your own Warpath runs is a worse answer than one of each thing you
 * were doing. `RunListPage` already badges exactly one run for the same reason.
 *
 * Typed against {@link RunSummary}, the handful of fields it reads.
 */
export function warpathCandidate(
  runs: Record<string, RunSummary>,
): ResumeCandidate | undefined {
  const best = mostRecentOpen(
    Object.entries(runs),
    ([, run]) => run.progress.status === "active",
    ([, run]) => Date.parse(run.updatedAt),
  );
  if (!best) return undefined;
  const [id, run] = best;
  const { hull, maxHull } = run.progress;
  return {
    id: `warpath:${id}`,
    kind: "warpath",
    title: run.name,
    // Matches the run card's own subtitle, so the same run reads the same on
    // both screens.
    detail: `${run.settings.game.shortname} · health ${hull}/${maxHull}`,
    to: `/warpath/${encodeURIComponent(id)}`,
    touchedAt: Date.parse(run.updatedAt),
  };
}

/**
 * The campaign mission to offer: the most recently touched campaign that has a
 * mission left hanging mid-attempt, per {@link resumeMissionId}.
 */
export function campaignCandidate(
  campaigns: readonly { campaign: Campaign }[],
  progress: ProgressFile,
): ResumeCandidate | undefined {
  const entries = campaigns.flatMap(({ campaign }) => {
    const saved = progress.campaigns[campaign.id];
    const missionId = resumeMissionId(campaign, saved);
    if (!missionId || !saved) return [];
    const mission = campaign.missions.find((m) => m.id === missionId);
    if (!mission) return [];
    return [{ campaign, mission, touchedAt: Date.parse(saved.updatedAt) }];
  });
  const best = mostRecentOpen(
    entries,
    (e) => Number.isFinite(e.touchedAt),
    (e) => e.touchedAt,
  );
  if (!best) return undefined;
  return {
    id: `campaign:${best.campaign.id}`,
    kind: "campaign",
    title: best.campaign.title,
    detail: best.mission.title,
    to: `/campaign/${encodeURIComponent(best.campaign.id)}/${encodeURIComponent(best.mission.id)}`,
    touchedAt: best.touchedAt,
  };
}

/**
 * The conquest to offer: the most recently updated galaxy whose run is active.
 *
 * Only the galaxy's name is read, so this takes the two fields it needs and a
 * real `LoadedGalaxy[]` still satisfies it.
 */
export function conquestCandidate(
  galaxies: readonly { galaxy: Pick<GalaxyDoc, "id" | "title"> }[],
  file: ConquestStateFile,
): ResumeCandidate | undefined {
  const best = mostRecentOpen(
    galaxies,
    (g) => file.conquests[g.galaxy.id]?.status === "active",
    (g) => Date.parse(file.conquests[g.galaxy.id]?.updatedAt ?? ""),
  );
  if (!best) return undefined;
  const state = file.conquests[best.galaxy.id];
  if (!state) return undefined;
  return {
    id: `conquest:${best.galaxy.id}`,
    kind: "conquest",
    title: best.galaxy.title,
    detail: `Turn ${state.turn}`,
    to: `/conquest/${encodeURIComponent(best.galaxy.id)}`,
    touchedAt: Date.parse(state.updatedAt),
  };
}

/**
 * The four fields of the lobby mirror {@link battleCandidate} reads. A real
 * `LobbyState` satisfies it, and a test writes four fields rather than forty.
 */
export type LobbySnapshot = Pick<LobbyState, "myUsername" | "currentBattle"> & {
  battles: Record<string, Pick<Battle, "host" | "title">>;
  users: Record<string, { status: { ingame: boolean } }>;
};

/**
 * The battle to offer: the one you are in, whose host is in the match.
 *
 * The host going in-game is what starts a match, so a host in-game while you are
 * still in the lobby means the match is running without you and the battle room's
 * Rejoin banner (#979) is what you want. That banner also checks that your own
 * engine has exited and that the map and game are installed, which are questions
 * only the battle room can answer. Those gate the launch rather than the offer,
 * so the card still points you at the room and the room decides.
 *
 * Nothing about this is persisted, so it exists only while the lobby snapshot
 * says so, and it vanishes on its own the moment the host leaves the match.
 */
export function battleCandidate(
  state: LobbySnapshot | null,
  now: number,
): ResumeCandidate | undefined {
  if (!state || state.currentBattle == null) return undefined;
  const battle = state.battles[String(state.currentBattle)];
  if (!battle) return undefined;
  // Hosting it ourselves means we start the match rather than rejoin it.
  if (battle.host === state.myUsername) return undefined;
  if (!state.users[battle.host]?.status.ingame) return undefined;
  return {
    id: `battle:${state.currentBattle}`,
    kind: "battle",
    title: battle.title,
    detail: `Match in progress · hosted by ${battle.host}`,
    to: "/battle",
    // The match is running as we look at it, so "now" is when it was touched.
    // Only ever compared against another closing window, of which there is one.
    touchedAt: now,
    expiresAt: "soon",
  };
}

/**
 * The skirmish setup to offer: the most recently used saved preset.
 *
 * The working draft under `play.skirmish` would be the truer answer, but it
 * records no timestamp, so it cannot be ranked against a run you touched
 * yesterday. Presets carry `lastUsedAt`, stamped on save and on load, so they
 * can. Giving the draft a timestamp is new persistence and out of scope here.
 */
export function skirmishCandidate(
  presets: readonly SkirmishPreset[],
): ResumeCandidate | undefined {
  const best = mostRecentOpen(
    presets,
    (p) => Number.isFinite(Date.parse(p.lastUsedAt)),
    (p) => Date.parse(p.lastUsedAt),
  );
  if (!best) return undefined;
  return {
    id: `skirmish:${best.id}`,
    kind: "skirmish",
    title: best.name,
    detail: `${best.gameName} on ${best.mapName}`,
    to: "/play/skirmish",
    touchedAt: Date.parse(best.lastUsedAt),
  };
}

/** Everything {@link collectCandidates} reads, gathered by {@link useResume}. */
export interface ResumeSources {
  runs: Record<string, RunSummary>;
  campaigns: readonly { campaign: Campaign }[];
  progress: ProgressFile;
  galaxies: readonly { galaxy: Pick<GalaxyDoc, "id" | "title"> }[];
  conquests: ConquestStateFile;
  lobby: LobbySnapshot | null;
  presets: readonly SkirmishPreset[];
}

/**
 * Build one candidate per source, in a fixed order.
 *
 * The order is the tiebreak {@link rankCandidates} falls back on, so it is
 * deliberate: the live battle first, then the saved games of play, then the
 * setup screen. A source with nothing to resume contributes nothing, which is
 * every source on a fresh install.
 *
 * Pure, so "this source is absent" is a unit test rather than a mocked hook.
 */
export function collectCandidates(
  sources: ResumeSources,
  now: number = Date.now(),
): ResumeCandidate[] {
  return [
    battleCandidate(sources.lobby, now),
    warpathCandidate(sources.runs),
    conquestCandidate(sources.galaxies, sources.conquests),
    campaignCandidate(sources.campaigns, sources.progress),
    skirmishCandidate(sources.presets),
  ].filter((c): c is ResumeCandidate => c !== undefined);
}

/**
 * Everything the player could pick up again, best first.
 *
 * The shared collector for milestone 16's Continue zone (#993), which takes
 * `candidates[0]`, and the resume rail (#994), which takes the next three. The
 * greeting asks it whether there is anything at all. Zones never read each
 * other's state, so they all come through here.
 *
 * `loading` is true until every source stored on disk has answered. A zone that
 * renders on the first frame would otherwise show an empty rail and then fill it.
 *
 * No memo: five candidates and a sort is less work than the bookkeeping, and a
 * dependency array would have to lie about `Date.now()`.
 */
export function useResume(): {
  candidates: ResumeCandidate[];
  loading: boolean;
} {
  const runs = useRuns();
  const campaigns = useCampaigns();
  const progress = useCampaignProgress();
  const galaxies = useGalaxies();
  const conquests = useConquestState();
  const { presets } = useSkirmishPresets();
  const { mirror } = useMultiplayer();

  const now = Date.now();
  const candidates = rankCandidates(
    collectCandidates(
      {
        runs: runs.runs,
        campaigns: campaigns.campaigns,
        progress: progress.progress,
        galaxies: galaxies.galaxies,
        conquests: conquests.file,
        lobby: mirror.state,
        presets,
      },
      now,
    ),
    now,
  );

  const loading =
    runs.loading ||
    campaigns.loading ||
    progress.loading ||
    galaxies.loading ||
    conquests.loading;

  return { candidates, loading };
}
