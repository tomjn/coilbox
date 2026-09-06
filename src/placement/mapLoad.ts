/**
 * What a map scene is still reading, stage by stage, for the indicator that
 * floats over it while it fills in.
 *
 * Each stage is one input the scene draws from. None waits for a later one
 * before its own result is shown, so the terrain is up while the models are
 * still being read and the indicator says which is which.
 */

export type StageState = "idle" | "loading" | "done" | "failed";

export interface ModelsStage {
  state: StageState;
  /** Unit types built so far, and how many this pass is reading. */
  done: number;
  total: number;
}

export interface MapLoad {
  minimap: StageState;
  heightPicture: StageState;
  exactHeights: StageState;
  skybox: StageState;
  unitDefs: StageState;
  models: ModelsStage;
}

export const IDLE_MAP_LOAD: MapLoad = {
  minimap: "idle",
  heightPicture: "idle",
  exactHeights: "idle",
  skybox: "idle",
  unitDefs: "idle",
  models: { state: "idle", done: 0, total: 0 },
};

/** One line of the indicator. */
export interface MapLoadRow {
  key: keyof MapLoad;
  label: string;
  state: StageState;
  /** Said after the label, for a stage with a count. */
  detail?: string;
}

const LABELS: Record<keyof MapLoad, string> = {
  minimap: "Map picture",
  heightPicture: "Relief",
  exactHeights: "Exact heights",
  skybox: "Sky",
  unitDefs: "Unit definitions",
  models: "Unit models",
};

const ORDER: (keyof MapLoad)[] = [
  "minimap",
  "heightPicture",
  "exactHeights",
  "skybox",
  "unitDefs",
  "models",
];

function stateOf(load: MapLoad, key: keyof MapLoad): StageState {
  return key === "models" ? load.models.state : load[key];
}

/** The stages worth a line: everything that was asked for. */
export function mapLoadRows(load: MapLoad): MapLoadRow[] {
  const rows: MapLoadRow[] = [];
  for (const key of ORDER) {
    const state = stateOf(load, key);
    if (state === "idle") continue;
    const row: MapLoadRow = { key, label: LABELS[key], state };
    if (key === "models" && load.models.total > 0) {
      row.detail = `${load.models.done} / ${load.models.total}`;
    }
    rows.push(row);
  }
  return rows;
}

/** Whether any stage is still being read. */
export function mapLoading(load: MapLoad): boolean {
  return ORDER.some((key) => stateOf(load, key) === "loading");
}

/** Whether any stage was asked for and would not read. */
export function mapLoadFailed(load: MapLoad): boolean {
  return ORDER.some((key) => stateOf(load, key) === "failed");
}
