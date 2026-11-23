import { dlRepos, dlVersions } from "./bindings";

/** What a rapid tag points at now, and whether the pool holds that package. */
export interface RapidTag {
  md5: string;
  installed: boolean;
}

/**
 * The current package of each rapid tag, read from the rapid indexes. Each
 * answers from the copy on disk when there is one, which is the copy the Browse
 * Rapid page reads. `stale` is set when any copy has not been fetched since the
 * app started, and a second call with `revalidate` fetches those. A tag's
 * repository is the part before the colon. A tag that no master lists, or
 * whose index cannot be read, is left out.
 */
export async function loadRapidTags(
  tags: readonly string[],
  masterUrls: readonly string[],
  dataDir: string | undefined,
  revalidate = false,
): Promise<{ tags: Record<string, RapidTag>; stale: boolean }> {
  const wanted = [...new Set(tags)];
  if (wanted.length === 0) return { tags: {}, stale: false };
  let stale = false;
  const repoUrls = new Map<string, string>();
  for (const masterUrl of masterUrls) {
    try {
      const listed = await dlRepos({ masterUrl, revalidate });
      stale ||= listed.stale;
      for (const r of listed.repos)
        if (!repoUrls.has(r.name)) repoUrls.set(r.name, r.url);
    } catch {
      // A master that cannot be read cannot vouch for any tag.
    }
  }
  const out: Record<string, RapidTag> = {};
  const versions = new Map<string, Awaited<ReturnType<typeof dlVersions>>>();
  for (const tag of wanted) {
    const repoUrl = repoUrls.get(tag.split(":")[0]);
    if (!repoUrl) continue;
    try {
      let read = versions.get(repoUrl);
      if (!read) {
        read = await dlVersions({ repoUrl, dataDir, revalidate });
        stale ||= read.stale;
        versions.set(repoUrl, read);
      }
      const v = read.versions.find((x) => x.tag === tag);
      if (v) out[tag] = { md5: v.md5, installed: v.installed };
    } catch {
      // Leave the tag out. The game page reports an unreadable index.
    }
  }
  return { tags: out, stale };
}
