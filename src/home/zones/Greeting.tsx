import { useFrame } from "@picoframe/frame";
import { useMultiplayer } from "../../multiplayer/store";
import { useResume } from "../continue";

/**
 * The heading and the line under it.
 *
 * Two lines when the page itself settles which one is true. See
 * {@link greetingCopy}.
 */
export type GreetingCopy = {
  heading: string;
  /** The line under the heading, or the one for a page that drew a tool. */
  tagline: string;
  /**
   * The line for a page whose tool grid drew nothing, or null when the state
   * already settled which sentence is right.
   */
  taglineWithoutTools: string | null;
};

/** Everything the copy depends on, gathered by the component's hooks. */
export type GreetingState = {
  /** The app title, or the distribution's if it renamed the app. */
  title: string;
  /** The lobby name to greet, or null when logged out or still connecting. */
  username: string | null;
  /** Whether anything is waiting to be resumed. */
  hasResume: boolean;
};

/**
 * What a distribution's `{ "zone": "greeting" }` entry may say instead.
 *
 * Either replaces its line outright, whatever the state would have produced. A
 * distribution that sets `title` is naming its own front door, so keeping
 * "Welcome back, <user>" over the top of it would be ignoring the instruction.
 */
export interface GreetingOverrides {
  /** The heading. */
  title?: string;
  /** The line under it. */
  tagline?: string;
}

/**
 * Choose what the greeting says.
 *
 * Pure, and the only place the wording is decided, so the distribution overrides
 * layer over one function rather than over a component's markup.
 *
 * The heading greets by name once the lobby has accepted a login, and otherwise
 * falls back to the app title. The tagline says the most useful true thing:
 * point at what you were doing if there is anything, otherwise send you to the
 * tools, and admit it when there are none.
 *
 * Which of those last two is true is not something this function can know, so it
 * hands back both and the page picks. A distribution's own wording, and a page
 * with something to resume, settle it here and get `taglineWithoutTools` null.
 */
export function greetingCopy(
  { title, username, hasResume }: GreetingState,
  overrides: GreetingOverrides = {},
): GreetingCopy {
  const settled = overrides.tagline ?? (hasResume ? RESUME_LINE : null);
  return {
    heading:
      overrides.title ?? (username ? `Welcome back, ${username}` : title),
    tagline: settled ?? TOOLS_LINE,
    taglineWithoutTools: settled === null ? NO_TOOLS_LINE : null,
  };
}

/** There is something waiting, so point at it rather than at the grid. */
const RESUME_LINE = "Pick up where you left off.";

/** The grid drew at least one tool card. */
const TOOLS_LINE = "Choose a tool to get started.";

/** It drew none, so the page is a heading and whatever links came with it. */
const NO_TOOLS_LINE = "No tools available yet.";

/**
 * The name to greet, or null.
 *
 * Only once the connection reaches `ready`, because that is when the server has
 * told us who we are. A connection in progress therefore keeps the app title:
 * the account being dialled is a guess until the server accepts it, and a
 * heading that changes twice in a second reads worse than one that changes once.
 *
 * The lobby provider is app-level and unconditional (see `app.plugins.ts`), so
 * this is safe to call from the home page even in a build with multiplayer
 * hidden from the sidebar.
 */
function useLobbyName(): string | null {
  const { activeKey, mirror } = useMultiplayer();
  if (activeKey == null || mirror.phase !== "ready") return null;
  return mirror.state?.myUsername ?? null;
}

/**
 * Whether there is anything to resume.
 *
 * The same shared collector the Continue zone and the resume rail read, so the
 * greeting cannot promise a resume the page then fails to offer. Zones never
 * read each other's state, and {@link useResume} is what makes that possible.
 *
 * The sources load from disk, so this is false on the first frame and turns true
 * a beat later on an install with something waiting. One change, like the
 * heading's.
 *
 * It waits for `loading` for the same reason the Continue hero and the resume
 * rail do, and so that it waits for exactly as long as they do. Without that the
 * tagline promised "Pick up where you left off." over a page with nothing on it
 * to pick up, because the greeting answered off a half-read set while the two
 * zones that would show it were still waiting (#1002).
 */
function useHasResume(): boolean {
  const { candidates, loading } = useResume();
  return !loading && candidates.length > 0;
}

/**
 * What each of the two tool sentences waits for.
 *
 * `[data-tool-card]` is the marker the tool grid leaves on every card it draws
 * (see `./ToolCards`). One of these two lines is displayed and the other is not,
 * so the page says the true one from the first paint, with no second render and
 * nothing to flash.
 *
 * The grid's own sections already answer "did any of my items draw?" this way,
 * with `hidden has-[[data-nav-item]]:block`. This is the same question one level
 * up, so it gets the same answer.
 *
 * Scoped to `body` rather than to a wrapper, because the marker is left by
 * another zone and the greeting must not need a particular ancestor to have been
 * put there by a particular layout. Nothing outside the tool grid sets it.
 */
const WITH_TOOLS = "hidden [body:has([data-tool-card])_&]:block";
const WITHOUT_TOOLS = "[body:has([data-tool-card])_&]:hidden";

/**
 * The page's heading and tagline.
 *
 * Owns the copy the tool grid used to carry, including the empty-grid line, so
 * that the one sentence under the heading is decided in one place. It never
 * renders nothing: an app always has a title, so there is always a greeting.
 *
 * The props are a distribution's own wording, passed in by the layout from the
 * zone's entry rather than read from the profile here, so the zone stays a pure
 * function of what it is given.
 *
 * ## Why the tool sentence is chosen in CSS
 *
 * It used to be chosen from the nav, and the nav is not the whole answer. A nav
 * item can define `useVisible`, and the tool card honours it: a gated item draws
 * nothing. So a distribution narrow enough to gate every item off got "Choose a
 * tool to get started." over an empty page (#1066), the same failure as #1057
 * from a different direction.
 *
 * The greeting cannot call `useVisible` itself. It is a hook, one per item, over
 * a list whose length is not the greeting's to depend on, which is why every
 * other reader of it is a component per item. Nor can the two zones tell each
 * other: the home page is built on zones that share collectors rather than state,
 * so that no zone has to render before another can be right.
 *
 * So both sentences go on the page and the grid's own markup picks between them.
 * The thing the two zones share is the card the grid drew, which cannot disagree
 * with itself: an item that is gated off, or that is a link rather than a tool,
 * leaves no marker to find.
 */
export default function Greeting(overrides: GreetingOverrides = {}) {
  const { title } = useFrame();
  const username = useLobbyName();
  const hasResume = useHasResume();
  const { heading, tagline, taglineWithoutTools } = greetingCopy(
    { title, username, hasResume },
    overrides,
  );
  return (
    <>
      <h1 className="text-2xl font-semibold">{heading}</h1>
      <p
        className={`mt-1 text-muted-foreground${taglineWithoutTools === null ? "" : ` ${WITH_TOOLS}`}`}
      >
        {tagline}
      </p>
      {taglineWithoutTools !== null && (
        <p className={`mt-1 text-muted-foreground ${WITHOUT_TOOLS}`}>
          {taglineWithoutTools}
        </p>
      )}
    </>
  );
}
