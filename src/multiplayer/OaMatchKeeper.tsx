import { useKeepOaMatches } from "./oaMatches";

/** Renders nothing. Keeps finished Open Annihilation matches in the settings. */
export function OaMatchKeeper() {
  useKeepOaMatches();
  return null;
}
