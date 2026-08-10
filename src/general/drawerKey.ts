/**
 * A fresh React key for one opening of the frame's drawer.
 *
 * The drawer is a single shared panel and its content is whatever element was
 * handed to `drawer.open()`. Radix keeps a closed dialog's children mounted
 * until the closing animation ends, and a webview pauses CSS animations while
 * its window is in the background, so a drawer closed off screen can stay
 * mounted for as long as the app runs. Opening it again with an element of the
 * same type then updates the form that is still there instead of building a new
 * one, and the form keeps everything it was holding.
 *
 * That silently swallowed a second import of the same hub item (issue #1395):
 * the form only runs a code it is handed once per mount, so the second one
 * arrived at a form that had already had its turn and nothing happened. Keying
 * the content on this makes every opening a new form, so a second import
 * behaves exactly like the first.
 *
 * Module-level, not per component, because the page that opens the drawer is
 * remounted by the navigation that carries the code, and a counter that starts
 * again with it would hand out the same key twice.
 *
 * See `./drawer.tsx` for the other drawer-wide fix, closing it on a navigation.
 */

let openings = 0;

/** The key for the next drawer opening. Never repeats within a session. */
export function nextDrawerKey(): number {
  openings += 1;
  return openings;
}
