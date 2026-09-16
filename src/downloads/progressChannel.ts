import { Channel } from "@tauri-apps/api/core";
import type { DownloadProgress } from "./bindings";

/**
 * Where a running download's samples go. `null` means nothing has been measured
 * yet, which is where every attempt starts and what a bar should read as "no
 * progress to draw" rather than as a percentage.
 */
export type ProgressSink = (sample: DownloadProgress | null) => void;

/**
 * A progress channel for one backend command, and one only.
 *
 * A `Channel` cannot be reused across commands, and sharing one is silent: the
 * download runs to the end and the samples just stop arriving. Tauri builds a
 * fresh Rust `Channel` per command from the id the frontend serialised, and each
 * of those numbers its messages from zero, while the frontend's `Channel` object
 * counts up for its whole life and only reads a message whose number is the next
 * one it wants. So a second command's first sample is numbered 0 against a
 * frontend already past 40, is filed under an index long since used, and is
 * never read. The Rust channel also tells the frontend it has ended when the
 * command returns, which unregisters the callback outright.
 *
 * That is what left a joiner's game download bar at 4 percent while the
 * download itself carried on and finished (issue #2861): the source that
 * succeeded was not the first one tried, so it streamed into a channel nothing
 * was listening to any more.
 *
 * Creating the channel also clears the sink, because a new command is a new
 * attempt and the last one's percentage says nothing about this one.
 */
export function progressChannel(sink: ProgressSink): Channel<DownloadProgress> {
  sink(null);
  const channel = new Channel<DownloadProgress>();
  channel.onmessage = (sample) => sink(sample);
  return channel;
}
