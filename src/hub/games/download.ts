import { dlGithubReleaseArchives } from "../../downloads/bindings";
import type { EnqueueInput } from "../../downloads/DownloadQueueProvider";
import type { HubGameDownload } from "../api";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Turn a hub game's ordered download sources into one download-queue request,
 * trying each in the order the hub gave (issue #2951). The order is the
 * point: a repository with no release archives sits below a rapid tag rather
 * than instead of it, so a source that resolves to nothing is skipped rather
 * than failing the whole game.
 *
 * `rapid` and `url` are returned unconditionally - there is nothing to check
 * ahead of enqueuing a tag or an address, the same as `suggestionRequest` in
 * `content/pages/components/SuggestionsList.tsx` does for the curated "Get
 * started" list. `github` is the only kind that can come up empty ahead of
 * time: its release archives are looked up, and a repo with none, or with an
 * `asset` fragment none of its recent releases match, is treated as empty and
 * the next source is tried instead. That mirrors `downloadGameAnySource`'s
 * issue #2859 reasoning: installing a different release than the one asked
 * for is worse than trying the next source.
 *
 * Throws when every source comes up empty (or there were none), carrying
 * every attempted source's reason.
 */
export async function hubGameDownloadRequest(
  downloads: HubGameDownload[],
  destDir: string,
  label: string,
): Promise<EnqueueInput> {
  const errors: string[] = [];

  for (const dl of downloads) {
    if (dl.kind === "rapid") {
      return { kind: "rapid", label, args: { tag: dl.value } };
    }

    if (dl.kind === "url") {
      if (!dl.filename) {
        errors.push(`${dl.value}: no filename to save it as`);
        continue;
      }
      return {
        kind: "file",
        label,
        args: { url: dl.value, destDir, filename: dl.filename },
      };
    }

    // github: the only kind that can genuinely come up empty ahead of time.
    try {
      const { archives } = await dlGithubReleaseArchives({ repo: dl.value });
      if (archives.length === 0) {
        errors.push(`${dl.value}: no release archives`);
        continue;
      }
      const pick = dl.asset
        ? archives.find((a) =>
            a.filename.toLowerCase().includes(dl.asset?.toLowerCase() ?? ""),
          )
        : archives[0];
      if (!pick) {
        errors.push(
          `${dl.value}: no release matching "${dl.asset}" in its latest ${archives.length} release(s)`,
        );
        continue;
      }
      return {
        kind: "file",
        label,
        args: { url: pick.url, destDir, filename: pick.filename },
      };
    } catch (e) {
      errors.push(`${dl.value}: ${msg(e)}`);
    }
  }

  throw new Error(
    downloads.length === 0
      ? `The hub named no download source for ${label}.`
      : `No usable download source for ${label}. ${errors.join("; ")}`,
  );
}
