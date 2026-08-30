/** Whatever the modules using it decide to keep, under a name each. */
type Carrier = Record<string, unknown>;

/**
 * The one thing that survives a hot module replacement, or nothing in a build.
 *
 * Vite keeps an object per module path and hands it to every copy of that
 * module it makes, which is the only way a module that holds state can give it
 * to the copy replacing it. This names that object so a module can reach it
 * without writing `import.meta.hot` itself, and so a test can supply one and
 * watch two copies share it. See `hostedRoom.ts`, which is the reason this
 * exists (issue #2126).
 *
 * `import.meta.hot` is undefined in a build, so this is undefined in every
 * release and the code reading it drops out. Where a release should carry
 * nothing at all, write the check against this rather than against the state,
 * because this is the one a build can fold away.
 *
 * # Reaching for this from somewhere else
 *
 * Every module that holds state outside React loses it to a hot update, and this
 * repo has plenty that do. Most of them do not care, because losing a cached
 * answer costs a re-fetch nobody sees. It earns a carrier when losing the state
 * looks to whoever is developing like the feature is broken, or when the copy
 * being replaced leaves something running. Put the whole of the state in one
 * object behind this rather than copying fields out, so that a field added later
 * comes along without anybody having to remember.
 *
 * # Why not `dispose`
 *
 * The usual answer for a module that holds a timer is `import.meta.hot.dispose`,
 * to clear it on the way out. It does not run here. Vite only calls a disposer
 * for the module that accepts the update, and a module of plain functions never
 * accepts one: the update bubbles up to the React components that import it,
 * which accept it because React Refresh made them self-accepting. So the copy
 * being replaced is never told, and only what it left in here reaches its
 * replacement.
 */
export const hotCarrier: Carrier | undefined = import.meta.hot?.data;
