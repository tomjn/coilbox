import { useEffect, useState } from "react";
import type { GameItem } from "@/content/bindings";
import { dlRapidReleaseArchives } from "@/downloads/bindings";
import { fetchHubGames, type HubGame } from "../api";
import { fetchHubPictures } from "../assets/pictures";
import { MINIMAP_VARIANT } from "../assets/vocabulary";
import { useTrustedHubUrl } from "../config";
import { gamesToSend, type Sendable } from "../games/factsSweep";
import { fetchMapFacts, type MapFacts } from "../maps/lookup";
import { useManualSendsFinished } from "./run";

/**
 * Whether the hub has a game or map, as a detail page needs to know it.
 *
 * `unknown` covers both "still asking" and "could not ask". Neither is a claim
 * the page can act on, and a button that appears while the hub is down would
 * offer a send that then fails.
 */
export type HubPresence =
  | { state: "unknown" }
  | { state: "missing" }
  | { state: "present"; url: string };

const UNKNOWN: HubPresence = { state: "unknown" };
const MISSING: HubPresence = { state: "missing" };

function base(hubUrl: string): string {
  return hubUrl.replace(/\/+$/, "");
}

/**
 * A game is on the hub when the hub lists its shortname and holds this
 * release. A hub that does not say which releases it holds reads as missing,
 * because a send of facts it already has is answered `unchanged` and costs
 * nothing, while a release it is missing would otherwise never be offered.
 */
export function gamePresence(
  hubUrl: string,
  games: readonly HubGame[] | null,
  shortname: string,
  release: string,
): HubPresence {
  if (!games) return UNKNOWN;
  const wanted = shortname.toLowerCase();
  const game = games.find((one) => one.shortname.toLowerCase() === wanted);
  if (!game?.releases?.includes(release)) return MISSING;
  return {
    state: "present",
    url: `${base(hubUrl)}/games/${encodeURIComponent(game.shortname)}`,
  };
}

/**
 * A map is on the hub when the hub has its facts and its minimap. Either one
 * still unanswered is unknown.
 */
export function mapPresence(
  hubUrl: string,
  facts: MapFacts | null | undefined,
  hasMinimap: boolean | undefined,
): HubPresence {
  if (facts === undefined || hasMinimap === undefined) return UNKNOWN;
  if (!facts || !hasMinimap) return MISSING;
  return {
    state: "present",
    url: `${base(hubUrl)}/map/${encodeURIComponent(facts.slug)}`,
  };
}

/**
 * Ask the hub about one game, and again whenever a manual send ends.
 *
 * Read directly rather than through `useHubGames`, which remembers a failure as
 * an empty list: that would read as "the hub has none of your games" and put a
 * button on every page while the hub is down.
 */
export function useGamePresence(
  shortname: string | null,
  release: string | null,
): HubPresence {
  const hubUrl = useTrustedHubUrl();
  const finished = useManualSendsFinished();
  const [games, setGames] = useState<HubGame[] | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `finished` is the signal to ask again
  useEffect(() => {
    setGames(null);
    if (!hubUrl || !shortname) return;
    const abort = new AbortController();
    fetchHubGames(hubUrl, abort.signal)
      .then((result) => {
        if (!abort.signal.aborted && result.ok) setGames(result.value);
      })
      .catch(() => {});
    return () => abort.abort();
  }, [hubUrl, shortname, finished]);
  if (!hubUrl || !shortname || !release) return UNKNOWN;
  return gamePresence(hubUrl, games, shortname, release);
}

/** Ask the hub about one map's facts and minimap, and again whenever a manual
 *  send ends. */
export function useMapPresence(mapName: string | null): HubPresence {
  const hubUrl = useTrustedHubUrl();
  const finished = useManualSendsFinished();
  const [facts, setFacts] = useState<MapFacts | null | undefined>(undefined);
  const [minimap, setMinimap] = useState<boolean | undefined>(undefined);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `finished` is the signal to ask again
  useEffect(() => {
    setFacts(undefined);
    setMinimap(undefined);
    if (!hubUrl || !mapName) return;
    const abort = new AbortController();
    fetchMapFacts(hubUrl, [mapName], abort.signal)
      .then((result) => {
        if (!abort.signal.aborted && result.ok)
          setFacts(result.maps[0] ?? null);
      })
      .catch(() => {});
    fetchHubPictures(
      hubUrl,
      [{ keyed_on: "map", map_name: mapName, variant: MINIMAP_VARIANT }],
      abort.signal,
    )
      .then((result) => {
        if (!abort.signal.aborted && result.ok) {
          setMinimap(result.pictures[0] != null);
        }
      })
      .catch(() => {});
    return () => abort.abort();
  }, [hubUrl, mapName, finished]);
  if (!hubUrl || !mapName) return UNKNOWN;
  return mapPresence(hubUrl, facts, minimap);
}

/**
 * This game as the hub sweeps would send it, or null when they would not: a
 * loose folder, a snapshot build, no shortname or release, or another install
 * of the same game that the sweeps pick instead. A page offers no send for
 * those, because the send would decline it.
 */
export function useSendableGame(
  game: GameItem | undefined,
  installed: readonly GameItem[] | null,
  dataDir: string | undefined,
): Sendable | null {
  const [md5s, setMd5s] = useState<ReadonlySet<string> | null>(null);
  useEffect(() => {
    setMd5s(null);
    if (!dataDir) return;
    let live = true;
    dlRapidReleaseArchives({ dataDir })
      .then(({ md5s: found }) => {
        if (live) setMd5s(new Set(found.map((m) => m.toLowerCase())));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [dataDir]);
  if (!game || !installed || !md5s) return null;
  return (
    gamesToSend(installed, md5s).sendable.find(
      (entry) => entry.game.name === game.name,
    ) ?? null
  );
}
