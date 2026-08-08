import { useCallback, useEffect, useState } from "react";
import { dlInstalledContent } from "../downloads/bindings";
import { useContentRootPaths } from "../downloads/config";
import { usePreferredTarget } from "../play/config";
import { getGameMatcher } from "../profile/profile";
import {
  type SuggestedGame,
  type SuggestedMap,
  useBrandingCatalog,
  useSuggestedGames,
  useSuggestedMaps,
} from "./branding";
import { useSetupStatus, useUnitsyncScan } from "./config";
import { getStartedCandidates } from "./pages/components/getStartedCandidates";
import { scanSettled } from "./scanSettled";
import { filterSuggestedGamesByFilter } from "./suggestedGames";

/** The downloads the get-started card is offering, by kind. */
export interface GetStartedOffer {
  games: SuggestedGame[];
  maps: SuggestedMap[];
}

/** An installed-content listing: what is on disk, by kind. */
export interface InstalledContent {
  games: Set<string>;
  maps: Set<string>;
}

/** What the collector knows. */
export interface GetStartedOfferState {
  /**
   * Exactly the lists `GetStartedCard` will draw, or `null` while that cannot be
   * answered yet. Two empty lists mean the card draws nothing.
   */
  offer: GetStartedOffer | null;
  /**
   * The installed listing the offer was read against, which the packs banner
   * needs too. `null` until something has actually been read.
   */
  installed: InstalledContent | null;
  /** Re-read the installed listing, after a download lands. */
  refresh: () => Promise<void>;
}

/** One object for "offering nothing", so a definite no is the same answer each render. */
const OFFERS_NOTHING: GetStartedOffer = { games: [], maps: [] };

/**
 * What the first-run get-started offer comes to, for everyone who needs to know.
 *
 * The shared collector for two readers: `GetStartedCard`, which draws the offer,
 * and the home page, which has to know whether onboarding is offering maps before
 * it can decide where the suggested map card goes (issue #1109). The alternative
 * was a second predicate saying "onboarding is probably offering maps about now",
 * written against the same catalog and the same two inventories, and two
 * predicates over one question drift. Same reason `useResume` exists (see
 * `../home/continue`): the zones and the page share a collector rather than
 * reading each other.
 *
 * ## What "not yet" means, and what it does not
 *
 * `offer` is `null` only while the answer is genuinely unknown, and never as a
 * stand-in for "nothing". An unloaded content root and a unitsync scan that has
 * not run both look exactly like an empty install, and both readers act on an
 * empty install: one offers downloads, the other takes the top of the page.
 *
 * Two things are definite answers rather than unknown ones, and both matter
 * because a reader that waited on them would wait forever:
 *
 * - Setup incomplete. The card draws nothing before there is a content folder and
 *   an engine, and it never gets as far as reading an inventory, so there is
 *   nothing to wait for.
 * - A scan that errored or was cancelled. There is no snapshot to take and there
 *   will not be one, so the card draws nothing. See {@link scanSettled}, which is
 *   the same reading the home page's own map inventory waits on.
 *
 * ## The per-visit snapshot
 *
 * The list is captured the moment it is first answerable and held for the rest of
 * the mount (issue #526). Downloading one suggestion refreshes `installed`, and
 * re-deriving from that would shrink or empty the list under a reader mid-visit.
 * Navigating away unmounts the page, so the next visit asks again from scratch.
 *
 * The setup gate is live over the top of the snapshot, so completing setup while
 * the page is open reveals the card with the list already captured.
 */
export function useGetStartedOffer(): GetStartedOfferState {
  const { complete, loading: setupLoading } = useSetupStatus();
  const rootPaths = useContentRootPaths();
  const entries = useBrandingCatalog();
  const suggestedGames = useSuggestedGames();
  const suggestedMaps = useSuggestedMaps();
  const { target, loading: targetLoading } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const [installed, setInstalled] = useState<InstalledContent | null>(null);
  const [answered, setAnswered] = useState(false);
  const [snapshot, setSnapshot] = useState<GetStartedOffer | null>(null);

  // Only ever publishes a listing it actually read. Content roots load
  // asynchronously, so writing empty sets while `rootPaths` is still empty (or
  // after a failed listing) would let the snapshot below freeze a "user has
  // nothing" verdict for a user who has everything. A failure still counts as
  // answered, because the reader waiting on this is waiting on the call rather
  // than on the listing.
  const refresh = useCallback(async () => {
    if (rootPaths.length === 0) return;
    try {
      const { games, maps } = await dlInstalledContent({ paths: rootPaths });
      setInstalled({ games: new Set(games), maps: new Set(maps) });
    } catch {
      // Leave the last known listing (or nothing) in place.
    } finally {
      setAnswered(true);
    }
  }, [rootPaths]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // unitsync is the truth for both kinds: it sees rapid content, which never
  // lands as a file in `games/`. A scan that failed reports no games and no
  // maps, which is not a report of an empty install, so only a scan that
  // resolved counts (matching `usePlayReadiness`).
  const scanned = !scan.loading && scan.data ? scan.data : null;
  // A distribution's gameFilter narrows the suggestions first, so a single-game
  // distribution (e.g. SplinterFaction) never advertises other games' downloads.
  const scopedGames = filterSuggestedGamesByFilter(
    suggestedGames,
    entries,
    getGameMatcher(),
  );
  const candidates = getStartedCandidates({
    installed,
    scanned,
    scopedGames,
    entries,
    suggestedMaps,
  });

  useEffect(() => {
    if (snapshot || !candidates) return;
    setSnapshot(candidates);
  }, [snapshot, candidates]);

  return {
    offer: getStartedOffer({
      setupLoading,
      complete,
      // The snapshot lands a commit after the candidates do, and the reader that
      // holds this answer for the day must not read that gap as "offering
      // nothing". So the fresh list stands in until the snapshot pins it, which
      // is the same list.
      candidates: snapshot ?? candidates,
      answered:
        answered &&
        scanSettled({
          targetLoading,
          hasTarget: !!(target?.enginePath && target?.dataDir),
          scan,
        }),
    }),
    installed,
    refresh,
  };
}

/**
 * The offer, given how far setup and the two inventories have got. Pure, so the
 * order of the answers is testable: unknown while setup is loading, a definite
 * nothing before setup is done, the list once there is one, and a definite
 * nothing once both reads have answered without producing one.
 */
export function getStartedOffer(args: {
  setupLoading: boolean;
  complete: boolean;
  /** The lists the card would draw, or null while an inventory is missing. */
  candidates: GetStartedOffer | null;
  /** Both inventory reads have gone as far as they are going to. */
  answered: boolean;
}): GetStartedOffer | null {
  if (args.setupLoading) return null;
  if (!args.complete) return OFFERS_NOTHING;
  if (args.candidates) return args.candidates;
  return args.answered ? OFFERS_NOTHING : null;
}
