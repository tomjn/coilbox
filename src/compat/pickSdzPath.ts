import { t } from "@lingui/core/macro";
import { save } from "@tauri-apps/plugin-dialog";

/** Ask where to export the mutator in `folder`. Null when the player cancels. */
export function pickSdzPath(folder: string): Promise<string | null> {
  return save({
    title: t`Export compatibility mutator`,
    defaultPath: folder.replace(/\.sdd$/i, ".sdz"),
    filters: [{ name: t`Mutator archive`, extensions: ["sdz"] }],
  });
}
