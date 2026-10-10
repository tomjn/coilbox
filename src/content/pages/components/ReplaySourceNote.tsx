import { openUrl } from "@tauri-apps/plugin-opener";
import {
  REPLAY_SOURCE_NOTES,
  REPLAY_SOURCES_DOC_URL,
  type ReplaySource,
} from "../../replaySources";

/**
 * One muted line under a replay section's heading that says which source its
 * numbers come from, with a way to the docs page that explains the sources
 * (#1173). The wording is in `replaySources.ts`. `detail` adds a sentence the
 * section knows from its own data, such as how often the engine sampled.
 */
export function ReplaySourceNote({
  source,
  detail,
}: {
  source: ReplaySource;
  detail?: string;
}) {
  return (
    <p className="text-xs text-muted-foreground">
      {REPLAY_SOURCE_NOTES[source]}
      {detail ? ` ${detail}` : ""}{" "}
      <button
        type="button"
        className="rounded-sm underline hover:no-underline focus-visible:ring-1 focus-visible:ring-ring"
        onClick={() => openUrl(REPLAY_SOURCES_DOC_URL).catch(() => {})}
      >
        Where these numbers come from
      </button>
    </p>
  );
}
