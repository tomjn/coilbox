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
 * Named tags therefore come first, commit snapshots after, and within each
 * group the repository's own order is kept. The named/commit test matches
 * `release_md5s` in the downloads plugin: it reads the tag, never the name,
 * because a named tag often points at a build whose long name says "test-7183".
 */
export function orderRapidVersions(versions: Version[]): Version[] {
  const named = versions.filter((v) => !isCommitTag(v.tag));
  const commits = versions.filter((v) => isCommitTag(v.tag));
  return [...named, ...commits];
}

/** True for a per-commit tag such as `byar:git:03b45b8`. */
export function isCommitTag(tag: string): boolean {
  return tag.includes(":git:");
}
