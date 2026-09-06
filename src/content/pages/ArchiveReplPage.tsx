import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "react-router";
import { useArchives, useScanTargetSelection } from "../config";
import { LuaRepl } from "./components/LuaRepl";
import { DetailLoading, NotFound } from "./components/states";

/**
 * Full-page ("popped out") view of the archive Lua REPL. Shares the module-level
 * session store with the drawer, so the transcript is the same in both. Fills
 * the page height so long sessions get room to breathe.
 */
export default function ArchiveReplPage() {
  const { name } = useParams();
  const decoded = name ? decodeURIComponent(name) : "";
  const { selected } = useScanTargetSelection();
  const { archives, data, loading } = useArchives(
    selected?.enginePath,
    selected?.rootPath,
  );
  const archive = archives.find((a) => a.name === decoded);
  const backTo = `/library/archives/${encodeURIComponent(decoded)}`;

  if (!data || loading) return <DetailLoading backTo={backTo} />;
  if (!archive || !selected?.enginePath || !selected?.rootPath)
    return <NotFound backTo={backTo} label="archive" />;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <header className="flex shrink-0 flex-col gap-1">
        <Link
          to={backTo}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
        >
          <ArrowLeft className="size-3.5" /> {archive.name}
        </Link>
        <h1 className="font-mono text-lg font-semibold">Lua REPL</h1>
      </header>
      <LuaRepl
        fill
        enginePath={selected.enginePath}
        dataDir={selected.rootPath}
        archive={archive.name}
      />
    </div>
  );
}
