import { Button } from "@picoframe/frame";
import { save } from "@tauri-apps/plugin-dialog";
import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Side, UnitDatasetEntry } from "../../bindings";
import type { BrandingEntry } from "../../branding";
import { resolveBrandingImage } from "../../branding";
import { buildBuildGraph, buildEdgeMap } from "../../buildTree";
import { buildExportArtifact } from "../../buildTreeExport";
import {
  contentExportBuildTreeHtml,
  contentExportBuildTreeZip,
} from "../../buildTreeExport/bindings";
import {
  buildExportInput,
  type PicEntry,
} from "../../buildTreeExport/buildInput";
import type {
  ExportBranding,
  ExportOptions,
} from "../../buildTreeExport/types";
import { gatherExportPics } from "../../config";

/**
 * "Export HTML" for the build-tree drawer header. Opens a small options popover
 * (scope / wrapper / format — a popover, not a modal, per the repo convention),
 * then serializes the whole standalone artifact in the frontend and hands the
 * bytes to a thin Rust write command. The exported page carries no coilbox,
 * unitsync or React Flow runtime (see `buildTreeExport/`).
 */
export function BuildTreeExportButton({
  enginePath,
  dataDir,
  gameArchive,
  gameName,
  sides,
  units,
  activeSide,
  branding,
}: {
  enginePath: string;
  dataDir: string;
  gameArchive: string;
  gameName: string;
  sides: Side[];
  units: UnitDatasetEntry[];
  /** The faction currently shown, so "current" scope exports just that one. */
  activeSide: string;
  /** Resolved catalog entry for the branded wrapper (null = neutral only). */
  branding?: BrandingEntry | null;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<ExportOptions["scope"]>("all");
  const [wrapper, setWrapper] = useState<ExportOptions["wrapper"]>(
    branding ? "branded" : "neutral",
  );
  const [format, setFormat] = useState<ExportOptions["format"]>("html");

  const toggleItem =
    "rounded-md border border-border/60 px-3 py-1 text-xs data-[state=on]:border-primary data-[state=on]:bg-primary/10";

  const runExport = async () => {
    const opts: ExportOptions = { scope, wrapper, format };
    const scopeSides =
      scope === "all" ? sides : sides.filter((s) => s.name === activeSide);
    if (scopeSides.length === 0) {
      toast.error("Nothing to export for this faction.");
      return;
    }

    // The safe default file name: game slug + extension.
    const slug =
      gameName.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") ||
      "build-tree";
    const ext = format === "zip" ? "zip" : "html";
    const dest = await save({
      title: "Export build tree",
      defaultPath: `${slug}-build-tree.${ext}`,
      filters: [
        {
          name: format === "zip" ? "Zip archive" : "HTML page",
          extensions: [ext],
        },
      ],
    });
    if (!dest) return; // user cancelled — no-op

    setBusy(true);
    try {
      // Every reachable unit across the exported factions, so we resolve pics for
      // all of them (not just the tab currently open).
      const edges = buildEdgeMap(units);
      const unitIds = Array.from(
        new Set(
          scopeSides.flatMap((s) => buildBuildGraph(s.startUnit, edges).order),
        ),
      );
      const pics = (await gatherExportPics(
        enginePath,
        dataDir,
        gameArchive,
        unitIds,
      )) as Record<string, PicEntry>;

      let exportBranding: ExportBranding | undefined;
      if (wrapper === "branded" && branding) {
        const [bannerDataUrl, logoDataUrl] = await Promise.all([
          resolveBrandingImage(branding.banner, true),
          resolveBrandingImage(branding.logo, false),
        ]);
        exportBranding = {
          title: branding.title,
          bannerDataUrl,
          logoDataUrl,
          links: branding.links,
        };
      }

      const input = buildExportInput({
        gameName,
        sides: scopeSides,
        units,
        pics,
        branding: exportBranding,
        date: new Date().toISOString().slice(0, 10),
      });
      const artifact = buildExportArtifact(input, opts);

      if (artifact.format === "html") {
        await contentExportBuildTreeHtml({ dest, html: artifact.html });
      } else {
        await contentExportBuildTreeZip({ dest, files: artifact.files });
      }
      toast.success("Build tree exported.");
      setOpen(false);
    } catch (e) {
      toast.error(`Export failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1.5">
          <Download className="size-4" aria-hidden />
          Export HTML
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        <p className="text-sm font-medium">Export build tree</p>

        <Field label="Factions">
          <ToggleGroup
            type="single"
            value={scope}
            onValueChange={(v) => v && setScope(v as ExportOptions["scope"])}
            className="justify-start gap-2"
          >
            <ToggleGroupItem value="all" className={toggleItem}>
              All
            </ToggleGroupItem>
            <ToggleGroupItem value="current" className={toggleItem}>
              Current
            </ToggleGroupItem>
          </ToggleGroup>
        </Field>

        <Field label="Wrapper">
          <ToggleGroup
            type="single"
            value={wrapper}
            onValueChange={(v) =>
              v && setWrapper(v as ExportOptions["wrapper"])
            }
            className="justify-start gap-2"
          >
            <ToggleGroupItem
              value="branded"
              className={toggleItem}
              disabled={!branding}
            >
              Branded
            </ToggleGroupItem>
            <ToggleGroupItem value="neutral" className={toggleItem}>
              Neutral
            </ToggleGroupItem>
          </ToggleGroup>
        </Field>

        <Field label="Format">
          <ToggleGroup
            type="single"
            value={format}
            onValueChange={(v) => v && setFormat(v as ExportOptions["format"])}
            className="justify-start gap-2"
          >
            <ToggleGroupItem value="html" className={toggleItem}>
              Single HTML
            </ToggleGroupItem>
            <ToggleGroupItem value="zip" className={toggleItem}>
              Zip
            </ToggleGroupItem>
          </ToggleGroup>
        </Field>

        <p className="text-xs text-muted-foreground">
          {format === "html"
            ? "One self-contained file with pics inlined — larger, but drop-in."
            : "index.html plus cacheable images/ and assets/ — smaller page."}
        </p>

        <Button
          type="button"
          className="w-full gap-1.5"
          disabled={busy}
          onClick={runExport}
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Download className="size-4" aria-hidden />
          )}
          Export
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/** A labelled control row inside the popover. */
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
