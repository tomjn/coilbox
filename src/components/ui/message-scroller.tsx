import { Button } from "@picoframe/frame";
import {
  MessageScroller as MessageScrollerPrimitive,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
} from "@shadcn/react/message-scroller";
import { ArrowDownIcon } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Headless message-scroller from `@shadcn/react` (UI-library agnostic: no Base UI
 * / Radix). Vendored from the shadcn registry and adapted to coilbox: `Button`
 * comes from `@picoframe/frame` and the scroll-to-latest button uses picoframe's
 * `icon` size (the registry default `icon-sm` isn't in picoframe's size union).
 * The registry's `scroll-fade`, `scrollbar-*` and `content-visibility` classes
 * and the `gap-8` on the content are not taken: coilbox has no such utilities
 * and spaces chat rows itself.
 */

/** `scrollEdgeThreshold` default in `@shadcn/react` 0.3.1. */
const DEFAULT_SCROLL_EDGE_THRESHOLD = 8;

const FollowContext = React.createContext({
  autoScroll: false,
  scrollEdgeThreshold: DEFAULT_SCROLL_EDGE_THRESHOLD,
});

function MessageScrollerProvider(
  props: React.ComponentProps<typeof MessageScrollerPrimitive.Provider>,
) {
  const { autoScroll = false, scrollEdgeThreshold } = props;
  const follow = React.useMemo(
    () => ({
      autoScroll,
      scrollEdgeThreshold: scrollEdgeThreshold ?? DEFAULT_SCROLL_EDGE_THRESHOLD,
    }),
    [autoScroll, scrollEdgeThreshold],
  );
  return (
    <FollowContext.Provider value={follow}>
      <MessageScrollerPrimitive.Provider {...props} />
    </FollowContext.Provider>
  );
}

function MessageScroller({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Root>) {
  return (
    <MessageScrollerPrimitive.Root
      data-slot="message-scroller"
      className={cn(
        "group/message-scroller relative flex size-full min-h-0 flex-col overflow-hidden",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Keys that scroll the view toward the end. The library also stops following on
 * the keys that scroll toward the start, but those can only move a view that is
 * at the bottom upward, so the `scroll` event they cause resets the mode.
 */
const KEYS_TOWARD_END = new Set(["ArrowDown", "End", "PageDown", " "]);

/**
 * Workaround for shadcn-ui/ui#11224, fixed upstream by the unreleased
 * shadcn-ui/ui#11223.
 *
 * `@shadcn/react` stops following new messages on every wheel, touchmove or
 * scroll key, and only starts again from a `scroll` event. A gesture that moves
 * nothing (wheel momentum after the view hits the bottom, a sideways pan, a
 * wheel used by a scrollable inside a message, End or Page Down pressed at the
 * bottom) fires no `scroll` event, so following stays off while the view sits at
 * the bottom.
 *
 * The library calls its handler from its own `onWheel`, `onTouchMove` and
 * `onKeyDown`, which the wrapper cannot reach, so this listens in the capture
 * phase, records whether the view was at the bottom, and on the next frame calls
 * the public `scrollToEnd` if the gesture did not scroll the view up. A real
 * scroll-away delivers its `scroll` event before that frame, so it is left
 * alone.
 *
 * Remove once a released `@shadcn/react` contains the fix for #11224, and
 * confirm the "keeps following" tests in message-scroller.dom.test.tsx still
 * pass without it.
 */
function useKeepFollowingAfterGestures(
  viewportRef: React.RefObject<HTMLDivElement | null>,
) {
  const { autoScroll, scrollEdgeThreshold } = React.useContext(FollowContext);
  const { scrollToEnd } = useMessageScroller();

  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (!autoScroll || !viewport) return;

    let frame: number | null = null;
    let startTop = 0;

    const check = () => {
      frame = null;
      // Scrolled up since the gesture began: the reader meant to leave.
      if (viewport.scrollTop < startTop - 0.5) return;
      scrollToEnd({ behavior: "auto" });
    };

    const onGesture = () => {
      // A second gesture before the frame keeps the first one's start point.
      if (frame !== null) return;
      const distance =
        viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
      if (distance > scrollEdgeThreshold) return;
      startTop = viewport.scrollTop;
      frame = window.requestAnimationFrame(check);
    };

    viewport.addEventListener("wheel", onGesture, {
      capture: true,
      passive: true,
    });
    viewport.addEventListener("touchmove", onGesture, {
      capture: true,
      passive: true,
    });
    const onKey = (event: KeyboardEvent) => {
      // Shift+Space scrolls up.
      if (
        !KEYS_TOWARD_END.has(event.key) ||
        (event.key === " " && event.shiftKey)
      )
        return;
      onGesture();
    };
    viewport.addEventListener("keydown", onKey, { capture: true });
    return () => {
      viewport.removeEventListener("wheel", onGesture, { capture: true });
      viewport.removeEventListener("touchmove", onGesture, { capture: true });
      viewport.removeEventListener("keydown", onKey, { capture: true });
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [autoScroll, scrollEdgeThreshold, scrollToEnd, viewportRef]);
}

function MessageScrollerViewport({
  className,
  ref,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Viewport>) {
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const setRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      viewportRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );
  useKeepFollowingAfterGestures(viewportRef);
  return (
    <MessageScrollerPrimitive.Viewport
      ref={setRef}
      data-slot="message-scroller-viewport"
      className={cn(
        "size-full min-h-0 min-w-0 overflow-y-auto overscroll-contain data-pending-scroll:invisible",
        className,
      )}
      {...props}
    />
  );
}

function MessageScrollerContent({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Content>) {
  return (
    <MessageScrollerPrimitive.Content
      data-slot="message-scroller-content"
      className={cn("flex h-max min-h-full flex-col", className)}
      {...props}
    />
  );
}

function MessageScrollerItem({
  className,
  scrollAnchor = false,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Item>) {
  return (
    <MessageScrollerPrimitive.Item
      data-slot="message-scroller-item"
      scrollAnchor={scrollAnchor}
      className={cn("min-w-0 shrink-0", className)}
      {...props}
    />
  );
}

function MessageScrollerButton({
  direction = "end",
  className,
  children,
  render,
  variant = "secondary",
  size = "icon",
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Button> &
  Pick<React.ComponentProps<typeof Button>, "variant" | "size">) {
  return (
    <MessageScrollerPrimitive.Button
      data-slot="message-scroller-button"
      data-direction={direction}
      data-variant={variant}
      data-size={size}
      direction={direction}
      className={cn(
        "absolute left-1/2 -translate-x-1/2 rounded-full border-border bg-background text-foreground shadow-sm transition-[translate,scale,opacity] duration-200 hover:bg-muted hover:text-foreground data-[active=false]:pointer-events-none data-[active=false]:scale-95 data-[active=false]:opacity-0 data-[active=false]:duration-400 data-[active=false]:ease-[cubic-bezier(0.7,0,0.84,0)] data-[active=true]:translate-y-0 data-[active=true]:scale-100 data-[active=true]:opacity-100 data-[active=true]:ease-[cubic-bezier(0.23,1,0.32,1)] data-[direction=end]:bottom-4 data-[direction=end]:data-[active=false]:translate-y-full data-[direction=start]:top-4 data-[direction=start]:data-[active=false]:-translate-y-full data-[direction=start]:[&_svg]:rotate-180",
        className,
      )}
      render={render ?? <Button variant={variant} size={size} />}
      {...props}
    >
      {children ?? (
        <>
          <ArrowDownIcon />
          <span className="sr-only">
            {direction === "end" ? "Scroll to end" : "Scroll to start"}
          </span>
        </>
      )}
    </MessageScrollerPrimitive.Button>
  );
}

export {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
};
