/**
 * Who a name is to the player looking at it: themselves, a friend, or somebody
 * in their party (issue #336). A roster, a member list and a chat log all mark
 * a name the same way from this, so a friend looks like a friend wherever they
 * turn up.
 *
 * This is separate from team colour. A team colour says which side a player is
 * on in one battle. A mark says who they are to you, and follows them from the
 * channel list into a battle and back out.
 */
export type NameMark = "you" | "friend" | "party";

/** What decides a mark, for one connection. */
export interface NameMarkSource {
  /** The logged-in username, or null before login. */
  me: string | null | undefined;
  /** Server friends and local favourites together. */
  friends: readonly string[];
  /** The members of the player's own party, themselves included. */
  party: readonly string[];
}

/**
 * The mark for `name`, or null for a stranger. You come first, then friends,
 * then party, so a friend who is also in your party reads as a friend: the
 * party ends with the session and the friendship does not.
 */
export function nameMarkFor(
  name: string,
  source: NameMarkSource,
): NameMark | null {
  if (source.me != null && name === source.me) return "you";
  if (source.friends.includes(name)) return "friend";
  if (source.party.includes(name)) return "party";
  return null;
}

/** What a mark is called, read out for the icon that carries it. */
export const NAME_MARK_LABEL: Record<NameMark, string> = {
  you: "You",
  friend: "Friend",
  party: "In your party",
};

/**
 * The text colour of each mark, as a light value and a `dark:` one. Three hues
 * a long way apart (blue, pink, teal), and none of them the amber of the host's
 * crown or the red, green and amber of the presence dots beside a name.
 *
 * Written out as whole class names because Tailwind only emits a class it can
 * find as a literal. `nameMark.test.ts` reads the two hex values back out of
 * each and measures them against every surface a name is drawn on, so changing
 * a value here re-runs the measurement.
 */
export const NAME_MARK_CLASS: Record<NameMark, string> = {
  you: "text-[#1d4ed8] dark:text-[#93c5fd]",
  friend: "text-[#be185d] dark:text-[#f9a8d4]",
  party: "text-[#0f766e] dark:text-[#5eead4]",
};
