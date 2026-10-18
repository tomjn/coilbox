import type { QueueItem } from "../DownloadQueueProvider";
import type { DownloadHistory } from "../downloadHistory";
import { IDLE_RATE } from "../downloadRate";

/**
 * One of each row the Library > Downloads page draws (issue #4583): a game
 * downloading from GitHub, a map waiting its turn, a map that stopped with a
 * mirror left to try, and a game installed from rapid known only from history.
 */

const T = Date.parse("2026-10-18T21:00:00Z");

export const DOWNLOADING: QueueItem = {
  kind: "game",
  label: "Zero-K v1.12.5",
  args: { gameName: "Zero-K v1.12.5", writePath: "/data" },
  id: "dl-zk",
  identity: "game:Zero-K v1.12.5",
  status: "active",
  progress: {
    phase: "downloading",
    downloadedBytes: 62_000_000,
    totalBytes: 100_000_000,
    percent: 62,
    bytesPerSec: 42_000_000,
  },
  rate: { bytesPerSec: 42_000_000, secondsLeft: 60, stalled: false },
  startedAt: T,
  error: null,
  next: null,
  trying: { source: "github", mirror: "github.com" },
};

export const QUEUED: QueueItem = {
  kind: "mapAnySource",
  label: "Map: Isis",
  args: { mapName: "Isis", writePath: "/data" },
  sizeBytes: 12 * 1024 * 1024,
  id: "dl-isis",
  identity: "mapAnySource:Isis",
  status: "queued",
  progress: null,
  rate: IDLE_RATE,
  startedAt: null,
  error: null,
  next: null,
};

export const FAILED: QueueItem = {
  kind: "mapAnySource",
  label: "Map: Supreme Isthmus",
  args: { mapName: "Supreme_Isthmus_v2", writePath: "/data" },
  id: "dl-isthmus",
  identity: "mapAnySource:Supreme_Isthmus_v2",
  status: "error",
  progress: null,
  rate: IDLE_RATE,
  startedAt: T - 60_000,
  settledAt: T - 50_000,
  error: "springfiles.springrts.com answered 404 for Supreme_Isthmus_v2.sd7",
  next: { source: "springfiles", mirror: "mirror2.springfiles.test" },
};

export const HISTORY: DownloadHistory = {
  "map:supreme_isthmus_v2": {
    "springfiles|springfiles.springrts.com": {
      source: "springfiles",
      outcome: "failed",
      reference:
        "https://springfiles.springrts.com/files/Supreme_Isthmus_v2.sd7",
      filename: "Supreme_Isthmus_v2.sd7",
      md5: null,
      mirror: "springfiles.springrts.com",
      failure:
        "springfiles.springrts.com answered 404 for Supreme_Isthmus_v2.sd7",
      detail: "HTTP status client error (404 Not Found)",
      durationMs: 800,
      at: new Date(T - 55_000).toISOString(),
    },
  },
  "game:splinter faction": {
    "rapid|repos.springrts.com": {
      source: "rapid",
      outcome: "ok",
      reference: "Splinter Faction 0.1.86",
      filename: null,
      md5: null,
      mirror: "repos.springrts.com",
      failure: null,
      durationMs: 42_000,
      at: "2026-10-02T12:00:00.000Z",
    },
  },
};
