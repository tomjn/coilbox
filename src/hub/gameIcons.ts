import { useEffect, useState } from "react";
import type { GameItem } from "@/content/bindings";
import { gameIconKey } from "@/content/gameIcon";
import { createGameResolver } from "../career/games";
import { fetchHubGames, type HubGame } from "./api";
import { assetCdnBase } from "./assets/tier";
import { useTrustedHubUrl } from "./config";

/**
 * The address of a hub game's picture, or null when it is not one to fetch.
 *
 * The path is text from a server response, so it is checked before anything
 * fetches it. It must come out as https, with no username or password, on one
 * of two places: the hub's own origin (a root-relative path lands there), or
 * the hub's asset base, which is where the live hub points every logo (a
 * different host from the hub, under `/coilbox-assets/`). A path that climbs
 * out of the asset base is normalised by the URL parser before the prefix test,
 * so it fails that test.
 */
export function hubIconUrl(
  path: string | null | undefined,
  hubUrl: string,
  assetBase: string,
): string | null {
  const raw = path?.trim();
  if (!raw) return null;
  try {
    const hub = new URL(hubUrl);
    if (hub.protocol !== "https:") return null;
    const url = new URL(raw, hub);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (url.origin === hub.origin) return url.href;
    const base = new URL(assetBase);
    if (
      base.protocol === "https:" &&
      url.origin === base.origin &&
      url.pathname.startsWith(base.pathname)
    ) {
      return url.href;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * The hub's entry for the game a page names, matched by shortname through the
 * same key `gameIconKey` gives the page. An installed game's shortname lands on
 * its key, so "Balanced Annihilation V15.9.8" meets the hub's `BA`. A game that
 * is not installed only meets an entry when the name it was given is the
 * shortname itself, because nothing else says what its shortname is.
 */
export function matchHubGame(
  games: readonly HubGame[] | null,
  name: string,
  installed: readonly GameItem[] | null,
): HubGame | undefined {
  if (!games) return undefined;
  const key = gameIconKey(name, installed);
  if (!key) return undefined;
  const resolver = createGameResolver(installed);
  return games.find((g) => resolver.byShortname(g.shortname).key === key);
}

/**
 * The name to give `GameIcon` for a game known only by its hub shortname.
 * {@link matchHubGame} finds the hub's entry from the shortname either way. An
 * installed game is named by its title all the same, because the art behind the
 * hub's logo (the branding catalog and the game's own loading screen) is looked
 * up by name, and a shortname read as a name is not an installed game.
 */
export function hubGameIconName(
  shortname: string,
  installed: readonly GameItem[] | null,
): string {
  const id = createGameResolver(installed).byShortname(shortname);
  return id.installed ? id.title : shortname;
}

/** What each hub's list read came to this session, keyed by hub address. */
const requests = new Map<string, Promise<HubGame[]>>();
/** The same answers once they have landed, so a page that opens later reads
 * one straight away instead of waiting a render for a promise. */
const answers = new Map<string, HubGame[]>();

/**
 * The hub's game list, read once per hub for the session and shared by every
 * caller. A failure is remembered as an empty list for the rest of the session,
 * so a hub that is down is asked once rather than on every page that opens.
 * Never rejects, and says nothing about a failure: the pages that use this have
 * a picture to show without it. The launch-time read passes `rememberFailure`
 * false, so a failure it meets, such as no network, is dropped and the first
 * page that needs the list asks again.
 */
export function loadHubGames(
  hubUrl: string,
  rememberFailure = true,
): Promise<HubGame[]> {
  let request = requests.get(hubUrl);
  if (!request) {
    const started: Promise<HubGame[]> = fetchHubGames(hubUrl)
      .then((result) => (result.ok ? result.value : null))
      .catch(() => null)
      .then((games) => {
        if (games) {
          answers.set(hubUrl, games);
          return games;
        }
        if (rememberFailure) {
          answers.set(hubUrl, []);
        } else if (requests.get(hubUrl) === started) {
          requests.delete(hubUrl);
        }
        return [];
      });
    request = started;
    requests.set(hubUrl, request);
  }
  return request;
}

/** Forget what was read, for a test that needs a fresh session. */
export function resetHubGames(): void {
  requests.clear();
  answers.clear();
}

/**
 * The trusted hub's game list, or null until it has landed. Null as well when
 * there is no trusted hub (a profile switched it off), in which case nothing is
 * requested at all.
 */
export function useHubGames(): HubGame[] | null {
  const hubUrl = useTrustedHubUrl();
  const [games, setGames] = useState<HubGame[] | null>(
    hubUrl ? (answers.get(hubUrl) ?? null) : null,
  );
  useEffect(() => {
    if (!hubUrl) {
      setGames(null);
      return;
    }
    const held = answers.get(hubUrl);
    if (held) {
      setGames(held);
      return;
    }
    let live = true;
    loadHubGames(hubUrl).then((loaded) => {
      if (live) setGames(loaded);
    });
    return () => {
      live = false;
    };
  }, [hubUrl]);
  return games;
}

/**
 * The picture address for a game's hub logo, for the trusted hub, or undefined
 * when there is no such hub, no matching game, no logo, or a logo that is not an
 * address coilbox will fetch.
 */
export function useHubGameLogoUrl(
  name: string,
  installed: readonly GameItem[] | null,
): string | undefined {
  const hubUrl = useTrustedHubUrl();
  const games = useHubGames();
  if (!hubUrl) return undefined;
  const match = matchHubGame(games, name, installed);
  return hubIconUrl(match?.logo, hubUrl, assetCdnBase()) ?? undefined;
}
