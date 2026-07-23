import { Navigate, useLocation, useParams } from "react-router";

/**
 * Build a lazy-route component that redirects a retired path to its new home,
 * substituting the dynamic `:name` segment when present and preserving any
 * query string (e.g. a map detail's old `?map=` filter link). Used to keep old
 * `content/replays*` and `content/stats*` links (bookmarks, provenance already
 * written into `content.replayState`) resolving after the nav move to
 * Singleplayer/Multiplayer (issue #467).
 */
export function makeLegacyRedirect(buildTarget: (name?: string) => string) {
  return function LegacyRedirect() {
    const { name } = useParams();
    const { search } = useLocation();
    return <Navigate to={`${buildTarget(name)}${search}`} replace />;
  };
}
