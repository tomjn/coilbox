import { Channel } from "@tauri-apps/api/core";
import {
  contentReplayTrackHeader,
  contentReplayTrackWindow,
  type ReplayTrackHeader,
} from "../bindings";
import { ReplayTrackError } from "./fault";
import { decodeWindowPayload, type TrackWindow } from "./trackWindow";

/**
 * A replay's track header (#3806). Reading it marks the track watched. Throws a
 * {@link ReplayTrackError} when the track is missing, stale, for another game,
 * in a layout this build does not read, or unreadable.
 */
export async function readTrackHeader(
  gameId: string,
): Promise<ReplayTrackHeader> {
  const answer = await contentReplayTrackHeader({ gameId });
  if (!answer.ok) throw new ReplayTrackError(answer.fault);
  return answer.header;
}

/**
 * One window's bytes. The command answers on one path and sends the bytes on
 * another, so this waits for both, in either order. A fault is thrown as soon
 * as the answer says so, since no bytes follow it.
 *
 * Every call makes its own channel. A channel handed to a second command stops
 * delivering.
 */
export async function readTrackWindow(
  gameId: string,
  window: number,
): Promise<ArrayBuffer> {
  let deliver: (bytes: ArrayBuffer) => void = () => {};
  const arrived = new Promise<ArrayBuffer>((resolve) => {
    deliver = resolve;
  });
  const channel = new Channel<ArrayBuffer>();
  channel.onmessage = deliver;

  const answer = await contentReplayTrackWindow({
    gameId,
    window,
    onWindow: channel,
  });
  if (!answer.ok) throw new ReplayTrackError(answer.fault);
  const bytes = await arrived;
  if (bytes.byteLength !== answer.byteLength) {
    throw new ReplayTrackError({
      kind: "unreadable",
      message: `window ${window} arrived as ${bytes.byteLength} bytes and the answer said ${answer.byteLength}`,
    });
  }
  return bytes;
}

/**
 * Reads windows of one track and cuts them into typed arrays. `rotationBits`
 * is the header's.
 */
export function windowLoader(
  gameId: string,
  rotationBits: number,
): (window: number) => Promise<TrackWindow> {
  return async (window) =>
    decodeWindowPayload(await readTrackWindow(gameId, window), rotationBits);
}
