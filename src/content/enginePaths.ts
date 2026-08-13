/**
 * Where an engine writes, and what lives under it (issue #1435).
 *
 * unitsync reports the `springsettings.cfg` it read, and everything an engine
 * writes for a player sits beside it: the keymap, and every game's own widget
 * config. So a picker can open on a file the player has never had to go and
 * find, rather than wherever the operating system was left last.
 *
 * Text only. Nothing here asks the filesystem anything, so a path is offered
 * whether or not there is a file at the end of it. A player who has never used
 * a game's blueprint widget has the directory and not the file, which is the
 * common case rather than an error.
 */

/** Whether a path is written the Windows way, so a path built from it is too. */
function windows(path: string): boolean {
  return path.includes("\\") && !path.includes("/");
}

/** The directory holding the engine's config, from the path unitsync reports.
 *  Nothing when there is no path or no directory in it, because every caller
 *  has a fallback and a guess would be worse than an absence. */
export function engineConfigDir(
  configPath: string | undefined,
): string | undefined {
  if (!configPath) return undefined;
  const cut = Math.max(
    configPath.lastIndexOf("/"),
    configPath.lastIndexOf("\\"),
  );
  return cut > 0 ? configPath.slice(0, cut) : undefined;
}

/** One of the engine's own files, named the way the directory names itself, so
 *  what is shown to a player is a path they would recognise. */
export function underConfigDir(configDir: string, relative: string): string {
  const separator = windows(configDir) ? "\\" : "/";
  const root = configDir.replace(/[\\/]+$/, "");
  return [root, ...relative.split(/[\\/]+/)].join(separator);
}
