import { dlRepos, dlVersions } from "./bindings";

/** What a rapid tag points at now, and whether the pool holds that package. */
export interface RapidTag {
  md5: string;
  installed: boolean;
}

/**
 * The current package of each rapid tag, read from the rapid indexes. Neither
 * command is asked to refresh, so each answers from the copy on disk when there
 * is one, which is the copy the Browse Rapid page reads. A tag's repository is
 * the part before the colon. A tag that no master lists, or whose index cannot
 * be read, is left out.
 */
export async function loadRapidTags(
  tags: readonly string[],
  masterUrls: readonly string[],
  dataDir: string | undefined,
): Promise<Record<string, RapidTag>> {
  const wanted = [...new Set(tags)];
  if (wanted.length === 0) return {};
  const repoUrls = new Map<string, string>();
  for (const masterUrl of masterUrls) {
    try {
      const { repos } = await dlRepos({ masterUrl });
      for (const r of repos)
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
        read = await dlVersions({ repoUrl, dataDir });
        versions.set(repoUrl, read);
      }
      const v = read.versions.find((x) => x.tag === tag);
      if (v) out[tag] = { md5: v.md5, installed: v.installed };
    } catch {
      // Leave the tag out. The game page reports an unreadable index.
    }
  }
  return out;
}
