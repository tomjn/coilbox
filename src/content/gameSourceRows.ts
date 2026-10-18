import {
  type DownloadHistory,
  type DownloadRecord,
  hostOf,
  recordsFor,
} from "../downloads/downloadHistory";
import {
  type GamePrefsStore,
  pinnedSource,
  sameStep,
} from "../downloads/gamePrefs";
import type { RapidMaster } from "../downloads/rapidMasters";
import type { SourceStep } from "../downloads/sourceWalk";
import type { LibraryGame } from "./library";
import { gameKeys, hubDownloadStep } from "./libraryGames";

/** One row of the game page's Sources tab (issue #4580). */
export interface GameSourceRow {
  /** What a pin on this row stores. */
  step: SourceStep;
  label: "Rapid" | "GitHub" | "Springfiles" | "Direct";
  /** The host or the repository. */
  where: string | null;
  /** What the source would fetch. */
  fetches: string;
  /** The latest download this source made for the game, or null when none. */
  last: DownloadRecord | null;
  pinned: boolean;
}

export interface GameSourceInput {
  game: LibraryGame;
  /** The game's repo in the branding catalog, when it has one. */
  catalogRepo?: string | null;
  /** The rapid masters a download by name walks. */
  masters: readonly RapidMaster[];
  history: DownloadHistory;
  prefs: GamePrefsStore;
}

const lc = (s: string) => s.toLowerCase();

/**
 * The sources a download of the game walks, in order: the hub's downloads in
 * the hub's order, the branding catalog's GitHub repo, the springfiles archive,
 * then each rapid master when the hub names no rapid tag. A pinned source moves
 * to the front.
 *
 * The last result is read from the download history, so a source shows only
 * what a download the player started found. Nothing here asks a mirror.
 */
export function gameSourceRows(input: GameSourceInput): GameSourceRow[] {
  const { game, history } = input;
  const records = recordsFor(history, ...gameKeys(game));
  const newest = (match: (r: DownloadRecord) => boolean) =>
    records.find(match) ?? null;
  const fromRepo = (repo: string) => (r: DownloadRecord) =>
    r.source === "github" ||
    (r.source === "url" &&
      !!r.reference &&
      lc(r.reference).includes(`github.com/${lc(repo)}/`));
  const pin = pinnedSource(input.prefs, ...gameKeys(game));
  const rows: Omit<GameSourceRow, "pinned">[] = [];
  const hub = game.hub?.downloads ?? [];
  const defaultHost = input.masters[0] ? hostOf(input.masters[0].url) : null;

  for (const d of hub) {
    const step = hubDownloadStep(d);
    if (d.kind === "rapid") {
      rows.push({
        step,
        label: "Rapid",
        where: defaultHost,
        fetches: d.value,
        last: newest((r) => r.source === "rapid" && r.reference === d.value),
      });
    } else if (d.kind === "github") {
      rows.push({
        step,
        label: "GitHub",
        where: d.value,
        fetches: d.asset
          ? `${d.asset} from the newest release`
          : "the newest release archive",
        last: newest(fromRepo(d.value)),
      });
    } else {
      rows.push({
        step,
        label: "Direct",
        where: step.mirror,
        fetches: d.filename ?? d.value,
        last: newest((r) => r.source === "url" && r.reference === d.value),
      });
    }
  }

  const repo = input.catalogRepo;
  if (repo && !hub.some((d) => d.kind === "github")) {
    rows.push({
      step: { source: "github", mirror: null },
      label: "GitHub",
      where: repo,
      fetches: "the release archive for the version asked for",
      last: newest(fromRepo(repo)),
    });
  }

  const springfiles = game.sources.filter((s) => s.kind === "springfiles");
  if (springfiles.length > 0) {
    const best = springfiles.find((s) => !s.installed) ?? springfiles[0];
    const mirrors = best.mirrors?.length ?? 0;
    rows.push({
      step: { source: "springfiles", mirror: null },
      label: "Springfiles",
      where: best.url ? hostOf(best.url) : null,
      fetches: `${best.filename} · ${mirrors} mirror${mirrors === 1 ? "" : "s"}`,
      last: newest((r) => r.source === "springfiles"),
    });
  }

  if (!hub.some((d) => d.kind === "rapid")) {
    const name = game.installed[0]?.name ?? game.title;
    for (const m of input.masters) {
      const host = hostOf(m.url);
      rows.push({
        step: { source: "rapid", mirror: host },
        label: "Rapid",
        where: host,
        fetches: name,
        last: newest((r) => r.source === "rapid" && r.mirror === host),
      });
    }
  }

  const marked = rows.map((r) => ({ ...r, pinned: sameStep(pin, r.step) }));
  return [
    ...marked.filter((r) => r.pinned),
    ...marked.filter((r) => !r.pinned),
  ];
}
