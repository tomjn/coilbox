import { useDrawer } from "@picoframe/frame";
import { LuaRepl } from "./LuaRepl";

/**
 * Drawer body for the Archives detail "Lua Console" — a REPL over unitsync's
 * restricted parser with the page's archive mounted. Thin wrapper around
 * {@link LuaRepl}; the "Open full page" link closes the drawer and navigates to
 * the standalone REPL route (state is shared via the module-level session store,
 * so the transcript carries over).
 */
export function LuaConsoleDrawer({
  enginePath,
  dataDir,
  archive,
}: {
  enginePath: string;
  dataDir: string;
  archive: string;
}) {
  const drawer = useDrawer();
  return (
    <LuaRepl
      enginePath={enginePath}
      dataDir={dataDir}
      archive={archive}
      popOutTo={`/library/archives/${encodeURIComponent(archive)}/repl`}
      onPopOut={() => drawer.close()}
    />
  );
}
