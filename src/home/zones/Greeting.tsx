import { useFrame } from "@picoframe/frame";
import { useMultiplayer } from "../../multiplayer/store";
import { homeToolGroups } from "../nav";

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
  /** Whether the tool grid has anything in it. */
  hasTools: boolean;
};

/**
 * Choose what the greeting says.
 *
 * Pure, and the only place the wording is decided, so the distribution overrides
 * in issue #998 layer over one function rather than over a component's markup.
 *
 * The heading greets by name once the lobby has accepted a login, and otherwise
 * falls back to the app title. The tagline says the most useful true thing:
 * point at what you were doing if there is anything, otherwise send you to the
 * tools, and admit it when there are none.
 */
export function greetingCopy({
  title,
  username,
  hasResume,
  hasTools,
}: GreetingState): GreetingCopy {
  let tagline: string;
  if (hasResume) tagline = "Pick up where you left off.";
  else if (hasTools) tagline = "Choose a tool to get started.";
  else tagline = "No tools available yet.";
  return { heading: username ? `Welcome back, ${username}` : title, tagline };
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
 * Hard-wired false until issue #992 lands the collector that ranks resume
 * candidates. Building half of that here would put a second, worse answer in the
 * codebase for #992 to unpick, so the seam is a hook and nothing more. Until it
 * is filled in, the tagline never takes its resume branch.
 */
function useHasResume(): boolean {
  return false;
}

/**
 * The page's heading and tagline.
 *
 * Owns the copy the tool grid used to carry, including the empty-grid line, so
 * that the one sentence under the heading is decided in one place. It never
 * renders nothing: an app always has a title, so there is always a greeting.
 */
export default function Greeting() {
  const { title, nav } = useFrame();
  const username = useLobbyName();
  const hasResume = useHasResume();
  const { heading, tagline } = greetingCopy({
    title,
    username,
    hasResume,
    hasTools: homeToolGroups(nav).length > 0,
  });
  return (
    <>
      <h1 className="text-2xl font-semibold">{heading}</h1>
      <p className="mt-1 text-muted-foreground">{tagline}</p>
    </>
  );
}
