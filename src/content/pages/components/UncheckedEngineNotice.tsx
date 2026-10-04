/**
 * The replay's recorded engine may already be installed, but no engine has
 * reported that version yet (issue #3452). Not a missing-content notice and no
 * download, because the player may already have the engine. Pressing Watch asks
 * the engine, and opens the download only if it turns out to be another build.
 */
export function UncheckedEngineNotice({ version }: { version: string }) {
  return (
    <p className="max-w-xl text-xs text-amber-600 dark:text-amber-400">
      This replay was recorded on engine {version}. An engine in a folder with
      that name has not had its version checked yet. Pressing Watch checks it
      first.
    </p>
  );
}
