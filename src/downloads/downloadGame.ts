import { loadGithubGameRepos } from "../content/branding";
import { dlDownloadFileRaw, dlDownloadRaw } from "./bindings";
import { type DownloadAttempt, downloadKey, hostOf } from "./downloadHistory";
import { downloadFromMirrors } from "./downloadMirrors";
import { withDownloadNotify } from "./downloadNotify";
import { pinnedSource, readGamePrefs } from "./gamePrefs";
import {
  GAME_REPOS,
  githubRepoForGame,
  mergeGameRepos,
  norm,
} from "./gameRepos";
import { type GameSource, gameSourceOrder } from "./gameSources";
import { loadGithubReleases } from "./githubReleases";
import { findInIndex, indexTick, loadSpringfilesList } from "./mirrorIndex";
import { type ProgressSink, progressChannel } from "./progressChannel";
import { DEFAULT_RAPID_MASTERS } from "./rapidMasters";
import {
  AttemptLog,
  isCancel,
  nextKind,
  orderFrom,
  type SourceStep,
  SourceWalkError,
} from "./sourceWalk";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Download a game, trying each source in the order set by gameSourceOrder and
 * resolving with the name of the first that succeeds. Per project policy (issue
 * 500) that order is GitHub releases and known mirrors first, then pr-downloader
 * (rapid) as the last resort.
 *
 * 1. curated GitHub releases. Some games such as SplinterFaction ship only via
 *    GitHub release archives, which pr-downloader cannot reach at all.
 * 2. springfiles catalog mirror. A direct mirror download for non-rapid games,
 *    trying each of the entry's mirrors in turn until one delivers (issue #4577).
 * 3. rapid via pr-downloader. The download-game flag resolves the long name to a
 *    tag against the master index (this is how BAR ships), so we pass the game
 *    modname straight through.
 *
 * Steps 1 and 2 need a write root. Without one only rapid is attempted. Throws
 * with every attempted source error when all fail.
 *
 * The GitHub repo per game comes from the unified registry (issue #512): the
 * branding catalog is authoritative, `GAME_REPOS` in `gameRepos.ts` is the
 * in-code fallback seed. See `mergeGameRepos`.
 *
 * The springfiles index comes from `mirrorIndex`, which holds it for the
 * session. A game missing from it refetches it once, unless the held copy loaded
 * after `askedAt`, when the download was asked for.
 *
 * Progress arrives as a sink rather than a channel, because each attempt needs a
 * channel of its own: see `progressChannel` for what sharing one costs.
 *
 * A source the player pinned on the game's page goes first (issue #4580). A
 * pinned rapid master is tried before the other masters.
 */
async function downloadGameAnySourceImpl(opts: {
  gameName: string;
  writePath?: string;
  /** Pass a stable id to make the active download cancellable via dlCancel. */
  opId?: string;
  onProgress: ProgressSink;
  /** The `indexTick` when the download was asked for. Defaults to now. */
  askedAt?: number;
  /** Told about each source tried, whether it worked or not (issue #4576). */
  onAttempt?: (attempt: DownloadAttempt) => void;
  /** Skip the sources before this one, for a retry on the next (issue #4577). */
  startAt?: SourceStep;
  /** Told which source each attempt is on as it starts (issue #4583). */
  onSource?: (step: SourceStep) => void;
}): Promise<string> {
  const { gameName, writePath, opId, onProgress, startAt } = opts;
  const askedAt = opts.askedAt ?? indexTick();
  const target = norm(gameName);
  const log = new AttemptLog(opts.onAttempt, opts.onSource);

  // The unified GitHub game-repo registry (issue #512): the catalog is
  // authoritative once loaded, the in-code GAME_REPOS list is the fallback seed.
  const repos = mergeGameRepos(await loadGithubGameRepos(), GAME_REPOS);

  const pin = pinnedSource(readGamePrefs(), downloadKey("game", gameName));
  const order = gameSourceOrder({
    hasGithubRepo: !!githubRepoForGame(repos, gameName),
    hasWritePath: !!writePath,
    pinned: pin?.source,
  });
  const masters =
    pin?.source === "rapid" && pin.mirror
      ? [
          ...DEFAULT_RAPID_MASTERS.filter((m) => hostOf(m.url) === pin.mirror),
          ...DEFAULT_RAPID_MASTERS.filter((m) => hostOf(m.url) !== pin.mirror),
        ]
      : DEFAULT_RAPID_MASTERS;

  /** Fetch a file from its mirrors, and say which kind of source it was. */
  const fetchFile = async (
    source: GameSource,
    urls: readonly string[],
    filename: string,
    label: string,
  ): Promise<string | null> =>
    (await downloadFromMirrors({
      source,
      urls,
      destDir: `${writePath}/games`,
      filename,
      opId,
      onProgress,
      log,
      startAt,
      afterSource: nextKind(order, source),
    }))
      ? label
      : null;

  const attempt = async (source: GameSource): Promise<string | null> => {
    switch (source) {
      // Curated GitHub releases: resolve a known repo from the game name and
      // fetch its exact-matching release archive.
      case "github": {
        const repo = githubRepoForGame(repos, gameName);
        if (!repo || !writePath) return null;
        const archives = await loadGithubReleases(repo);
        // No releases at all: this source genuinely has nothing, same as any
        // other step finding no candidate. Move on to the next source.
        if (archives.length === 0) return null;
        const hit = archives.find((a) => norm(a.filename) === target);
        // Releases exist but none matches the requested version. Only the
        // most recent 30 are fetched (`dl_github_release_archives`), so the
        // one asked for may have aged off, been renamed, or been deleted.
        // Throwing here (rather than falling back to the newest release) is
        // what issue #2859 is about: silently installing a different version
        // than the one asked for still reported success, and the wrong
        // version could never satisfy the battle room's exact-name check
        // afterwards. Other sources still get a chance further down the loop.
        if (!hit) {
          throw new Error(
            `${repo} has no release matching "${gameName}" in its latest ${archives.length} release(s) (newest: ${archives[0].filename})`,
          );
        }
        log.begin("github", {
          reference: hit.tag,
          filename: hit.filename,
          mirror: hostOf(hit.url),
        });
        await dlDownloadFileRaw({
          url: hit.url,
          destDir: `${writePath}/games`,
          filename: hit.filename,
          opId,
          onProgress: progressChannel(onProgress),
        });
        return "github release";
      }
      // springfiles catalog: match by springname or name, then try each mirror.
      case "springfiles": {
        if (!writePath) return null;
        const found = await findInIndex(
          (refresh) => loadSpringfilesList("game", refresh),
          ({ results }) =>
            results.find(
              (f) => norm(f.springname) === target || norm(f.name) === target,
            ),
          askedAt,
        );
        if (!found?.mirrors?.length) return null;
        return fetchFile(
          source,
          found.mirrors,
          found.filename,
          "springfiles mirror",
        );
      }
      // rapid: pr-downloader resolves the long name to a tag via the master
      // index. The last resort.
      //
      // Every configured master is tried, because pr-downloader only ever
      // searches the one it is given and games are spread across several.
      // Beyond All Reason's master is no longer one of them (see
      // `rapidMasters.ts`), so BAR itself now comes back as "no source could
      // provide" here.
      case "rapid": {
        for (const master of masters) {
          log.begin(
            source,
            { reference: gameName, mirror: hostOf(master.url) },
            { label: master.name },
          );
          try {
            await dlDownloadRaw({
              tag: gameName,
              masterUrl: master.url,
              writePath,
              opId,
              onProgress: progressChannel(onProgress),
            });
            return "rapid";
          } catch (e) {
            if (isCancel(e)) throw e;
            log.fail(e);
          }
        }
        return null;
      }
    }
  };

  for (const source of orderFrom(order, startAt)) {
    log.begin(source);
    try {
      const result = await attempt(source);
      if (result) {
        log.ok();
        return result;
      }
    } catch (e) {
      if (e instanceof SourceWalkError) throw e;
      if (isCancel(e))
        throw new SourceWalkError(msg(e), nextKind(order, source));
      log.fail(e);
    }
  }

  throw new SourceWalkError(
    `No source could provide "${gameName}". ${log.errors.join("; ")}`,
    null,
  );
}

export const downloadGameAnySource = withDownloadNotify(
  downloadGameAnySourceImpl,
  (o) => o.gameName,
);
