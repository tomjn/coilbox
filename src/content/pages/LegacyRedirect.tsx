import { Navigate, useLocation, useParams } from "react-router";

/**
 * Fill a target template's `:param` tokens from the matched route params.
 *
 * Pure, so a redirect's destination is tested without a router. Params arrive
 * decoded, so each is encoded back into the path it is being written into.
 *
 * A token with no matching param becomes empty rather than staying literal, so
 * a mistyped template lands on a wrong path instead of one containing a colon.
 */
export function legacyTarget(
  template: string,
  params: Readonly<Record<string, string | undefined>>,
): string {
  return template.replace(/:([A-Za-z0-9_]+)/g, (_, key: string) =>
    encodeURIComponent(params[key] ?? ""),
  );
}

/**
 * Build a lazy-route component that redirects a retired path to its new home,
 * substituting every dynamic segment and preserving any query string (e.g. a map
 * detail's old `?map=` filter link).
 *
 * Two sets of paths use this. The `content/replays*` and `content/stats*` links
 * retired when #467 moved Replays to Singleplayer and Stats to Multiplayer, and
 * the `content/*` browser paths retired when Content became Library. Both are
 * kept so old bookmarks, and the provenance links already written into
 * `content.replayState`, still resolve.
 *
 * Takes a template rather than a builder function because the Library rename
 * added paths with two dynamic segments (`content/games/:name/units/:unit`) and
 * a segment not called `name` (`content/blueprints/:id`), neither of which the
 * single-`name` builder could express.
 */
export function makeLegacyRedirect(template: string) {
  return function LegacyRedirect() {
    const params = useParams();
    const { search } = useLocation();
    return (
      <Navigate to={`${legacyTarget(template, params)}${search}`} replace />
    );
  };
}
