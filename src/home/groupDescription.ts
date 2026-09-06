/**
 * One line under each group heading on the welcome page, saying what the group
 * is for.
 *
 * The headings alone leave a lot unsaid. "Play" and "Library" are guessable,
 * but nothing on the page distinguishes Library from Downloads, and a heading
 * reading "Mapping Tools" tells a first-time player nothing about whether it is
 * for them.
 *
 * ## Why a table here rather than a field on each group
 *
 * A nav group is not owned by one plugin. `play` is declared by five of them and
 * `composeNav` merges the declarations, so a `description` field on the group
 * would be five plugins each answering the same question and the first one
 * winning. There is one right answer per group, so there is one table.
 *
 * It also keeps this inside coilbox. `NavGroup` belongs to picoframe, so adding
 * a field there would mean a release before any of this could ship.
 *
 * A group with no entry gets no description, which is the case for the link
 * groups a distribution injects through `profile.links`: those are named by
 * their author, and this file cannot know what they hold.
 */

/** Keyed by nav group id. See {@link groupDescription}. */
const GROUP_DESCRIPTIONS: Readonly<Record<string, string>> = {
  play: "Start a skirmish, run a campaign, or pick up a Warpath run.",
  multiplayer: "Log in to a lobby server, chat, and join battles.",
  library:
    "Everything installed on this machine: maps, games, blueprints and archives.",
  downloads: "Find and install maps, games and other content.",
  builder: "Build your own campaigns and scenarios.",
  uberstress: "Run engine stress tests and compare the results.",
  mapconv: "Compile and decompile maps.",
  lego: "Assemble units from parts and inspect s3o models.",
  animation: "Convert BOS to Lua, and work with COB scripts.",
  settings: "Engine options, appearance, accounts, and everything else.",
};

/**
 * The line to draw under a group's heading, or nothing when the group is not one
 * of ours.
 *
 * `Object.hasOwn` rather than a bare lookup, so a distribution that names a
 * group `constructor` or `__proto__` gets nothing back rather than an inherited
 * Object property rendered as a description.
 */
export function groupDescription(id: string): string | undefined {
  return Object.hasOwn(GROUP_DESCRIPTIONS, id)
    ? GROUP_DESCRIPTIONS[id]
    : undefined;
}

/** The ids this file describes. Read by the test that keeps it complete. */
export function describedGroupIds(): string[] {
  return Object.keys(GROUP_DESCRIPTIONS);
}
