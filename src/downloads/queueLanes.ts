import type { EnqueueInput } from "./DownloadQueueProvider";

/**
 * What a queued download is, for the icon beside it in the topbar popover.
 *
 * "rapid" is kept apart from "game" even though a rapid tag is nearly always a
 * game, because the issue that asked for icons (#3141) wanted rapid downloads
 * told apart from mirror ones.
 */
export type QueueContent = "map" | "game" | "rapid" | "engine" | "file";

/**
 * The queue runs one download at a time per lane, and lanes run side by side.
 *
 * Lanes split by what is being downloaded rather than by host. Two requests for
 * the same archive always land in the same lane, even when one names a mirror
 * and the other asks for any source, so they can never write the same file at
 * once. The engines lane keeps the Spring engine install's before and after
 * sweep of the engine folder from seeing another engine arrive mid install.
 *
 * pr-downloader is shared between lanes, and two copies must not write one
 * rapid pool at once. The plugin serialises its runs itself, so a map falling
 * back to pr-downloader waits for a rapid game rather than racing it.
 */
export type QueueLane = "maps" | "games" | "engines" | "files";

/**
 * A direct file download says what it is only through the folder it writes to,
 * because every caller builds `destDir` as `<root>/maps`, `<root>/games` or
 * `<root>/engine`.
 */
function fileContent(destDir: string): QueueContent {
  const folder = destDir
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .pop()
    ?.toLowerCase();
  if (folder === "maps") return "map";
  if (folder === "games") return "game";
  if (folder === "engine" || folder === "engines") return "engine";
  return "file";
}

export function contentOf(input: EnqueueInput): QueueContent {
  switch (input.kind) {
    case "rapid":
      return "rapid";
    case "game":
      return "game";
    case "map":
    case "mapAnySource":
      return "map";
    case "engineRecoil":
    case "engineSpring":
      return "engine";
    case "file":
      return fileContent(input.args.destDir);
  }
}

export function laneOf(input: EnqueueInput): QueueLane {
  switch (contentOf(input)) {
    case "map":
      return "maps";
    case "game":
    case "rapid":
      return "games";
    case "engine":
      return "engines";
    case "file":
      return "files";
  }
}

/**
 * The queued items to start now: the first queued item in each lane that has
 * nothing running, in queue order.
 */
export function startable<
  T extends EnqueueInput & { status: string; id: string },
>(items: T[], busy: ReadonlySet<QueueLane>): T[] {
  const taken = new Set(busy);
  const out: T[] = [];
  for (const item of items) {
    if (item.status !== "queued") continue;
    const lane = laneOf(item);
    if (taken.has(lane)) continue;
    taken.add(lane);
    out.push(item);
  }
  return out;
}

/**
 * Apache autoindex sizes such as `15M`, `6.9M` or `512K`, as bytes. hakora.xyz
 * lists its maps this way. Apache counts in powers of 1024, so `15M` is read
 * back as 15 MiB, which `formatBytes` prints as `15 MB` again. Returns
 * undefined for anything else, including the `-` Apache prints for a folder.
 */
export function parseApacheSize(text: string | undefined): number | undefined {
  const m = text?.trim().match(/^(\d+(?:\.\d+)?)([KMGT])?$/i);
  if (!m) return undefined;
  const power = m[2] ? "KMGT".indexOf(m[2].toUpperCase()) + 1 : 0;
  return Math.round(Number(m[1]) * 1024 ** power);
}

/**
 * The queued list's total size, or null when no item's size is known. `unknown`
 * counts the items left out of `bytes`, so the popover can say the total is
 * incomplete rather than pass it off as the whole.
 */
export function queuedSize(
  items: { sizeBytes?: number }[],
): { bytes: number; unknown: number } | null {
  let bytes = 0;
  let unknown = 0;
  for (const i of items) {
    if (i.sizeBytes != null && i.sizeBytes > 0) bytes += i.sizeBytes;
    else unknown += 1;
  }
  return unknown === items.length ? null : { bytes, unknown };
}
