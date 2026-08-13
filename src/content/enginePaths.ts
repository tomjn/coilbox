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

/** Whether a path says where it starts from, which is what makes two of them
 *  comparable at all: a leading separator, a drive letter, or a UNC share. */
function absolute(path: string): boolean {
  return /^([/\\]|[A-Za-z]:[/\\])/.test(path);
}

/** A path in the one shape two of them can be compared in: one separator, none
 *  on the end, and folded case, because Windows and macOS both hand back
 *  whatever was typed and two spellings are one file. Folding case can only make
 *  two paths look like one, never the other way, so it errs the way a caller
 *  refusing on a match wants it to. */
function comparable(path: string): string {
  return path
    .replace(/[\\/]+/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

/**
 * Whether a path is one the engine writes, so far as its text can say (issue
 * #1488).
 *
 * True is the answer that stops a caller, so every case this cannot decide is
 * true: no directory to compare against, or either path written relative to
 * wherever the process happens to be. That leaves false meaning one thing only,
 * which is that both paths say where they start from and they start apart.
 *
 * The whole directory rather than the one file in it, because a caller asking
 * this is asking whether the engine is going to be writing here, and the engine
 * writes several files under there.
 *
 * Text, so a link is followed by nobody: a path elsewhere that the filesystem
 * resolves into this directory reads as elsewhere. Resolving one is a syscall
 * and this is not the place for it.
 */
export function underEngineConfig(
  configDir: string | undefined,
  path: string,
): boolean {
  if (!configDir || !absolute(configDir) || !absolute(path)) return true;
  const dir = comparable(configDir);
  const at = comparable(path);
  return at === dir || at.startsWith(`${dir}/`);
}
