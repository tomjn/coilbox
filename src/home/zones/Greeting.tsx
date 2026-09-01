import { useFrame } from "@picoframe/frame";
import { useMultiplayer } from "../../multiplayer/store";
import type { ZoneId } from "../config";
import { useResume } from "../continue";

/**
 * The heading and the line under it.
 *
 * Two lines when the page itself settles which one is true, and no line at all
 * when nothing true is left to say. See {@link greetingCopy}.
 */
export type GreetingCopy = {
  heading: string;
  /**
   * The line under the heading, or the one for a page that drew a tool. Null on
   * a page carrying neither the zone the resume line is about nor the one the
   * tool lines are about, which leaves the greeting a heading.
   */
  tagline: string | null;
  /**
   * The line for a page whose tool grid drew nothing, or null when the state
   * already settled which sentence is right.
   */
  taglineWithoutTools: string | null;
};

/**
 * Everything the copy depends on: what the component's hooks found, and which
 * zones the page it is on carries.
 */
export type GreetingState = {
  /** The app title, or the distribution's if it renamed the app. */
  title: string;
  /** The lobby name to greet, or null when logged out or still connecting. */
  username: string | null;
  /** Whether anything is waiting to be resumed. */
  hasResume: boolean;
  /**
   * The built-in zones on this page, from `resolveHome` by way of the layout.
   * See `../config`'s `zonesOnPage`.
   */
  zones: ReadonlySet<ZoneId>;
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
 * falls back to the app title. There is always a heading, because an app always
 * has a title.
 *
 * ## The line under it only speaks about zones the page has
 *
 * Every sentence Coilbox can put here is about another zone. "Pick up where you
 * left off." is about the continue hero and the resume rail, and both tool lines
 * are about the grid. A distribution's `zones` list can leave any of them out,
 * and a sentence about a zone that is not on the page is a sentence about
 * nothing: it points at a hero that was never drawn, or calls a grid the author
 * chose not to show an install with no tools in it (issues #1079 and #1082).
 *
 * So each sentence is offered only if its zone is there, in order of how much it
 * says, and a page with none of those zones gets the heading on its own. That is
 * an unusual page by construction, since it is a distribution that listed
 * `greeting` and little else, and it already has `tagline` for a line of its own.
 *
 * Which of the two tool lines is true is not something this function can know,
 * so when the grid is on the page it hands back both and the browser picks. A
 * distribution's own wording, and a page with something to resume, settle it
 * here and get `taglineWithoutTools` null.
 */
export function greetingCopy(
  { title, username, hasResume, zones }: GreetingState,
  overrides: GreetingOverrides = {},
): GreetingCopy {
  const heading =
    overrides.title ?? (username ? `Welcome back ${username}` : title);
  const settled = (tagline: string | null): GreetingCopy => ({
    heading,
    tagline,
    taglineWithoutTools: null,
  });
  // The author wrote this line about their own page, so it stands whatever is
  // on it, including an empty string meaning a deliberate blank.
  if (overrides.tagline !== undefined) return settled(overrides.tagline);
  if (hasResume && (zones.has("continue") || zones.has("resume")))
    return settled(RESUME_LINE);
  if (!zones.has("cards")) return settled(null);
  return { heading, tagline: TOOLS_LINE, taglineWithoutTools: NO_TOOLS_LINE };
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
 *
 * This is only half the question, and it is the half about state. Whether either
 * zone is on the page at all is the other half, and it comes from the layout
 * rather than from here (#1082). No marker like the grid's is needed for this
 * one: the hero and the rail draw from this same collector, so a marker would be
 * a second way to ask a question the shared answer already settles.
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

/** What the layout hands the greeting. */
export interface GreetingProps extends GreetingOverrides {
  /**
   * The built-in zones on this page, so the greeting speaks only about zones the
   * player can see. See `../config`'s `zonesOnPage`, and {@link greetingCopy} for
   * what it changes.
   *
   * Required rather than defaulted to the full page, because a layout that
   * forgot it would put the old wrong sentences back and nothing would say so.
   */
  zones: ReadonlySet<ZoneId>;
}

/**
 * The page's heading and tagline.
 *
 * Owns the copy the tool grid used to carry, including the empty-grid line, so
 * that the one sentence under the heading is decided in one place. It never
 * renders nothing: an app always has a title, so there is always a heading.
 *
 * The wording props are a distribution's own, passed in by the layout from the
 * zone's entry rather than read from the profile here, so the zone stays a pure
 * function of what it is given. `zones` arrives the same way and for the same
 * reason: the page's own composition is the layout's to hand down.
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
export default function Greeting({ zones, ...overrides }: GreetingProps) {
  const { title } = useFrame();
  const username = useLobbyName();
  const hasResume = useHasResume();
  const { heading, tagline, taglineWithoutTools } = greetingCopy(
    { title, username, hasResume, zones },
    overrides,
  );
  return (
    <>
      <h1 className="text-2xl font-semibold">{heading}</h1>
      {tagline !== null && (
        <p
          className={`mt-1 text-muted-foreground${taglineWithoutTools === null ? "" : ` ${WITH_TOOLS}`}`}
        >
          {tagline}
        </p>
      )}
      {taglineWithoutTools !== null && (
        <p className={`mt-1 text-muted-foreground ${WITHOUT_TOOLS}`}>
          {taglineWithoutTools}
        </p>
      )}
    </>
  );
}
