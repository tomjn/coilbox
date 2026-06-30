import { cn } from "@picoframe/frame";
import { ChevronDown, ChevronRight, File, Folder } from "lucide-react";
import { useMemo, useState } from "react";
import type { ArchiveFileEntry } from "../../bindings";
import { formatBytes } from "../../format";

interface DirNode {
  dirs: Map<string, DirNode>;
  files: { name: string; path: string; size: number }[];
}

/** Fold a flat member list into a nested directory tree. */
function buildTree(files: ArchiveFileEntry[]): DirNode {
  const root: DirNode = { dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.path.split("/").filter(Boolean);
    if (parts.length === 0) continue;
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      let next = node.dirs.get(seg);
      if (!next) {
        next = { dirs: new Map(), files: [] };
        node.dirs.set(seg, next);
      }
      node = next;
    }
    node.files.push({
      name: parts[parts.length - 1],
      path: f.path,
      size: f.size,
    });
  }
  return root;
}

const ROW =
  "flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-sm hover:bg-accent/50";

/** Render a directory's contents (its sub-dirs then its files), recursively. */
function DirContents({
  node,
  depth,
  selected,
  onSelect,
}: {
  node: DirNode;
  depth: number;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const dirs = [...node.dirs.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      {dirs.map(([name, child]) => (
        <DirEntry
          key={`d:${name}`}
          name={name}
          node={child}
          depth={depth}
          selected={selected}
          onSelect={onSelect}
        />
      ))}
      {files.map((f) => (
        <button
          type="button"
          key={`f:${f.path}`}
          onClick={() => onSelect(f.path)}
          style={{ paddingLeft: depth * 14 + 6 }}
          className={cn(ROW, selected === f.path && "bg-accent")}
        >
          <File className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-mono">{f.name}</span>
          <span className="shrink-0 font-mono text-xs text-muted-foreground">
            {formatBytes(f.size)}
          </span>
        </button>
      ))}
    </>
  );
}

/** A single collapsible directory row plus (when open) its contents. */
function DirEntry({
  name,
  node,
  depth,
  selected,
  onSelect,
}: {
  name: string;
  node: DirNode;
  depth: number;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ paddingLeft: depth * 14 + 6 }}
        className={cn(ROW, "font-medium")}
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <Folder className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono">{name}</span>
      </button>
      {open && (
        <DirContents
          node={node}
          depth={depth + 1}
          selected={selected}
          onSelect={onSelect}
        />
      )}
    </>
  );
}

/** The archive's folder tree; clicking a file lifts its path to the parent. */
export function ArchiveTree({
  files,
  selected,
  onSelect,
}: {
  files: ArchiveFileEntry[];
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const root = useMemo(() => buildTree(files), [files]);
  if (files.length === 0) {
    return (
      <p className="p-3 text-sm text-muted-foreground">
        No files listed for this archive.
      </p>
    );
  }
  return (
    <div className="flex flex-col py-1">
      <DirContents
        node={root}
        depth={0}
        selected={selected}
        onSelect={onSelect}
      />
    </div>
  );
}
