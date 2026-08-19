import { useEffect, useMemo, useState } from "react";
import type { MapAppearance } from "@/mapconv/bindings";
import { isHubEnabled } from "@/profile/profile";
import { useHubUrl } from "../config";
import { appearanceFromFacts } from "./appearance";
import { knownMap } from "./knownMaps";
import type { MapFacts } from "./lookup";

/**
 * What the hub knows about a map, or null while it has not answered, could not
 * be reached, or knows nothing (issue #1738).
 *
 * The request is assembled in `./knownMaps.ts`, which turns a screen of maps
 * asking one at a time into one request. The same shape as `useHeldMapPicture`
 * beside it, and it holds the same rule about when to ask at all: a profile that
 * switched the hub off asks it nothing.
 *
 * ## Ask only for maps this machine has not got
 *
 * A map that is installed is extracted locally, and that answer is better: it is
 * the archive on this machine rather than what somebody else reported about a
 * map of the same name. So the caller passes `undefined` once it has a local
 * answer, exactly as `useMapPictureLadder` does for the picture, and the hub is
 * a fallback for names with no local archive rather than a second opinion.
 */
export function useMapFacts(mapName: string | undefined): MapFacts | null {
  const hubUrl = useHubUrl();
  const [facts, setFacts] = useState<MapFacts | null>(null);

  useEffect(() => {
    setFacts(null);
    if (!mapName || !isHubEnabled()) return;
    let live = true;
    knownMap(hubUrl, mapName).then((answer) => {
      if (live) setFacts(answer);
    });
    return () => {
      live = false;
    };
  }, [hubUrl, mapName]);

  return facts;
}

/**
 * The same for several maps at once, answered in the order the names were given.
 *
 * A caller with a list holds one hook rather than one per row, which is what
 * lets a galaxy of two hundred nodes ask about all of them (issue #1739). The
 * batching underneath is the same, so this is one request either way: the
 * difference is that a list of names is not a list of components.
 *
 * `names` is read as a set of asks, so a caller may pass the same name twice and
 * gets one request for it.
 */
export function useManyMapFacts(
  names: readonly string[],
): Map<string, MapFacts> {
  const hubUrl = useHubUrl();
  const [facts, setFacts] = useState<Map<string, MapFacts>>(new Map());
  // Joined rather than passed as an array, so a caller rebuilding an equal list
  // every render does not restart the effect.
  const key = names.join("\n");

  useEffect(() => {
    if (!isHubEnabled()) return;
    const wanted = key.split("\n").filter(Boolean);
    if (wanted.length === 0) return;
    let live = true;
    Promise.all(
      Array.from(new Set(wanted)).map(async (name) => {
        return [name, await knownMap(hubUrl, name)] as const;
      }),
    ).then((answers) => {
      if (!live) return;
      const found = new Map<string, MapFacts>();
      for (const [name, answer] of answers) {
        if (answer) found.set(name, answer);
      }
      // Replaced rather than merged: the answers are for the names asked about,
      // and a name that has left the list has left the screen with it.
      setFacts(found);
    });
    return () => {
      live = false;
    };
  }, [hubUrl, key]);

  return facts;
}

/**
 * The appearance of each of these maps, as far as the hub knows (issue #1739).
 *
 * Meant to sit behind the local cache rather than beside it: the caller passes
 * the names it has no local answer for, and merges what comes back underneath
 * its own. `src/content/mapAppearanceCache.ts` does exactly that in
 * `useMapAppearances`, which is what every consumer of the cache should use.
 */
export function useHubMapAppearances(
  names: readonly string[],
): Map<string, MapAppearance> {
  const facts = useManyMapFacts(names);
  return useMemo(() => {
    const out = new Map<string, MapAppearance>();
    for (const [name, one] of facts) {
      const appearance = appearanceFromFacts(one);
      if (appearance) out.set(name, appearance);
    }
    return out;
  }, [facts]);
}
