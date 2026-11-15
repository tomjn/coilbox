import { t } from "@lingui/core/macro";
import { useSyncExternalStore } from "react";
import { describeError } from "@/i18n/uiError";
import { type NotifyInput, notify } from "@/notify/notify";
import {
  type PictureSweepReport,
  type PictureSweepTarget,
  type PictureSweepTools,
  sweepGamePictures,
} from "../assets/pictureSweep";
import {
  hideUploadRun,
  runningSendFor,
  showUploadRun,
  updateUploadRun,
  uploadRunStopping,
} from "../assets/runningUploads";
import { resetHubGames } from "../gameIcons";
import {
  type SweepReport,
  type SweepTarget,
  type SweepTools,
  sweepMapCatalog,
} from "../maps/catalogSweep";
import { forgetKnownMap } from "../maps/knownMaps";
import {
  type MapPictureSweepReport,
  type MapPictureSweepTarget,
  type MapPictureSweepTools,
  sweepMapPictures,
} from "../maps/pictureSweep";
import type { HubSweepTarget } from "../sweepFrame";
import {
  bindGameTools,
  bindMapPictureTools,
  bindMapTools,
  type ManualRun,
} from "./bind";
import { beginManualSend, endManualSend, type SendSubject } from "./grant";

/**
 * One game or map sent to the hub because somebody pressed "Send to hub" on its
 * page.
 *
 * The send lives here rather than in the page, so it keeps going when they
 * leave, and the top bar badge is where they watch it. It runs the same sweeps
 * the Share panel does, narrowed to one item and given tools that carry the
 * grant (see `./bind`).
 */
export interface ManualSendRequest extends HubSweepTarget {
  subject: SendSubject;
  /** What a person calls it, for the badge and the closing message. */
  label: string;
}

/** Everything this reaches outside itself, so a test can stand in for it. */
export interface ManualSendTools {
  begin: typeof beginManualSend;
  end: typeof endManualSend;
  sweepGame: (
    target: PictureSweepTarget,
    tools: PictureSweepTools,
  ) => Promise<PictureSweepReport>;
  sweepMap: (target: SweepTarget, tools: SweepTools) => Promise<SweepReport>;
  sweepMapPicture: (
    target: MapPictureSweepTarget,
    tools: MapPictureSweepTools,
  ) => Promise<MapPictureSweepReport>;
  notify: (input: NotifyInput) => void;
}

export const liveManualSendTools: ManualSendTools = {
  begin: beginManualSend,
  end: endManualSend,
  sweepGame: (target, tools) => sweepGamePictures(target, () => {}, tools),
  sweepMap: (target, tools) => sweepMapCatalog(target, () => {}, tools),
  sweepMapPicture: (target, tools) =>
    sweepMapPictures(
      target,
      (progress) => {
        // The one part of a map send long enough to be worth a count.
        if (progress.phase === "sending" && target.only) {
          const run = runningSendFor("map", target.only);
          if (run) {
            updateUploadRun(run.opId, {
              phase: "sending",
              done: progress.done,
              total: progress.total,
            });
          }
        }
      },
      tools,
    ),
  notify: (input) => void notify(input),
};

/** The name a send is filed under in the badge's store. */
function subjectName(subject: SendSubject): string {
  return subject.kind === "game" ? subject.shortname : subject.map_name;
}

let finished = 0;
const listeners = new Set<() => void>();

/** Counts sends that have ended, so a page can ask the hub again after one. */
export function useManualSendsFinished(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => finished,
    () => finished,
  );
}

/**
 * Send one game or map, and say how it went in a notification.
 *
 * Never rejects. A second press for something already being sent does
 * nothing, which is also what a page reopened during a send would offer.
 */
export async function startManualSend(
  request: ManualSendRequest,
  tools: ManualSendTools = liveManualSendTools,
): Promise<void> {
  const { subject, label } = request;
  const name = subjectName(subject);
  if (runningSendFor(subject.kind, name)) return;

  const opId = crypto.randomUUID();
  // On screen before anything is asked, so the press has an answer at once.
  showUploadRun({
    opId,
    kind: subject.kind,
    subject: label,
    key: name,
    phase: "reading",
    total: 0,
  });

  let grant: string | null = null;
  try {
    grant = await tools.begin(subject);
    const run: ManualRun = { grant, opId };
    const said =
      subject.kind === "game"
        ? await sendGame(request, subject.shortname, run, tools)
        : await sendMap(request, subject.map_name, run, tools);
    tools.notify(
      uploadRunStopping(opId)
        ? {
            title: t`Stopped sending ${label}`,
            body: t`What had already gone stays on the hub.`,
          }
        : said,
    );
  } catch (e) {
    tools.notify(
      uploadRunStopping(opId)
        ? {
            title: t`Stopped sending ${label}`,
            body: t`What had already gone stays on the hub.`,
          }
        : {
            title: t`${label} was not sent to the hub`,
            body: describeError(e),
            level: "error",
          },
    );
  } finally {
    hideUploadRun(opId);
    if (grant) {
      await tools.end(grant).catch((e: unknown) => {
        console.warn("could not end hub send grant", e);
      });
    }
    forgetAnswers(request);
    finished += 1;
    for (const listener of listeners) listener();
  }
}

async function sendGame(
  request: ManualSendRequest,
  shortname: string,
  run: ManualRun,
  tools: ManualSendTools,
): Promise<NotifyInput> {
  const { label } = request;
  const bound = bindGameTools(run);
  const report = await tools.sweepGame(
    { ...target(request), only: shortname },
    {
      ...bound,
      publishFacts: async (...args) => {
        try {
          return await bound.publishFacts(...args);
        } catch (e) {
          // The sweep carries on to the pictures after a facts failure, which
          // suits a library run. A send of one game that failed at its facts
          // has failed, so the bound tools refuse every call after this.
          run.abort = describeError(e);
          throw e;
        }
      },
    },
  );
  const failed = run.abort ?? report.failed[0]?.said;
  if (failed) {
    return {
      title: t`${label} was not sent to the hub`,
      body: failed,
      level: "error",
    };
  }
  const one = report.games[0];
  if (!one) {
    return {
      title: t`${label} was not sent to the hub`,
      body: t`Coilbox only sends a released version of a game.`,
      level: "error",
    };
  }
  if (one.stopped) {
    return {
      title: t`Sent part of ${label} to the hub`,
      body: one.stopped,
      level: "warning",
    };
  }
  return { title: t`Sent ${label} to the hub`, level: "success" };
}

async function sendMap(
  request: ManualSendRequest,
  mapName: string,
  run: ManualRun,
  tools: ManualSendTools,
): Promise<NotifyInput> {
  const { label } = request;
  const facts = await tools.sweepMap(
    { ...target(request), only: mapName },
    bindMapTools(run),
  );
  if (facts.read === 0) {
    return {
      title: t`${label} was not sent to the hub`,
      body: facts.errors[0] ?? t`Coilbox could not read the map.`,
      level: "error",
    };
  }
  const refused = facts.problems[0];
  if (refused) {
    return {
      title: t`${label} was not sent to the hub`,
      body: refused.said ?? t`The hub would not take it.`,
      level: "error",
    };
  }
  const picture = await tools.sweepMapPicture(
    { ...target(request), only: mapName },
    bindMapPictureTools(run),
  );
  if (picture.stopped) {
    return {
      title: t`Sent part of ${label} to the hub`,
      body: picture.stopped,
      level: "warning",
    };
  }
  return { title: t`Sent ${label} to the hub`, level: "success" };
}

function target(request: ManualSendRequest): HubSweepTarget {
  return {
    hubUrl: request.hubUrl,
    enginePath: request.enginePath,
    dataDir: request.dataDir,
  };
}

/** Drop what the page last heard from the hub, so it asks again. */
function forgetAnswers(request: ManualSendRequest): void {
  if (request.subject.kind === "game") resetHubGames();
  else forgetKnownMap(request.hubUrl, request.subject.map_name);
}
