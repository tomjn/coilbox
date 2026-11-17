import { t } from "@lingui/core/macro";
import { unitsyncUploadFacts } from "../content/bindings";
import { preferredTarget, targetsFromState } from "../content/config";
import { loadContentState } from "../content/contentState";
import { shareInFlight } from "../content/inFlight";
import type { ArchiveFacts } from "../hub/archiveUploads";
import {
  readStoredSettingIfInstalled,
  writeStoredSetting,
} from "../lib/storedSetting";
import { notify } from "../notify/notify";
import { getHubMapBase } from "./hubMapBase";
import { indexTick } from "./mirrorIndex";

/**
 * Telling the hub when a downloaded map or game is not what the hub lists
 * (issue #5267).
 *
 * A hub download that carried a `sha256` is only installed when the file has that
 * hash, so every player gets the same bytes. That says nothing about what the
 * bytes are. The hub's catalogue lists, for each hash, the kind, shortname, name
 * and version the uploader's Coilbox read from the file. When the archive on disk
 * reads differently, the file is not what the hub says it is, and one anonymous
 * report lets a moderator look.
 *
 * A hash mismatch never gets here. `dl_download_file` deletes that file and the
 * walk moves to the next source, which is the mirror's fault and not the hub's
 * listing. Only a file that matched its hash is checked.
 *
 * The catalogue is not signature-checked. Coilbox pins no hub key, and the
 * catalogue only decides whether to send a report the hub then checks against its
 * own records: a wrong catalogue gets a 422 from the hub, or a moderator looks and
 * finds nothing. It is fetched over TLS from the configured hub, as every other
 * hub answer is.
 *
 * Reports go to the configured hub address and never to the old Vercel one,
 * which proxies requests, so the hub would see one sender for every player and
 * rate limit them together.
 */

/** What the hub's catalogue lists for one archive. */
export interface ListedArchive {
  sha256: string;
  kind: "map" | "game";
  shortname: string | null;
  internal_name: string;
  version: string;
}

/** The fields of a report's `found`: only those that differ from the hub's. */
export interface FoundFacts {
  kind?: "map" | "game";
  shortname?: string | null;
  internal_name?: string;
  version?: string;
}

/**
 * What differs between what the hub lists and what the archive reads as, or null
 * when they agree. Compares exactly: the facts reader already trims the text, and
 * the hub holds what the uploader's reader sent.
 */
export function differingFacts(
  listed: ListedArchive,
  read: Pick<ArchiveFacts, "kind" | "shortname" | "internal_name" | "version">,
): FoundFacts | null {
  const found: FoundFacts = {};
  if (read.kind !== listed.kind) found.kind = read.kind;
  if (read.shortname !== listed.shortname) found.shortname = read.shortname;
  if (read.internal_name !== listed.internal_name)
    found.internal_name = read.internal_name;
  if (read.version !== listed.version) found.version = read.version;
  return Object.keys(found).length > 0 ? found : null;
}

/* ---- The catalogue --------------------------------------------------------- */

const isText = (v: unknown): v is string => typeof v === "string";

/** The archives of a catalogue body, by hash. Entries that are not whole are dropped. */
export function readCatalogue(body: unknown): Map<string, ListedArchive> {
  const out = new Map<string, ListedArchive>();
  const archives = (body as { archives?: unknown } | null)?.archives;
  if (!Array.isArray(archives)) throw new Error("no archives list");
  for (const a of archives as Record<string, unknown>[]) {
    if (
      a &&
      isText(a.sha256) &&
      (a.kind === "map" || a.kind === "game") &&
      isText(a.internal_name) &&
      isText(a.version) &&
      (a.shortname === null || isText(a.shortname))
    ) {
      out.set(a.sha256, {
        sha256: a.sha256,
        kind: a.kind,
        shortname: a.shortname,
        internal_name: a.internal_name,
        version: a.version,
      });
    }
  }
  return out;
}

const trimBase = (base: string) => base.replace(/\/+$/, "");

interface HeldCatalogue {
  at: number;
  byHash: Map<string, ListedArchive>;
}

const catalogues = new Map<string, HeldCatalogue>();
const catalogueRequests = new Map<string, Promise<HeldCatalogue>>();

/** Forget what was fetched, for tests. */
export function forgetCatalogues(): void {
  catalogues.clear();
  catalogueRequests.clear();
}

function fetchCatalogue(base: string): Promise<HeldCatalogue> {
  return shareInFlight(catalogueRequests, base, async () => {
    const response = await fetch(`${trimBase(base)}/api/v1/catalogue`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`catalogue answered ${response.status}`);
    const held = {
      at: indexTick(),
      byHash: readCatalogue(await response.json()),
    };
    catalogues.set(base, held);
    return held;
  });
}

/**
 * What the hub lists for `sha256`, or undefined when it lists nothing. The
 * catalogue is held for the session. A hash it does not hold fetches it once
 * more, unless the held copy loaded after `askedAt`, when this check began.
 */
export async function listedArchive(
  base: string,
  sha256: string,
  askedAt: number,
): Promise<ListedArchive | undefined> {
  const held = catalogues.get(base) ?? (await fetchCatalogue(base));
  const hit = held.byHash.get(sha256);
  if (hit || held.at > askedAt) return hit;
  return (await fetchCatalogue(base)).byHash.get(sha256);
}

/* ---- The report ------------------------------------------------------------ */

/** The most a report body may be, as the hub states it. */
const MAX_BODY_BYTES = 4096;

/** Every way sending a report can end. `status` is the hub's HTTP status. */
export type ReportOutcome =
  /** 202. A moderator will look. */
  | { kind: "recorded" }
  /** 200. This address already reported this archive and it is still open. */
  | { kind: "already" }
  /** 400, 404, 413, 422 or any other refusal: sending it again changes nothing. */
  | { kind: "refused"; status: number; reason: string }
  /** 429. Too many reports from this address in the last hour. */
  | { kind: "rate_limited" }
  /** 503. The hub asks to try later. */
  | { kind: "unavailable" }
  /** No answer at all, or the report was too large to send. */
  | { kind: "not_sent"; why: string };

/** The `reason` of a hub error body, or an empty string. */
async function reasonOf(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { reason?: unknown } | null;
    return isText(body?.reason) ? body.reason : "";
  } catch {
    return "";
  }
}

/** Send one report to `${base}/api/v1/archives/mismatch`. Never throws. */
export async function sendMismatchReport(
  base: string,
  sha256: string,
  found: FoundFacts,
): Promise<ReportOutcome> {
  const body = JSON.stringify({ sha256, found });
  if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) {
    return {
      kind: "not_sent",
      why: "the report is over the size the hub takes",
    };
  }
  let response: Response;
  try {
    response = await fetch(`${trimBase(base)}/api/v1/archives/mismatch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
  } catch (e) {
    return {
      kind: "not_sent",
      why: e instanceof Error ? e.message : String(e),
    };
  }
  switch (response.status) {
    case 202:
      return { kind: "recorded" };
    case 200:
      return { kind: "already" };
    case 429:
      return { kind: "rate_limited" };
    case 503:
      return { kind: "unavailable" };
    default:
      return {
        kind: "refused",
        status: response.status,
        reason: await reasonOf(response),
      };
  }
}

/* ---- What has been reported ------------------------------------------------ */

export const MISMATCH_REPORTED_KEY = "downloads.hubMismatchReported";

/**
 * The hashes already dealt with, kept in the settings store so a restart does not
 * report the same download again. A hash is kept when the hub has the report or
 * refused it for a reason that sending again cannot change. One that could not
 * be sent is not, so the next download of it tries again.
 */
function reportedHashes(): string[] {
  return readStoredSettingIfInstalled<string[]>(MISMATCH_REPORTED_KEY, []);
}

export function wasReported(sha256: string): boolean {
  return reportedHashes().includes(sha256);
}

function rememberReported(sha256: string): void {
  const held = reportedHashes();
  if (!held.includes(sha256)) {
    writeStoredSetting(MISMATCH_REPORTED_KEY, [...held, sha256]);
  }
}

/* ---- Checking a download --------------------------------------------------- */

/**
 * How long to wait before the one retry on a 503. A guess: nothing here measures
 * how long the hub takes to recover. A retry that comes too soon only loses that
 * report, and since a report that was not sent is not remembered, the next
 * download of the same file sends it again.
 */
export const RETRY_AFTER_MS = 60_000;

const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** The content folder a download's folder (`<root>/maps` or `<root>/games`) is in. */
export function rootOf(destDir: string): string {
  return destDir.replace(/[\\/]+$/, "").replace(/[\\/][^\\/]*$/, "");
}

/** Hashes being checked now, so two downloads of one file report once. */
const checking = new Set<string>();

export interface CheckedDownload {
  /** The hash the file was downloaded against and matched. */
  sha256: string;
  /** The folder it was saved in, `<content folder>/maps` or `/games`. */
  destDir: string;
  /** What it was saved as. */
  filename: string;
}

/** Say the file is not what the hub lists, and whether the hub has been told. */
function tell(filename: string, hubTold: boolean): void {
  void notify({
    title: t`Not what the hub says it is`,
    body: hubTold
      ? t`${filename} is not what the hub says it is. The hub has been told. The file stays installed.`
      : t`${filename} is not what the hub says it is. Coilbox could not tell the hub. The file stays installed.`,
    level: "warning",
    sticky: true,
  });
}

/**
 * After a hub download whose hash matched: read the archive, compare it with
 * what the hub lists for that hash, and tell the hub when they differ.
 *
 * Runs after the file is on disk and never rejects, so it can be started and left
 * alone. A check that cannot finish, with no hub, no engine, an unreadable
 * archive or a catalogue that will not load, ends without a report.
 */
export async function checkHubDownload(
  file: CheckedDownload,
  askedAt = indexTick(),
): Promise<void> {
  const { sha256, destDir, filename } = file;
  const base = getHubMapBase();
  if (!base || wasReported(sha256) || checking.has(sha256)) return;
  checking.add(sha256);
  try {
    const listed = await listedArchive(base, sha256, askedAt);
    if (!listed) return;

    const target = preferredTarget(
      targetsFromState(await loadContentState()),
      "",
    );
    if (!target) return;
    const answer = await unitsyncUploadFacts({
      enginePath: target.enginePath,
      dataDir: rootOf(destDir),
      ...(listed.kind === "map"
        ? { mapArchive: filename }
        : { game: filename }),
    });
    const read = answer.facts;
    // Another archive of the same name earlier in the search path would be read
    // here instead of this file, and comparing it would report the wrong one.
    if (!read || read.sha256 !== sha256) return;
    const found = differingFacts(listed, read);
    if (!found) return;

    let outcome = await sendMismatchReport(base, sha256, found);
    if (outcome.kind === "unavailable") {
      await wait(RETRY_AFTER_MS);
      outcome = await sendMismatchReport(base, sha256, found);
    }
    switch (outcome.kind) {
      case "recorded":
      case "already":
        rememberReported(sha256);
        tell(filename, true);
        return;
      case "refused":
        // A 422 `agrees` is a comparison bug here. A 400 is a report this code
        // should not have built. A 404 is an archive the hub no longer lists.
        // None changes by sending again, and none is the player's concern.
        console.error(
          `hub mismatch report for ${sha256} refused (${outcome.status} ${outcome.reason})`,
          found,
        );
        if (outcome.status !== 404) rememberReported(sha256);
        return;
      case "rate_limited":
      case "unavailable":
      case "not_sent":
        console.warn(`hub mismatch report for ${sha256} not sent`, outcome);
        tell(filename, false);
        return;
    }
  } catch (e) {
    console.warn("hub mismatch check failed", e);
  } finally {
    checking.delete(sha256);
  }
}
