import type { DownloadAttempt, DownloadSourceKind } from "./downloadHistory";
import { describeFailure } from "./failureReason";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Fetching = Pick<DownloadAttempt, "reference" | "filename" | "mirror">;
const NOTHING: Fetching = { reference: null, filename: null, mirror: null };

/**
 * Keeps the books for a download that tries several sources: what the attempt
 * in hand is fetching, how long it has run, and a line for each failure to put
 * in the error if every source fails. Told about each attempt as it ends.
 */
export class AttemptLog {
  /** `label: reason` for each failed attempt, in order. */
  readonly errors: string[] = [];
  private fetching = NOTHING;
  private startedAt = Date.now();
  private recordAs: DownloadSourceKind = "url";
  private label = "";

  constructor(private readonly onAttempt?: (a: DownloadAttempt) => void) {}

  /**
   * Start an attempt. `recordAs` is the source the history names when that
   * differs from the step, and `label` heads the failure line.
   */
  begin(
    source: DownloadSourceKind,
    fetching: Partial<Fetching> = {},
    opts: { recordAs?: DownloadSourceKind; label?: string } = {},
  ): void {
    this.startedAt = Date.now();
    this.fetching = { ...NOTHING, ...fetching };
    this.recordAs = opts.recordAs ?? source;
    this.label = opts.label ?? source;
  }

  ok(): void {
    this.emit("ok", null, null);
  }

  /** The attempt in hand failed. `label` overrides the one from `begin`. */
  fail(e: unknown, label?: string): void {
    const raw = msg(e);
    const reason = describeFailure(raw, {
      host: this.fetching.mirror,
      filename: this.fetching.filename,
    });
    this.errors.push(`${label ?? this.label}: ${reason}`);
    this.emit("failed", reason, raw);
  }

  private emit(
    outcome: DownloadAttempt["outcome"],
    failure: string | null,
    detail: string | null,
  ): void {
    this.onAttempt?.({
      source: this.recordAs,
      outcome,
      ...this.fetching,
      md5: null,
      failure,
      detail,
      durationMs: Date.now() - this.startedAt,
    });
  }
}

/**
 * One place a download can be fetched from: a kind of source and, when it has
 * several hosts, one of them. A null mirror means the kind's first host.
 */
export interface SourceStep {
  source: DownloadSourceKind;
  mirror: string | null;
}

/**
 * What a download that tries several sources throws when it gives up, whether
 * every source failed or the player cancelled part way. `next` is the first
 * source it did not get to, which is what a retry button offers (issue #4577).
 * It is null once everything has been tried.
 */
export class SourceWalkError extends Error {
  constructor(
    message: string,
    readonly next: SourceStep | null,
  ) {
    super(message);
    this.name = "SourceWalkError";
  }
}

/** `order` from the step a retry asked to start at, or all of it. */
export function orderFrom<T extends DownloadSourceKind>(
  order: readonly T[],
  startAt?: SourceStep,
): T[] {
  const at = startAt ? order.indexOf(startAt.source as T) : -1;
  return order.slice(Math.max(at, 0));
}

export const isCancel = (e: unknown) =>
  /cancel/i.test(e instanceof Error ? e.message : String(e));

/**
 * The sources after `current` in `order`, as the next step to offer. Their hosts
 * are not known until the source is reached, so the step names the kind alone.
 */
export function nextKind<T extends DownloadSourceKind>(
  order: readonly T[],
  current: T,
): SourceStep | null {
  const after = order[order.indexOf(current) + 1];
  return after ? { source: after, mirror: null } : null;
}
