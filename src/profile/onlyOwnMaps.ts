/**
 * What a profile's `onlyOwnMaps` key resolved to (issue #3604).
 *
 * `none` is a profile without the key, which is every profile written before it
 * existed. `off` is an explicit false. `problem` is a value that is neither true
 * nor false, in words the health panel shows the author, and it leaves the
 * generated map styles on.
 */
export type OnlyOwnMapsResolution =
  | { status: "none" }
  | { status: "on" }
  | { status: "off" }
  | { status: "problem"; issue: string };

/**
 * Read the profile's `onlyOwnMaps` key. Takes the raw value because
 * `profile.json` is cast rather than validated, so anything can arrive here.
 */
export function resolveOnlyOwnMaps(raw: unknown): OnlyOwnMapsResolution {
  if (raw === undefined || raw === null) return { status: "none" };
  if (raw === true) return { status: "on" };
  if (raw === false) return { status: "off" };
  const kind = Array.isArray(raw)
    ? "a list"
    : typeof raw === "object"
      ? "an object"
      : `a ${typeof raw}`;
  return {
    status: "problem",
    issue: `\`onlyOwnMaps\` is ${kind}, and it must be true or false`,
  };
}
