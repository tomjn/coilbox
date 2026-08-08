import { useFrame } from "@picoframe/frame";
import { useMultiplayer } from "../../multiplayer/store";
import { useResume } from "../continue";
import { homeHasTools } from "../nav";

/** The heading and the line under it. */
export type GreetingCopy = { heading: string; tagline: string };

/** Everything the copy depends on, gathered by the component's hooks. */
export type GreetingState = {
  /** The app title, or the distribution's if it renamed the app. */
  title: string;
  /** The lobby name to greet, or null when logged out or still connecting. */
  username: string | null;
  /** Whether anything is waiting to be resumed. */
  hasResume: boolean;
  /**
   * Whether there is a tool to choose. External links do not count: they are a
   * way out of Coilbox rather than something to do in it, so a page showing
   * nothing but a links card still has no tools.
   */
  hasTools: boolean;
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
 */
export function greetingCopy(
  { title, username, hasResume, hasTools }: GreetingState,
  overrides: GreetingOverrides = {},
): GreetingCopy {
  let tagline: string;
  if (hasResume) tagline = "Pick up where you left off.";
  else if (hasTools) tagline = "Choose a tool to get started.";
  else tagline = "No tools available yet.";
  return {
    heading:
      overrides.title ?? (username ? `Welcome back, ${username}` : title),
    tagline: overrides.tagline ?? tagline,
  };
}

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
 * The page's heading and tagline.
 *
 * Owns the copy the tool grid used to carry, including the empty-grid line, so
 * that the one sentence under the heading is decided in one place. It never
 * renders nothing: an app always has a title, so there is always a greeting.
 *
 * The props are a distribution's own wording, passed in by the layout from the
 * zone's entry rather than read from the profile here, so the zone stays a pure
 * function of what it is given.
 */
export default function Greeting(overrides: GreetingOverrides = {}) {
  const { title, nav } = useFrame();
  const username = useLobbyName();
  const hasResume = useHasResume();
  const { heading, tagline } = greetingCopy(
    {
      title,
      username,
      hasResume,
      hasTools: homeHasTools(nav),
    },
    overrides,
  );
  return (
    <>
      <h1 className="text-2xl font-semibold">{heading}</h1>
      <p className="mt-1 text-muted-foreground">{tagline}</p>
    </>
  );
}
