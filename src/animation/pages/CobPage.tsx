import { Button, Drawer } from "@picoframe/frame";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { ask, open, save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  AlertCircle,
  Binary,
  CheckCircle2,
  FileCode,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { errorText } from "@/lib/helpers";
import {
  animBos2cob,
  animBosLint,
  animBosRead,
  animCobDecompile,
  animCobDisasm,
  animCobHex,
} from "../bindings";
import {
  type CobSession,
  EMPTY_COB_SESSION,
  updateCobSession,
  useCobSession,
} from "../cobSession";
import { LintProblems } from "./LintProblems";

const COB = /\.cob$/i;
const BOS = /\.bos$/i;

/** One read-only panel of monospaced text, the same in all three tabs. */
function ScriptText({ value }: { value: string }) {
  return (
    <Textarea
      value={value}
      readOnly
      spellCheck={false}
      className="h-full min-h-0 resize-none bg-card/30 font-mono text-xs leading-relaxed"
    />
  );
}

/** What each tab is showing, which depends on which file was opened: a `.bos`
 *  brings its own source, and a `.cob` has one rebuilt from its instructions. */
const VIEW_NOTES = {
  bos: {
    bos: "The source that was compiled, as it is on disk.",
    cob: "Source rebuilt from the file. Compiling it gives back this .cob.",
  },
  cob: {
    bos: "The bytes that were written, sixteen to a line.",
    cob: "The bytes of the file, sixteen to a line.",
  },
  opcodes: {
    bos: "The instructions those bytes hold.",
    cob: "The instructions in the file, as they are stored.",
  },
} as const;
/** Which reading of the script is on screen. The same file is all three: the
 *  source, the bytes it compiles to, and the instructions in those bytes. */
type View = CobSession["view"];
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
 * BARScriptCompiler reference, see the crate's PORTING.md), or open a `.cob`
 * and read it as source, as bytes and as the instructions it holds. Pick files
 * or drag them in. Re-run repeats the last action on the same file, and Reveal
 * opens it in the OS file manager.
 */
export default function CobPage() {
  // The file and everything derived from it live in a session store, so
  // leaving the page and coming back finds it as it was rather than empty.
  const {
    path,
    kind,
    revealTarget,
    listing,
    bos,
    hex,
    view,
    warnings,
    diagnostics,
    lintError,
  } = useCobSession();
  const set = (patch: Partial<CobSession>) => updateCobSession(patch);
  // A banner reports what just happened, and busy and dragging are about this
  // visit, so none of the three are worth carrying back.
  const [banner, setBanner] = useState<Banner | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
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
      set({ diagnostics, lintError: error ?? null });
    } catch (e) {
      set({ diagnostics: [], lintError: errorText(e) });
    }
  }

  // All three readings of the same `.cob` at once, so a tab never waits on a
  // command. Which one is worth opening on differs: somebody who opened a
  // compiled file wants the source back, and somebody who just compiled one
  // wants to see what they produced.
  async function readCob(p: string) {
    const [disasm, decompiled, dump] = await Promise.all([
      animCobDisasm({ path: p }),
      animCobDecompile({ path: p }),
      animCobHex({ path: p }),
    ]);
    set({
      listing: disasm.listing,
      bos: decompiled.source,
      hex: dump.dump,
    });
    return decompiled.warnings;
  }

  // Write the rebuilt BOS somewhere the user picks. Decompiling again rather
  // than writing what is on screen keeps the file and the view the same thing.
  async function saveBos() {
    const suggested = path.replace(COB, ".bos");
    const dest = await save({
      title: "Save the rebuilt .bos",
      defaultPath: suggested,
      filters: [{ name: "Unit script source", extensions: ["bos"] }],
    });
    if (!dest) return;
    setBusy(true);
    try {
      await animCobDecompile({ path, output: dest });
      set({ revealTarget: dest });
      setBanner({ kind: "success", text: `Saved ${dest}.` });
    } catch (e) {
      setBanner({ kind: "error", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  // Compile a .bos, then disassemble the produced .cob so the result is visible.
  // Asks before overwriting an existing .cob.
  async function compile(p: string, overwrite = false) {
    setBanner(null);
    setBusy(true);
    set({
      ...EMPTY_COB_SESSION,
      path: p,
      kind: "bos",
    });
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
      setBanner({
        kind: "success",
        text: `Compiled to ${res.output} (${res.bytes} bytes).`,
      });
      set({ revealTarget: res.output, warnings: res.warnings });
      await readCob(res.output);
      const { source } = await animBosRead({ path: p });
      set({ bos: source, view: "opcodes" });
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
    set({
      ...EMPTY_COB_SESSION,
      path: p,
      kind: "cob",
      revealTarget: p,
    });
    try {
      set({ warnings: await readCob(p) });
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
            open a <code>.cob</code> and read it back as source, as bytes, and
            as the instructions it holds.
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
            {kind === "cob" && bos && (
              <Button
                variant="outline"
                size="sm"
                onClick={saveBos}
                disabled={busy}
              >
                <FileCode /> Save as .bos…
              </Button>
            )}
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
        {warnings.length > 0 && (
          <ul className="shrink-0 list-disc space-y-0.5 rounded-md border border-border bg-muted/50 px-3 py-2 pl-8 text-xs text-muted-foreground">
            {warnings.map((w) => (
              <li key={w} className="break-all">
                {w}
              </li>
            ))}
          </ul>
        )}
        {listing ? (
          <Tabs
            value={view}
            onValueChange={(v) => set({ view: v as View })}
            className="flex min-h-0 flex-1 flex-col gap-3"
          >
            <div className="flex shrink-0 items-center justify-between gap-3">
              <TabsList>
                <TabsTrigger value="bos">BOS</TabsTrigger>
                <TabsTrigger value="cob">COB</TabsTrigger>
                <TabsTrigger value="opcodes">Opcodes</TabsTrigger>
              </TabsList>
              <span className="text-xs text-muted-foreground">
                {VIEW_NOTES[view][kind === "cob" ? "cob" : "bos"]}
              </span>
            </div>
            <TabsContent value="bos" className="min-h-0 flex-1">
              <ScriptText value={bos} />
            </TabsContent>
            <TabsContent value="cob" className="min-h-0 flex-1">
              <ScriptText value={hex} />
            </TabsContent>
            <TabsContent value="opcodes" className="min-h-0 flex-1">
              <ScriptText value={listing} />
            </TabsContent>
          </Tabs>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            <Binary size={26} className="opacity-30" />
            <p>Open or drop a .bos to compile, or a .cob to read back.</p>
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
