/**
 * The content roots whose widgets the page lists (issue #4861).
 *
 * Every engine coilbox starts gets all the player's content roots in
 * `SPRING_DATADIR`, and the engine lists a widget folder across all of them, so
 * a widget in any root loads. The selected root comes first, because that is
 * where a widget is added.
 */

import {
  type ContentState,
  contentPlayerWidgets,
  type PlayerWidgetScan,
} from "@/content/bindings";
import { loadContentState } from "@/content/contentState";
import { errorText } from "@/lib/helpers";
import { HANDLER_FOLDERS } from "./handlers";

/** The roots the engine reads, `primary` first. A root that is not there or
 *  does not validate is left out, as `SPRING_DATADIR` leaves it out. */
export function widgetRoots(
  state: ContentState | null,
  primary: string,
): string[] {
  const others = (state?.roots ?? [])
    .filter((r) => r.exists && r.valid && r.path !== primary)
    .map((r) => r.path);
  return [primary, ...others];
}

/** {@link widgetRoots} from the held content state. */
export async function loadWidgetRoots(primary: string): Promise<string[]> {
  return widgetRoots(await loadContentState(), primary);
}

/**
 * Scan the widget folders of every root and join the results. `folders` and
 * `caseSensitive` are the first root's, because those serve the root widgets
 * are added to. A root other than the first that cannot be scanned is said in
 * `errors` and the rest still list, but the first failing throws.
 */
export async function scanWidgetRoots(
  roots: readonly string[],
): Promise<PlayerWidgetScan> {
  const scans = await Promise.all(
    roots.map(async (root, i) => {
      try {
        return await contentPlayerWidgets({
          writeDir: root,
          folders: HANDLER_FOLDERS,
        });
      } catch (e) {
        if (i === 0) throw e;
        return {
          caseSensitive: false,
          folders: [],
          files: [],
          errors: [`could not read ${root}: ${errorText(e)}`],
        } satisfies PlayerWidgetScan;
      }
    }),
  );
  const [first] = scans;
  return {
    caseSensitive: first?.caseSensitive ?? false,
    folders: first?.folders ?? [],
    files: scans.flatMap((s) => s.files),
    errors: scans.flatMap((s) => s.errors),
  };
}

/** Scan the roots the engine reads, with `primary` first. */
export async function scanWidgets(primary: string): Promise<PlayerWidgetScan> {
  return scanWidgetRoots(await loadWidgetRoots(primary));
}
