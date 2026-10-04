/**
 * What an import's `finish` throws to stop before it creates anything and ask
 * the player what to do (issue #3488). It is not a failure of the import. The
 * player may still create the document, and the form says what that costs.
 */
export class ImportHold extends Error {
  /** What went wrong when the data could not be read, shown beside the message. */
  readonly detail?: string;
  /** A fact about the challenge the player cannot change. */
  readonly note?: string;
  /** Whether reading again might give a different answer. */
  readonly canRetry: boolean;
  /** The label of the button that creates the document regardless. */
  readonly acceptLabel: string;

  constructor(init: {
    message: string;
    detail?: string;
    note?: string;
    canRetry: boolean;
    acceptLabel: string;
  }) {
    super(init.message);
    this.name = "ImportHold";
    this.detail = init.detail;
    this.note = init.note;
    this.canRetry = init.canRetry;
    this.acceptLabel = init.acceptLabel;
  }
}
