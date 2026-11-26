import { t } from "@lingui/core/macro";
import type { OfficialEngineBuild } from "./bindings";

/**
 * Engine builds the hub offers beside the official Recoil releases, such as
 * macOS test builds. The hub half is `GET /api/v1/engines` in coilbox-hub
 * (`app/Domain/Engines/Engines.php`).
 */

/** The warning the hub shows beside every engine it offers, word for word
 *  (`Engines::WARNING`). */
export const HUB_ENGINE_WARNING =
  "Unofficial test build. Not made or supported by the Recoil team. It may crash, desync in multiplayer or damage your settings. Use it only if you know why you want it.";

/** The longest note the hub takes (`Engines::NOTE_MAX`). */
export const HUB_ENGINE_NOTE_MAX = 1000;

export interface HubEngine {
  version: string;
  platform: string;
  filename: string;
  size: number;
  sha256: string;
  note: string;
  listedAt: string;
  pageUrl: string;
  /** One address on each healthy mirror that holds the build. */
  sources: string[];
}

const text = (v: unknown): v is string => typeof v === "string";

/** Read the hub's answer. An entry missing a field is dropped, not fatal, so
 *  one bad row does not hide the rest. */
export function parseHubEngines(body: unknown): HubEngine[] {
  const list = (body as { engines?: unknown } | null)?.engines;
  if (!Array.isArray(list))
    throw new Error(t`The hub sent an engine list Coilbox could not read.`);
  const out: HubEngine[] = [];
  for (const raw of list) {
    const e = raw as Record<string, unknown> | null;
    if (
      !e ||
      !text(e.version) ||
      !text(e.platform) ||
      !text(e.filename) ||
      typeof e.size !== "number" ||
      !text(e.sha256) ||
      !Array.isArray(e.sources)
    ) {
      continue;
    }
    out.push({
      version: e.version,
      platform: e.platform,
      filename: e.filename,
      size: e.size,
      sha256: e.sha256,
      note: text(e.note) ? e.note : "",
      listedAt: text(e.listed_at) ? e.listed_at : "",
      pageUrl: text(e.page_url) ? e.page_url : "",
      sources: e.sources.filter(text),
    });
  }
  return out;
}

/** The hub's engine builds for one platform, newest first. */
export async function fetchHubEngines(
  hubUrl: string,
  platform: string,
  signal?: AbortSignal,
): Promise<HubEngine[]> {
  const url = new URL("/api/v1/engines", hubUrl);
  url.searchParams.set("platform", platform);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json" },
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    const host = url.host;
    throw new Error(t`Could not reach the hub at ${host}.`);
  }
  if (!response.ok) {
    const status = response.status;
    throw new Error(t`The hub refused the engine list (HTTP ${status}).`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(t`The hub sent an engine list Coilbox could not read.`);
  }
  return parseHubEngines(body);
}

/** Whether an official Recoil release publishes this version for this
 *  platform. */
export function hasOfficialBuild(
  builds: readonly OfficialEngineBuild[],
  version: string,
  platform: string,
): boolean {
  return builds.some((b) => b.version === version && b.platform === platform);
}

/** The hub builds worth offering: ones for `platform` that some mirror holds
 *  and no official release already covers. */
export function offeredHubEngines(
  engines: readonly HubEngine[],
  builds: readonly OfficialEngineBuild[],
  platform: string,
): HubEngine[] {
  return engines.filter(
    (e) =>
      e.platform === platform &&
      e.sources.length > 0 &&
      !hasOfficialBuild(builds, e.version, e.platform),
  );
}

/** Whether an engine of this version is already installed, by its folder
 *  name or the version the engine reported once checked. */
export function isEngineInstalled(
  installed: readonly { version: string; syncVersion?: string }[],
  version: string,
): boolean {
  return installed.some(
    (e) => e.version === version || e.syncVersion?.split(" ")[0] === version,
  );
}
