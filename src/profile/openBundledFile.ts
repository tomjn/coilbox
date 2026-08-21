import { notify } from "../notify/notify";
import { openProfileFile } from "./refs";

/**
 * Act on a click on a link to a file a distribution bundled in its `.coilbox`
 * folder, given the path relative to that folder.
 *
 * One implementation for every surface a distribution can write a link on: a
 * markdown page, the branded welcome, and the home page's own markup. The same
 * `href` therefore does the same thing wherever the author put it, which is the
 * point of issue #1802. Rust picks between opening the file and showing it in
 * the file manager, and owns the list of types it will open, so nothing here
 * decides what may run.
 *
 * A failure is the one case where the click genuinely achieves nothing, so it
 * says so rather than leaving somebody looking at a page that ignored them. The
 * message Rust wrote names the file and why: it is not there, it is outside the
 * folder, or this install has no `.coilbox` folder at all. The console keeps the
 * error for whoever wrote the link.
 */
export function openBundledFile(path: string): void {
  openProfileFile(path).catch((err: unknown) => {
    console.warn(`profile: could not open the file "${path}"`, err);
    notify({
      title: "Could not open that file",
      body: err instanceof Error ? err.message : String(err),
      level: "error",
    });
  });
}
