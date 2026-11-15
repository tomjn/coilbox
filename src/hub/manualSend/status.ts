import { useEffect, useState } from "react";
import type { GameItem } from "@/content/bindings";
import { dlRapidReleaseArchives } from "@/downloads/bindings";
import { fetchHubGames, type HubGame } from "../api";
import { fetchHubPictures } from "../assets/pictures";
import { MAP_VARIANTS, MINIMAP_VARIANT } from "../assets/vocabulary";
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
 *
 * `incomplete` is a map the hub has a page for that is still missing some of
 * its layers, such as its terrain. The page links to it and offers the send.
 */
export type HubPresence =
  | { state: "unknown" }
  | { state: "missing" }
  | { state: "incomplete"; url: string }
  | { state: "present"; url: string };

const UNKNOWN: HubPresence = { state: "unknown" };
const MISSING: HubPresence = { state: "missing" };

function base(hubUrl: string): string {
  return hubUrl.replace(/\/+$/, "");
}

/**
 * A game is on the hub when the hub lists its shortname and holds this
 * release. A hub that does not say which releases it holds is taken at its
 * listing: offering every listed game would put a send button on every page
 * for games the hub plainly has.
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
  if (!game) return MISSING;
  if (game.releases && !game.releases.includes(release)) return MISSING;
  return {
    state: "present",
    url: `${base(hubUrl)}/games/${encodeURIComponent(game.shortname)}`,
  };
}

/**
 * A map is on the hub when the hub has its facts and its minimap, and complete
 * when it also has every overlay layer. `held` is the variants the hub has a
 * picture of. Either answer still out is unknown.
 */
export function mapPresence(
  hubUrl: string,
  facts: MapFacts | null | undefined,
  held: ReadonlySet<string> | undefined,
): HubPresence {
  if (facts === undefined || held === undefined) return UNKNOWN;
  if (!facts || !held.has(MINIMAP_VARIANT)) return MISSING;
  const url = `${base(hubUrl)}/map/${encodeURIComponent(facts.slug)}`;
  return MAP_VARIANTS.every((variant) => held.has(variant))
    ? { state: "present", url }
    : { state: "incomplete", url };
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

/** Ask the hub about one map's facts and layers, and again whenever a manual
 *  send ends. */
export function useMapPresence(mapName: string | null): HubPresence {
  const hubUrl = useTrustedHubUrl();
  const finished = useManualSendsFinished();
  const [facts, setFacts] = useState<MapFacts | null | undefined>(undefined);
  const [held, setHeld] = useState<ReadonlySet<string> | undefined>(undefined);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `finished` is the signal to ask again
  useEffect(() => {
    setFacts(undefined);
    setHeld(undefined);
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
      MAP_VARIANTS.map((variant) => ({
        keyed_on: "map" as const,
        map_name: mapName,
        variant,
      })),
      abort.signal,
    )
      .then((result) => {
        if (!abort.signal.aborted && result.ok) {
          setHeld(
            new Set(
              MAP_VARIANTS.filter((_, at) => result.pictures[at] != null),
            ),
          );
        }
      })
      .catch(() => {});
    return () => abort.abort();
  }, [hubUrl, mapName, finished]);
  if (!hubUrl || !mapName) return UNKNOWN;
  return mapPresence(hubUrl, facts, held);
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
