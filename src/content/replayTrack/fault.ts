import { t } from "@lingui/core/macro";
import type { ReplayTrackFault } from "../bindings";

/**
 * A track or a window that could not be read (#3806). `kind` is the fault's
 * kind, so a page can tell a missing track from a stale one without reading the
 * message, and `fault` has the rest.
 */
export class ReplayTrackError extends Error {
  readonly fault: ReplayTrackFault;

  constructor(fault: ReplayTrackFault) {
    super(describeFault(fault));
    this.name = "ReplayTrackError";
    this.fault = fault;
  }

  get kind(): ReplayTrackFault["kind"] {
    return this.fault.kind;
  }
}

export function describeFault(fault: ReplayTrackFault): string {
  switch (fault.kind) {
    case "missing":
      return t`this replay has no recorded track`;
    case "stale": {
      const recorderVersion = fault.recorderVersion;
      const current = fault.current;
      return t`the track was made by recorder version ${recorderVersion} and this is ${current}`;
    }
    case "otherGame":
      return t`the track in this replay's place is for another game`;
    case "unknownFormat": {
      const field = fault.field;
      const found = fault.found;
      const expected = fault.expected;
      return t`the track's ${field} is ${found}, and this build reads ${expected}`;
    }
    case "unreadable": {
      const message = fault.message;
      return t`the track cannot be read: ${message}`;
    }
    case "corruptWindow": {
      const window = fault.window;
      const message = fault.message;
      return t`window ${window} cannot be read: ${message}`;
    }
    case "noSuchWindow": {
      const window = fault.window;
      const windowCount = fault.windowCount;
      return t`there is no window ${window}, the track has ${windowCount}`;
    }
    case "io": {
      const message = fault.message;
      return t`the track file failed: ${message}`;
    }
  }
}
