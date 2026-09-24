import { useEffect, useState } from "react";

/**
 * Whether a scroll box has rows below what it shows, so a fade that means
 * "more below" can go away once there is nothing more.
 *
 * Checked on scroll and whenever the box or its content changes size, since a
 * row added, removed or folded away changes the answer without any scrolling.
 * Returns a callback ref rather than taking an object ref, so a box that
 * unmounts and comes back (the tree, when the sidebar changes tab) is picked
 * up again.
 */
export function useMoreBelow(): [(box: HTMLElement | null) => void, boolean] {
  const [box, setBox] = useState<HTMLElement | null>(null);
  const [moreBelow, setMoreBelow] = useState(false);

  useEffect(() => {
    if (!box) return;
    const check = () =>
      // A pixel of slack, because a zoomed page can leave the scroll position
      // a fraction short of the end.
      setMoreBelow(box.scrollTop + box.clientHeight < box.scrollHeight - 1);
    check();
    box.addEventListener("scroll", check, { passive: true });
    const observer = new ResizeObserver(check);
    observer.observe(box);
    for (const child of Array.from(box.children)) observer.observe(child);
    return () => {
      box.removeEventListener("scroll", check);
      observer.disconnect();
    };
  }, [box]);

  return [setBox, moreBelow];
}
