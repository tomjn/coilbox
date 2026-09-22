import { Button, Drawer } from "@picoframe/frame";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { ask, open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  AlertCircle,
  Binary,
  CheckCircle2,
  FolderOpen,
  FolderSearch,
  Hammer,
  Info,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState } from "react";
import { SEVERITY_COLOR, worstSeverity } from "@/components/CheckItem";
import { PageHeader } from "@/components/PageHeader";
import { Textarea } from "@/components/ui/textarea";
import { errorText } from "@/lib/helpers";
import {
  animBos2cob,
  animBosLint,
  animBosRead,
  animCobDisasm,
  type LintDiagnostic,
} from "../bindings";
import { LintProblems } from "./LintProblems";

const COB = /\.cob$/i;
const BOS = /\.bos$/i;

type Kind = "bos" | "cob";
type Banner = { kind: "success" | "info" | "error"; text: string };

const BANNER_STYLES: Record<Banner["kind"], string> = {
  success:
    "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  info: "border-border bg-muted/50 text-foreground",
  error: "border-destructive/40 bg-destructive/10 text-destructive",
};
const BANNER_ICONS = { success: CheckCircle2, info: Info, error: AlertCircle };

/**
 * COB tools: compile a `.bos` unit script to `.cob` (byte-exact with the
 * BARScriptCompiler reference, see the crate's PORTING.md) and disassemble a
 * `.cob` into its scripts, pieces, and opcode stream. Pick files or drag them
 * in — `.bos` compiles, `.cob` disassembles. Re-run repeats the last action on
 * the same file; Reveal opens it in the OS file manager.
 */
export default function CobPage() {
  const [path, setPath] = useState("");
  const [kind, setKind] = useState<Kind | null>(null);
  const [revealTarget, setRevealTarget] = useState("");
  const [listing, setListing] = useState("");
  const [banner, setBanner] = useState<Banner | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [diagnostics, setDiagnostics] = useState<LintDiagnostic[]>([]);
  const [lintError, setLintError] = useState<string | null>(null);
  const [checksOpen, setChecksOpen] = useState(false);

  // Lints a .bos once it has compiled, so the same source that just produced
  // the listing is what the problems below it are about. Never for a .cob
  // loaded straight from disk, since there is no source to lint.
  async function lintBos(p: string) {
    try {
      const { source } = await animBosRead({ path: p });
      const { diagnostics, error } = await animBosLint({
        source,
        name: p,
        path: p,
      });
      setDiagnostics(diagnostics);
      setLintError(error ?? null);
    } catch (e) {
      setDiagnostics([]);
      setLintError(errorText(e));
    }
  }

  async function disassemble(p: string) {
    const res = await animCobDisasm({ path: p });
    setListing(res.listing);
  }

  // Compile a .bos, then disassemble the produced .cob so the result is visible.
  // Asks before overwriting an existing .cob.
  async function compile(p: string, overwrite = false) {
    setBanner(null);
    setBusy(true);
    setPath(p);
    setKind("bos");
    setDiagnostics([]);
    setLintError(null);
    try {
      const res = await animBos2cob({ path: p, overwrite });
      if (res.needsOverwrite) {
        const yes = await ask(`${res.output} already exists.\nOverwrite it?`, {
          title: "Overwrite .cob?",
          kind: "warning",
        });
        if (yes) await compile(p, true);
        else
          setBanner({
            kind: "info",
            text: "Kept the existing .cob — not overwritten.",
          });
        return;
      }
      setRevealTarget(res.output);
      setBanner({
        kind: "success",
        text: `Compiled to ${res.output} (${res.bytes} bytes).`,
      });
      await disassemble(res.output);
      await lintBos(p);
    } catch (e) {
      setBanner({ kind: "error", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  async function loadCob(p: string) {
    setBanner(null);
    setBusy(true);
    setPath(p);
    setKind("cob");
    setRevealTarget(p);
    setListing("");
    setDiagnostics([]);
    setLintError(null);
    try {
      await disassemble(p);
    } catch (e) {
      setBanner({ kind: "error", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  // Repeat the last action on the same file (recompile a .bos, or re-read a
  // .cob — handy after the source changed on disk). Re-run is an explicit
  // "do it again" so it overwrites its own previous output without prompting.
  async function rerun() {
    if (!path) return;
    if (kind === "bos") await compile(path, true);
    else await loadCob(path);
  }

  async function reveal() {
    if (!revealTarget) return;
    try {
      await revealItemInDir(revealTarget);
    } catch (e) {
      setBanner({ kind: "error", text: errorText(e) });
    }
  }

  async function browseCob() {
    const picked = await open({
      title: "Select a .cob unit script",
      multiple: false,
      filters: [{ name: "Compiled unit script", extensions: ["cob"] }],
    });
    if (typeof picked === "string") await loadCob(picked);
  }

  async function browseBos() {
    const picked = await open({
      title: "Select a .bos unit script to compile",
      multiple: false,
      filters: [{ name: "Unit script source", extensions: ["bos"] }],
    });
    if (typeof picked === "string") await compile(picked);
  }

  // Native file drop (Tauri exposes real paths). Mounted once; handlers stable.
  // biome-ignore lint/correctness/useExhaustiveDependencies: subscribe once on mount, not per render
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const p = event.payload;
        if (p.type === "enter" || p.type === "over") setDragging(true);
        else if (p.type === "leave") setDragging(false);
        else if (p.type === "drop") {
          setDragging(false);
          const bos = p.paths.find((f) => BOS.test(f));
          const cob = p.paths.find((f) => COB.test(f));
          if (bos) void compile(bos);
          else if (cob) void loadCob(cob);
          else if (p.paths.length)
            setBanner({ kind: "error", text: "Drop a .bos or .cob file." });
        }
      })
      .then((fn) => {
        if (active) unlisten = fn;
        else fn();
      })
      .catch(() => {});
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  const BannerIcon = banner ? BANNER_ICONS[banner.kind] : null;
  // The button's count is only what needs acting on: errors and warnings. An
  // info diagnostic still lists in the drawer, but does not add to the
  // number on the button.
  const infoCount = diagnostics.filter((d) => d.severity === "info").length;
  const severeCount = diagnostics.length - infoCount;
  const showChecks = kind === "bos" && (diagnostics.length > 0 || !!lintError);
  const checksSeverity = lintError
    ? "error"
    : worstSeverity(diagnostics.map((d) => d.severity));

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        className="border-b border-border px-6 py-4"
        title={
          <>
            <Binary size={18} /> COB tools
          </>
        }
        description={
          <>
            Compile a <code>.bos</code> unit script to <code>.cob</code>, or
            disassemble a <code>.cob</code> into its scripts, pieces, and opcode
            stream.
          </>
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={rerun}
              disabled={!path || busy}
            >
              <RefreshCw /> Re-run
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={reveal}
              disabled={!revealTarget || busy}
            >
              <FolderSearch /> Reveal in folder
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={browseBos}
              disabled={busy}
            >
              <Hammer /> Compile .bos…
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={browseCob}
              disabled={busy}
            >
              <FolderOpen /> Open .cob…
            </Button>
            {showChecks && (
              <Button
                variant="outline"
                size="sm"
                className={
                  severeCount > 0 && checksSeverity
                    ? SEVERITY_COLOR[checksSeverity]
                    : ""
                }
                onClick={() => setChecksOpen(true)}
              >
                {severeCount > 0 || lintError ? (
                  <TriangleAlert className="size-4" />
                ) : (
                  <Info className="size-4" />
                )}
                {lintError
                  ? "Parse error"
                  : severeCount > 0
                    ? `${severeCount} ${severeCount === 1 ? "check" : "checks"}`
                    : `${infoCount} ${infoCount === 1 ? "note" : "notes"}`}
              </Button>
            )}
          </>
        }
      />

      <div
        className={
          dragging
            ? "flex min-h-0 flex-1 flex-col gap-3 bg-primary/5 p-6 ring-2 ring-inset ring-primary/60"
            : "flex min-h-0 flex-1 flex-col gap-3 p-6"
        }
      >
        {banner && BannerIcon && (
          <p
            className={`flex shrink-0 items-start gap-2 rounded-md border px-3 py-2 text-sm ${BANNER_STYLES[banner.kind]}`}
          >
            <BannerIcon size={15} className="mt-px shrink-0" />
            <span className="break-all">{banner.text}</span>
          </p>
        )}
        {listing ? (
          <Textarea
            value={listing}
            readOnly
            spellCheck={false}
            className="min-h-0 flex-1 resize-none bg-card/30 font-mono text-xs leading-relaxed"
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            <Binary size={26} className="opacity-30" />
            <p>Open or drop a .bos to compile, or a .cob to disassemble.</p>
            {path && <p className="font-mono text-xs">{path}</p>}
          </div>
        )}
      </div>
      <Drawer
        open={checksOpen && showChecks}
        onOpenChange={setChecksOpen}
        title="Checks"
        description="What the lint pass found in this .bos."
        width="34rem"
      >
        <LintProblems diagnostics={diagnostics} error={lintError} />
      </Drawer>
    </div>
  );
}
