import { useEffect, useState } from "react";
import type { GameItem } from "@/content/bindings";
import { dlRapidReleaseArchives } from "@/downloads/bindings";
import { fetchHubGames, type HubGame } from "../api";
import { fetchHubPictures } from "../assets/pictures";
import {
  MAP_VARIANTS,
  MINIMAP_VARIANT,
  PICTURE_ANGLES,
  renderVariant,
} from "../assets/vocabulary";
import { useTrustedHubUrl } from "../config";
import { gamesToSend, type Sendable } from "../games/factsSweep";
import { fetchMapFacts, type MapFacts } from "../maps/lookup";
import { useManualSendsFinished } from "./run";
import { sentHere } from "./sentHere";

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

/**
 * What the hub says about one game or map: whether it has it, and the hashes of
 * the archives it lists for it. `hashes` is undefined while the hub has not
 * answered, and empty when it lists none. A hub that lists an archive with
 * the hash of the one on this machine already has what an upload would send.
 */
export interface HubState {
  presence: HubPresence;
  hashes: ReadonlySet<string> | undefined;
}

function base(hubUrl: string): string {
  return hubUrl.replace(/\/+$/, "");
}

/** A game's page on the hub. */
export function gamePageUrl(hubUrl: string, shortname: string): string {
  return `${base(hubUrl)}/games/${encodeURIComponent(shortname)}`;
}

/** A map's page on the hub, by the slug the hub gave it. */
export function mapPageUrl(hubUrl: string, slug: string): string {
  return `${base(hubUrl)}/map/${encodeURIComponent(slug)}`;
}

/**
 * A game is on the hub when the hub lists its shortname and holds this
 * release. A hub that does not say which releases it holds is taken at its
 * listing: offering every listed game would put a send button on every page
 * for games the hub plainly has.
 *
 * A game the hub holds is `incomplete` when `missingStartPics` says the hub
 * shows no picture of one of its start units. Left undefined, while the hub
 * has not answered or when this machine has already sent this release, it
 * counts as present.
 */
export function gamePresence(
  hubUrl: string,
  games: readonly HubGame[] | null,
  shortname: string,
  release: string,
  missingStartPics?: boolean,
): HubPresence {
  if (!games) return UNKNOWN;
  const wanted = shortname.toLowerCase();
  const game = games.find((one) => one.shortname.toLowerCase() === wanted);
  if (!game) return MISSING;
  if (game.releases && !game.releases.includes(release)) return MISSING;
  const url = gamePageUrl(hubUrl, game.shortname);
  return missingStartPics
    ? { state: "incomplete", url }
    : { state: "present", url };
}

/** The hashes of the archives the hub lists for a game, from its download
 *  sources. Undefined until the listing is known. */
export function gameHashes(
  games: readonly HubGame[] | null,
  shortname: string,
): ReadonlySet<string> | undefined {
  if (!games) return undefined;
  const wanted = shortname.toLowerCase();
  const game = games.find((one) => one.shortname.toLowerCase() === wanted);
  const downloads = game && Array.isArray(game.downloads) ? game.downloads : [];
  return new Set(downloads.flatMap((d) => (d.sha256 ? [d.sha256] : [])));
}

/** The hashes of the archives the hub lists for a map, from its download
 *  sources. Undefined until the hub has answered. */
export function mapHashes(
  facts: MapFacts | null | undefined,
): ReadonlySet<string> | undefined {
  if (facts === undefined) return undefined;
  return new Set(
    (facts?.downloads ?? []).flatMap((d) => (d.sha256 ? [d.sha256] : [])),
  );
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
  const url = mapPageUrl(hubUrl, facts.slug);
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
export function useGameHubState(
  shortname: string | null,
  release: string | null,
  startUnits: readonly string[] = [],
): HubState {
  const hubUrl = useTrustedHubUrl();
  const finished = useManualSendsFinished();
  const [games, setGames] = useState<HubGame[] | null>(null);
  const [missingStartPics, setMissingStartPics] = useState<boolean>();
  const startKey = startUnits.join("\n");
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: `startKey` stands for `startUnits`, and `finished` is the signal to ask again
  useEffect(() => {
    setMissingStartPics(undefined);
    if (!hubUrl || !shortname || !release || !startKey) return;
    // The hub shows a picture only once it is approved, so a release sent from
    // here would read as missing until then. See `./sentHere`.
    if (sentHere(hubUrl, shortname, release)) return;
    const abort = new AbortController();
    fetchHubPictures(
      hubUrl,
      startKey.split("\n").map((unit) => ({
        keyed_on: "unit" as const,
        game: shortname,
        unit_name: unit.toLowerCase(),
        // The hub answers a render angle it lacks with the unit's build pic,
        // so this is null only when it shows neither.
        variant: renderVariant(PICTURE_ANGLES[0] ?? "top"),
      })),
      abort.signal,
    )
      .then((result) => {
        if (!abort.signal.aborted && result.ok) {
          setMissingStartPics(result.pictures.some((one) => one == null));
        }
      })
      .catch(() => {});
    return () => abort.abort();
  }, [hubUrl, shortname, release, startKey, finished]);
  if (!hubUrl || !shortname) return { presence: UNKNOWN, hashes: undefined };
  return {
    presence: release
      ? gamePresence(hubUrl, games, shortname, release, missingStartPics)
      : UNKNOWN,
    hashes: gameHashes(games, shortname),
  };
}

/** Ask the hub about one map's facts and layers, and again whenever a manual
 *  send ends. */
export function useMapHubState(mapName: string | null): HubState {
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
  if (!hubUrl || !mapName) return { presence: UNKNOWN, hashes: undefined };
  return {
    presence: mapPresence(hubUrl, facts, held),
    hashes: mapHashes(facts),
  };
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
