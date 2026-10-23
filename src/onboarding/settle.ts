import {
  BACKGROUND_IDS,
  PAGE_IDS,
  type PageId,
  SETTLED_KEY,
  type SettleId,
} from "./ids";

/** true: worth showing, false: nothing to ask, null: not known yet. */
export type Relevance = boolean | null;

export type AskedPage = Exclude<PageId, "done">;

export type RunPlan =
  | { status: "waiting" }
  | { status: "none"; settleNow: SettleId[] }
  | {
      status: "open";
      pages: PageId[];
      settleNow: SettleId[];
      newPagesRun: boolean;
    };

export function planRun(args: {
  settled: readonly string[];
  relevance: Record<AskedPage, Relevance>;
  rerun: boolean;
}): RunPlan {
  const { settled, relevance, rerun } = args;
  const asked = PAGE_IDS.filter((id): id is AskedPage => id !== "done");
  const candidates = asked.filter((id) => rerun || !settled.includes(id));
  if (candidates.some((id) => relevance[id] === null))
    return { status: "waiting" };

  const settleNow: SettleId[] = candidates.filter(
    (id) => relevance[id] === false,
  );
  const shown = candidates.filter((id) => relevance[id] === true);
  const needsDone = rerun || !settled.includes("done");

  if (shown.length === 0) {
    if (needsDone) settleNow.push("done");
    return { status: "none", settleNow };
  }
  const pages: PageId[] = needsDone ? [...shown, "done"] : shown;
  return {
    status: "open",
    pages,
    settleNow,
    newPagesRun: !rerun && settled.includes("done"),
  };
}

export function addSettled(
  settled: readonly string[],
  ids: readonly SettleId[],
): string[] {
  return [...new Set([...settled, ...ids])];
}

export function seedExistingInstall(
  storage: { get(k: string): string | null; set(k: string, v: string): void },
  loadedKeyCount: number,
): void {
  if (loadedKeyCount > 0 && storage.get(SETTLED_KEY) === null) {
    storage.set(SETTLED_KEY, JSON.stringify([...PAGE_IDS, ...BACKGROUND_IDS]));
  }
}
