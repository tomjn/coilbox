import { Button, useDrawer } from "@picoframe/frame";
import { save } from "@tauri-apps/plugin-dialog";
import { ArrowLeft, FolderOpen, Terminal } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  type Archive,
  contentOpenPath,
  unitsyncArchiveExtract,
} from "../bindings";
import {
  useArchives,
  useScanTargetSelection,
  useUnitsyncArchiveFile,
  useUnitsyncArchiveTree,
} from "../config";
import { formatBytes, isSdd } from "../format";
import { ArchiveRow } from "./components/ArchiveRow";
import { ArchiveTree } from "./components/ArchiveTree";
import { ArchiveTypeBadge, PrimaryBadge } from "./components/ArchiveTypeBadge";
import { FilePreview } from "./components/FilePreview";
import { LuaConsoleDrawer } from "./components/LuaConsoleDrawer";
import { SddBadge } from "./components/SddBadge";
import { DetailLoading, NotFound } from "./components/states";

/**
 * One archive: its metadata + type, the archives it depends on, and a browsable
 * folder tree of its contents with a preview pane for the selected file.
 */
export default function ArchiveDetailPage() {
  const { name } = useParams();
  const decoded = name ? decodeURIComponent(name) : "";
  const navigate = useNavigate();
  const drawer = useDrawer();
  const { selected } = useScanTargetSelection();
  const { archives, data, loading } = useArchives(
    selected?.enginePath,
    selected?.rootPath,
  );
  const archive = archives.find((a) => a.name === decoded);

  const { tree, loading: treeLoading } = useUnitsyncArchiveTree(
    selected?.enginePath,
    selected?.rootPath,
    archive?.name,
  );
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const { data: file, loading: fileLoading } = useUnitsyncArchiveFile(
    selected?.enginePath,
    selected?.rootPath,
    archive?.name,
    selectedFile ?? undefined,
  );

  if (!data || loading) return <DetailLoading backTo="/content/archives" />;
  if (!archive) return <NotFound backTo="/content/archives" label="archive" />;

  // Dependencies: a game's own deps, or a map's other archives.
  const game = data.games.find((g) => g.primaryArchive.name === decoded);
  const map = data.maps.find((m) => m.archives[0]?.name === decoded);
  const deps: Archive[] = game
    ? game.dependencyArchives
    : map
      ? map.archives.slice(1)
      : [];

  const onDiskPath = tree?.archivePath ?? archive.path;
  const linked =
    archive.kind === "game" && archive.gameName
      ? {
          label: "View game",
          to: `/content/games/${encodeURIComponent(archive.gameName)}`,
        }
      : archive.kind === "map" && archive.mapName
        ? {
            label: "View map",
            to: `/content/maps/${encodeURIComponent(archive.mapName)}`,
          }
        : null;

  const openFolder = () => {
    if (!onDiskPath) return;
    // A .sdd path is the folder itself; otherwise reveal its containing folder.
    const target = isSdd(archive)
      ? onDiskPath
      : onDiskPath.replace(/[\\/][^\\/]*$/, "");
    contentOpenPath({ path: target }).catch(() => {});
  };

  // Copy the selected member out of the archive to a path the user picks. The
  // worker writes the full bytes; we only choose the destination here. Returns
  // true when a file was written, false when the user cancelled the dialog, and
  // throws on a write/read error so the preview pane can surface it.
  const downloadSelected = async (): Promise<boolean> => {
    if (
      !selectedFile ||
      !selected?.enginePath ||
      !selected?.rootPath ||
      !archive
    )
      return false;
    const base = selectedFile.split("/").pop() ?? "file";
    const dest = await save({
      title: "Save file from archive",
      defaultPath: base,
    });
    if (!dest) return false;
    const res = await unitsyncArchiveExtract({
      enginePath: selected.enginePath,
      dataDir: selected.rootPath,
      archive: archive.name,
      file: selectedFile,
      dest,
    });
    if (res.errors.length > 0) throw new Error(res.errors.join("; "));
    return true;
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-5 p-4">
      <header className="flex shrink-0 flex-col gap-1">
        <Link
          to="/content/archives"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
        >
          <ArrowLeft className="size-3.5" /> Archives
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="break-all font-mono text-lg font-semibold">
            {archive.name}
          </h1>
          {isSdd(archive) && <SddBadge />}
          {archive.primary && <PrimaryBadge />}
          <ArchiveTypeBadge kind={archive.kind} />
          <div className="ml-auto flex shrink-0 gap-2">
            {selected?.enginePath && selected?.rootPath && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() =>
                  drawer.open({
                    title: "Lua Console",
                    description: `Run Lua through ${archive.name} via unitsync.`,
                    width: "40rem",
                    content: (
                      <LuaConsoleDrawer
                        enginePath={selected.enginePath}
                        dataDir={selected.rootPath}
                        archive={archive.name}
                      />
                    ),
                  })
                }
              >
                <Terminal className="size-4" /> Lua Console
              </Button>
            )}
            {linked && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate(linked.to)}
              >
                {linked.label}
              </Button>
            )}
            {onDiskPath && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={openFolder}
              >
                <FolderOpen className="size-4" /> Open folder
              </Button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {archive.size != null && <span>{formatBytes(archive.size)}</span>}
          {archive.checksum && (
            <span className="font-mono">checksum {archive.checksum}</span>
          )}
          {onDiskPath && (
            <span className="break-all font-mono" title={onDiskPath}>
              {onDiskPath}
            </span>
          )}
        </div>
      </header>

      <section className="flex shrink-0 flex-col gap-2">
        <h2 className="text-sm font-medium">Dependencies ({deps.length})</h2>
        {deps.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This archive lists no dependencies.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {deps.map((d) => (
              <ArchiveRow
                key={d.name}
                archive={d}
                classification={archives.find((a) => a.name === d.name)}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="flex min-h-0 flex-1 flex-col gap-2">
        <h2 className="shrink-0 text-sm font-medium">
          Contents{tree ? ` (${tree.files.length} files)` : ""}
        </h2>
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(14rem,20rem)_1fr] gap-3">
          <div className="min-h-0 overflow-auto rounded-lg border border-border/50 bg-card">
            {treeLoading ? (
              <div className="h-40 animate-pulse" />
            ) : tree ? (
              <ArchiveTree
                files={tree.files}
                selected={selectedFile}
                onSelect={setSelectedFile}
              />
            ) : (
              <p className="p-3 text-sm text-muted-foreground">
                Could not list this archive's contents.
              </p>
            )}
          </div>
          <div className="min-h-0 min-w-0">
            <FilePreview
              path={selectedFile}
              result={file}
              loading={fileLoading}
              onDownload={downloadSelected}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
