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
      return "this replay has no recorded track";
    case "stale":
      return `the track was made by recorder version ${fault.recorderVersion} and this is ${fault.current}`;
    case "otherGame":
      return "the track in this replay's place is for another game";
    case "unknownFormat":
      return `the track's ${fault.field} is ${fault.found}, and this build reads ${fault.expected}`;
    case "unreadable":
      return `the track cannot be read: ${fault.message}`;
    case "corruptWindow":
      return `window ${fault.window} cannot be read: ${fault.message}`;
    case "noSuchWindow":
      return `there is no window ${fault.window}, the track has ${fault.windowCount}`;
    case "io":
      return `the track file failed: ${fault.message}`;
  }
}
