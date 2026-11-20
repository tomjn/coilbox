import type { Version } from "./bindings";

/**
 * Ordering for the rapid browser's version list.
 *
 * A repository publishes a tag per commit as `<repo>:git:<sha>` alongside the
 * named ones like `byar:stable` and `byar:test`. The commit tags outnumber the
 * named ones by thousands, and `versions.gz` lists them in no order the user
 * cares about, so the two or three tags anyone actually wants to download can
 * sit anywhere in the list.
 *
 * Named tags therefore come first, commit snapshots after. `stable` and
 * `test` lead the named tags, as the two a player is most likely after. Within
 * each group the newest build comes first, read from the revision count in the
 * long name (`test-31677-a31a826`). Builds with no revision count keep the
 * repository's order at the end of their group. The named/commit test matches
 * `release_md5s` in the downloads plugin: it reads the tag, never the name,
 * because a named tag often points at a build whose long name says "test-7183".
 */
export function orderRapidVersions(versions: Version[]): Version[] {
  const keyed = versions.map((v, index) => ({
    v,
    index,
    group: groupOf(v.tag),
    revision: revisionOf(v.name),
  }));
  keyed.sort(
    (a, b) =>
      a.group - b.group ||
      (b.revision ?? -1) - (a.revision ?? -1) ||
      a.index - b.index,
  );
  return keyed.map((k) => k.v);
}

/** True for a per-commit tag such as `byar:git:03b45b8`. */
export function isCommitTag(tag: string): boolean {
  return tag.includes(":git:");
}

/** 0 for `stable`, 1 for `test`, 2 for any other named tag, 3 for a commit. */
function groupOf(tag: string): number {
  if (isCommitTag(tag)) return 3;
  const name = tag.slice(tag.indexOf(":") + 1);
  if (name === "stable") return 0;
  if (name === "test") return 1;
  return 2;
}

/** The revision count in a long name such as `Beyond All Reason
 *  test-31677-a31a826`, or null when the name has none. */
function revisionOf(name: string): number | null {
  const match = /-(\d+)-[0-9a-f]{7,40}$/.exec(name);
  return match ? Number(match[1]) : null;
}
