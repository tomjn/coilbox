import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input } from "@picoframe/frame";
import { Channel } from "@tauri-apps/api/core";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  FileText,
  FolderOpen,
  Hammer,
  Loader2,
  Package,
  PackageCheck,
  Play,
  Square,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { Field } from "@/components/Field";
import { OptionSelect } from "@/components/OptionSelect";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { useWriteRoot } from "@/downloads/config";
import { basename, errorText } from "@/lib/helpers";
import {
  type CompileOpts,
  type CompressionType,
  type LogLine,
  type MapAppearance,
  mcCancel,
  mcCompile,
  mcInstallMap,
  mcOpenPath,
  mcPackMap,
  mcProbe,
  mcReadMapinfo,
  mcReadSkybox,
  mcSuggestSources,
  mcWriteMapinfo,
} from "../bindings";
import { useMapconvConfig } from "../config";
import { useCompileDraft } from "../drafts";
import {
  countMapinfo,
  defaultMapinfoDraft,
  type MapinfoDraft,
  toMapinfoForm,
} from "../mapinfoForm";
import { mapNameFromDir } from "../mapName";
import { useMapProjects } from "../projects";
import AdvancedOptions, {
  type AdvancedCompileOpts,
  defaultAdvanced,
} from "./components/AdvancedOptions";
import { HelpTip, LearnMore, WIKI } from "./components/Help";
import MapinfoOptions from "./components/MapinfoOptions";
import { MapPreview3D } from "./components/MapPreview3D";
import { PathField } from "./components/PathField";
import { CompiledPlayability } from "./components/PlayabilityPanel";

const CT_OPTIONS = [
  { value: "1", label: msg`1 — No compression` },
  { value: "2", label: msg`2 — Fast (compare last N tiles)` },
  { value: "3", label: msg`3 — Insane (whole map; very slow)` },
  { value: "4", label: msg`4 — High quality fast` },
];

/** The parent dir of a native path (handles both / and \ separators). */
function dirname(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(0, i) : "";
}

/** Parse a numeric form string, falling back when empty/invalid. */
function numOr(s: string, fallback: number): number {
  const n = Number(s);
  return s.trim() === "" || Number.isNaN(n) ? fallback : n;
}

/** How many optional flags the user has set, for the drawer button badge. */
function countAdvanced(a: AdvancedCompileOpts): number {
  const strings = [
    a.heightmap,
    a.metalmap,
    a.typemap,
    a.minimap,
    a.vegmap,
    a.features,
    a.maxh,
    a.minh,
    a.th,
    a.ccount,
  ];
  return (
    strings.filter((s) => s.trim() !== "").length +
    (a.noclamp ? 1 : 0) +
    (a.smooth ? 1 : 0)
  );
}

/** Build a `.smf`/`.smt` from source images via the `mapcompile` sidecar. */
export default function CompilePage() {
  const { t } = useLingui();
  const TEXTURE_FILTERS = [
    {
      name: t`Images`,
      extensions: ["png", "bmp", "tga", "jpg", "jpeg", "tif", "tiff"],
    },
  ];
  const [cfg, setCfg] = useMapconvConfig();
  const [draft, setDraft] = useCompileDraft();
  const { upsertProject } = useMapProjects();
  const location = useLocation();

  // Seed from the persisted draft so the form (and its path-driven preview)
  // survives navigation and restarts. The debounced effect below writes it back.
  const [maintexture, setMaintexture] = useState(() => draft.maintexture);
  const [outDir, setOutDir] = useState(() => draft.outDir);
  const [outSuffix, setOutSuffix] = useState(() => draft.outSuffix);
  const [ct, setCt] = useState(
    () => draft.ct ?? String(cfg.defaultCompressionType),
  );
  const [advanced, setAdvanced] = useState<AdvancedCompileOpts>(() => ({
    ...defaultAdvanced,
    ...draft.advanced,
  }));
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [mapinfo, setMapinfo] = useState<MapinfoDraft>(() => ({
    ...defaultMapinfoDraft,
    ...draft.mapinfo,
  }));
  const [showMapinfo, setShowMapinfo] = useState(false);
  const [textureInfo, setTextureInfo] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [appearance, setAppearance] = useState<MapAppearance | null>(null);
  const [skyboxSrc, setSkyboxSrc] = useState<string | null>(null);

  // mapcompile requires the texture's dimensions to be a multiple of 1024.
  const textureSizeBad =
    textureInfo != null &&
    (textureInfo.width % 1024 !== 0 || textureInfo.height % 1024 !== 0);

  // A min height at or above max is nonsensical — flat at best, inverted at worst.
  const heightRangeBad =
    advanced.minh.trim() !== "" &&
    advanced.maxh.trim() !== "" &&
    Number(advanced.minh) >= Number(advanced.maxh);

  const [running, setRunning] = useState(false);
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  // The folder and name the compile used, kept apart from the form, which stays
  // editable. The mapinfo.lua written afterwards describes this compile.
  const [result, setResult] = useState<{
    smfPath: string;
    outDir: string;
    outSuffix: string;
  } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [writingMapinfo, setWritingMapinfo] = useState(false);
  const [mapinfoResult, setMapinfoResult] = useState<{
    path: string;
    created: boolean;
    changed: boolean;
  } | null>(null);
  const [mapinfoError, setMapinfoError] = useState<string | null>(null);
  const [packaging, setPackaging] = useState(false);
  const [packResult, setPackResult] = useState<{
    path: string;
    files: string[];
  } | null>(null);
  const [packError, setPackError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installResult, setInstallResult] = useState<{
    path: string;
    replaced: boolean;
  } | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  // Opens when the maps folder already holds an archive with this name.
  const [replaceOpen, setReplaceOpen] = useState(false);
  const mapsRoot = useWriteRoot("maps");
  const [probe, setProbe] = useState<{
    available: boolean;
    compile: boolean;
    decompile: boolean;
  } | null>(null);

  const runIdRef = useRef<string | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    mcProbe(undefined)
      .then(setProbe)
      .catch(() => {});
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: logLines is the trigger that should re-run the scroll, not read in the body
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: "end" });
  }, [logLines]);

  // Persist the working draft (debounced — one write after typing settles, not
  // per keystroke). Transient run state (logs, result, probe) is intentionally
  // not persisted.
  useEffect(() => {
    const id = setTimeout(() => {
      setDraft({ maintexture, outDir, outSuffix, ct, advanced, mapinfo });
    }, 400);
    return () => clearTimeout(id);
  }, [maintexture, outDir, outSuffix, ct, advanced, mapinfo, setDraft]);

  const canRun =
    !running &&
    !writingMapinfo &&
    !packaging &&
    !installing &&
    maintexture !== "" &&
    outDir !== "" &&
    outSuffix.trim() !== "";

  function buildOpts(): CompileOpts {
    const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
    const str = (s: string) => (s.trim() === "" ? undefined : s.trim());
    return {
      maintexture,
      outSuffix: outSuffix.trim(),
      compressionType: Number(ct) as CompressionType,
      noclamp: advanced.noclamp,
      smooth: advanced.smooth,
      heightmap: str(advanced.heightmap),
      metalmap: str(advanced.metalmap),
      typemap: str(advanced.typemap),
      minimap: str(advanced.minimap),
      vegmap: str(advanced.vegmap),
      features: str(advanced.features),
      maxh: num(advanced.maxh),
      minh: num(advanced.minh),
      th: num(advanced.th),
      ccount: num(advanced.ccount),
    };
  }

  async function run() {
    setRunning(true);
    setResult(null);
    setRunError(null);
    setMapinfoResult(null);
    setMapinfoError(null);
    clearPackage();
    setLogLines([]);
    const runId = crypto.randomUUID();
    runIdRef.current = runId;
    const onLog = new Channel<LogLine>();
    onLog.onmessage = (line) => setLogLines((prev) => [...prev, line]);
    try {
      const opts = buildOpts();
      const res = await mcCompile({ opts, outDir, runId, onLog });
      setResult({ smfPath: res.smfPath, outDir, outSuffix: res.outSuffix });
      // Record (or refresh) this map as a project, remembering its compile
      // options. The source texture is a reliable preview for compile projects.
      upsertProject({
        folderPath: outDir,
        name: outSuffix.trim() || basename(outDir),
        kind: "compile",
        compileOpts: opts,
        previewPath: maintexture || undefined,
      });
      if (cfg.rememberDirs)
        setCfg({
          ...cfg,
          lastTextureDir: dirname(maintexture),
          lastOutDir: outDir,
        });
    } catch (e) {
      setRunError(errorText(e));
    } finally {
      setRunning(false);
      runIdRef.current = null;
    }
  }

  /** Writes mapinfo.lua. Resolves to whether it was written. */
  async function writeMapinfo(): Promise<boolean> {
    if (!result) return false;
    // The archive on disk holds the old mapinfo.lua, so it is packaged again.
    clearPackage();
    setWritingMapinfo(true);
    setMapinfoResult(null);
    setMapinfoError(null);
    try {
      // No heights: the writer reads them from the .smf the compile wrote.
      setMapinfoResult(
        await mcWriteMapinfo({
          opts: {
            outDir: result.outDir,
            outSuffix: result.outSuffix,
            info: toMapinfoForm(mapinfo),
          },
        }),
      );
      return true;
    } catch (e) {
      setMapinfoError(errorText(e));
      return false;
    } finally {
      setWritingMapinfo(false);
    }
  }

  function clearPackage() {
    setPackResult(null);
    setPackError(null);
    setInstallResult(null);
    setInstallError(null);
    setReplaceOpen(false);
  }

  // An archive without mapinfo.lua cannot be loaded, so a compile that has had
  // none written this session gets one first. A mapinfo.lua the user already
  // wrote with the button beside this one is packaged as it is.
  async function packageMap() {
    if (!result) return;
    clearPackage();
    setPackaging(true);
    try {
      if (!mapinfoResult && !(await writeMapinfo())) return;
      setPackResult(
        await mcPackMap({
          outDir: result.outDir,
          outSuffix: result.outSuffix,
        }),
      );
    } catch (e) {
      setPackError(errorText(e));
    } finally {
      setPackaging(false);
    }
  }

  async function installMap(replace: boolean) {
    if (!packResult || !mapsRoot.path) return;
    setInstalling(true);
    setInstallError(null);
    try {
      const r = await mcInstallMap({
        sdzPath: packResult.path,
        rootPath: mapsRoot.path,
        replace,
      });
      setReplaceOpen(!r.installed);
      if (r.installed) setInstallResult(r);
    } catch (e) {
      setReplaceOpen(false);
      setInstallError(errorText(e));
    } finally {
      setInstalling(false);
    }
  }

  async function cancel() {
    if (runIdRef.current) {
      try {
        await mcCancel({ runId: runIdRef.current });
      } catch {
        // the run promise settles with its own error
      }
    }
  }

  // On texture pick, auto-prefill any empty optional fields from conventional
  // siblings in the same folder (heightmap.png, metalmap.png, …). Never
  // overwrites a field the user already set; reveals Advanced if it found any.
  async function pickTexture(path: string) {
    setMaintexture(path);
    setTextureInfo(null);
    setAppearance(null);
    setSkyboxSrc(null);
    if (!path) return;
    // A map may ship a skybox DDS next to mapinfo.lua; load it for the preview.
    mcReadSkybox({ path })
      .then((r) => setSkyboxSrc(r.dataUrl ?? null))
      .catch(() => {});
    // Read mapinfo.lua (or .smf-header fallback) for the height range + the
    // appearance hints the 3D preview uses. Prefill the height fields only when
    // empty, so we never clobber values the user typed; reveal Advanced if found.
    mcReadMapinfo({ path })
      .then((info) => {
        setAppearance(info);
        if (info.minHeight != null || info.maxHeight != null) {
          setAdvanced((a) => ({
            ...a,
            minh:
              a.minh.trim() === "" && info.minHeight != null
                ? String(info.minHeight)
                : a.minh,
            maxh:
              a.maxh.trim() === "" && info.maxHeight != null
                ? String(info.maxHeight)
                : a.maxh,
          }));
          setShowAdvanced(true);
        }
      })
      .catch(() => {});
    try {
      const s = await mcSuggestSources({ texturePath: path });
      let found = false;
      setAdvanced((a) => {
        const merged = { ...a };
        for (const k of [
          "heightmap",
          "metalmap",
          "typemap",
          "minimap",
          "vegmap",
          "features",
        ] as const) {
          if (!merged[k] && s[k]) {
            merged[k] = s[k] as string;
            found = true;
          }
        }
        return merged;
      });
      if (found) setShowAdvanced(true);
    } catch {
      // best-effort; leave fields as-is
    }
  }

  // Seed from incoming navigation state (once, on mount):
  // - `seedOpts`: a Projects "Compile" action — restore the full form from a
  //   project's remembered options.
  // - `recompileDir`: the Decompile page's "Recompile" (or a decompiled
  //   project) — seed the texture (+ siblings via pickTexture) and output folder.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount for the incoming navigation state
  useEffect(() => {
    const st = location.state as {
      recompileDir?: string;
      seedOpts?: CompileOpts;
      seedOutDir?: string;
    } | null;
    if (st?.seedOpts) {
      const o = st.seedOpts;
      // Setting the texture re-renders the PathField preview, which re-fetches
      // the dimensions the 3D preview needs — no pickTexture (it would clobber
      // the remembered sibling paths by re-prefilling).
      setMaintexture(o.maintexture);
      setOutSuffix(o.outSuffix);
      if (st.seedOutDir) setOutDir(st.seedOutDir);
      if (o.compressionType) setCt(String(o.compressionType));
      setAdvanced({
        heightmap: o.heightmap ?? "",
        metalmap: o.metalmap ?? "",
        typemap: o.typemap ?? "",
        minimap: o.minimap ?? "",
        vegmap: o.vegmap ?? "",
        features: o.features ?? "",
        maxh: o.maxh != null ? String(o.maxh) : "",
        minh: o.minh != null ? String(o.minh) : "",
        th: o.th != null ? String(o.th) : "",
        ccount: o.ccount != null ? String(o.ccount) : "",
        noclamp: o.noclamp,
        smooth: o.smooth,
      });
      return;
    }
    const dir = st?.recompileDir;
    if (!dir) return;
    const sep = dir.includes("\\") ? "\\" : "/";
    setOutDir(dir);
    setOutSuffix(mapNameFromDir(dir));
    void pickTexture(`${dir}${sep}texture.png`);
    // run once on mount for the incoming navigation state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const advancedCount = countAdvanced(advanced);
  const mapinfoCount = countMapinfo(mapinfo);
  const textureWidth = textureInfo?.width ?? 0;
  const textureHeight = textureInfo?.height ?? 0;
  const smfPath = result?.smfPath ?? "";
  const minHeight = advanced.minh;
  const maxHeight = advanced.maxh;

  return (
    <div className="@container flex h-full flex-col">
      <header className="border-b border-border px-6 py-4">
        <h1 className="flex items-center gap-2 text-lg font-semibold leading-none">
          <Hammer size={18} /> <Trans>Compile map</Trans>
        </h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          <Trans>
            Build a Spring <code>.smf</code>/<code>.smt</code> from a main
            texture and optional source maps.
          </Trans>{" "}
          <span className="inline-flex gap-3">
            <LearnMore href={WIKI.tutorial} label={t`Beginner guide`} />
            <LearnMore href={WIKI.main} label={t`Mapping wiki`} />
          </span>
        </p>
      </header>

      {probe && !probe.compile && (
        <Alert
          variant="warning"
          className="rounded-none border-x-0 border-t-0 px-6"
        >
          <AlertCircle size={15} />
          <AlertDescription>
            <p>
              <Trans>
                The <code>mapcompile</code> sidecar was not found. Bundle
                SpringMapConvNG or set <code>MAPCONV_MAPCOMPILE_SIDECAR</code>.
              </Trans>
            </p>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-2 @3xl:grid-cols-[28rem_minmax(0,1fr)] @3xl:grid-rows-1">
        {/* Left: form */}
        <div className="min-h-0 space-y-5 overflow-auto border-b border-border px-6 py-5 @3xl:border-r @3xl:border-b-0">
          <PathField
            label={t`Main texture (-t)`}
            hint={t`required · the map's diffuse colour image · sets the map size · siblings auto-fill below`}
            help={
              <HelpTip>
                <span>
                  <Trans>
                    The diffuse colour image painted across the whole map. Its
                    width and height set the map's size and{" "}
                    <strong>must each be a multiple of 1024</strong> (e.g. 1024,
                    2048, 8192). Name companion images{" "}
                    <code>heightmap.png</code>, <code>metalmap.png</code>, etc.
                    in the same folder and they auto-fill below.
                  </Trans>
                </span>
              </HelpTip>
            }
            learnMore={<LearnMore href={WIKI.diffuse} />}
            value={maintexture}
            onChange={pickTexture}
            disabled={running}
            filters={TEXTURE_FILTERS}
            defaultPath={cfg.lastTextureDir}
            preview
            onInfo={setTextureInfo}
          />
          {textureSizeBad && textureInfo && (
            <Alert variant="warning" className="p-2.5">
              <AlertCircle size={14} />
              <AlertDescription className="text-xs">
                <p>
                  <Trans>
                    Texture is {textureWidth} × {textureHeight}px — each side
                    must be a multiple of 1024. mapcompile will likely reject
                    it.
                  </Trans>{" "}
                  <LearnMore href={WIKI.sizes} label={t`Map sizes`} />
                </p>
              </AlertDescription>
            </Alert>
          )}
          <PathField
            label={t`Output folder`}
            hint={t`where the .smf/.smt are written`}
            value={outDir}
            onChange={setOutDir}
            disabled={running}
            directory
            defaultPath={cfg.lastOutDir}
          />
          <Field
            label={t`Output name (-o)`}
            hint={t`basename for the .smf/.smt (no extension)`}
          >
            <Input
              value={outSuffix}
              onChange={(e) => setOutSuffix(e.target.value)}
              disabled={running}
              placeholder="mymap"
            />
          </Field>
          <Field
            label={t`Compression type (-ct)`}
            hint={t`4 (high quality fast) is a good default`}
            help={
              <HelpTip>
                <span>
                  <Trans>
                    How the <code>.smt</code> tile texture is compressed — a
                    trade-off of file size, speed and quality:
                    <br />1 — none (largest file, fastest build)
                    <br />2 — fast (compares the last N tiles)
                    <br />3 — insane (compares the whole map; smallest, very
                    slow)
                    <br />4 — high quality fast (recommended)
                  </Trans>
                </span>
              </HelpTip>
            }
          >
            <OptionSelect
              value={ct}
              onValueChange={setCt}
              disabled={running}
              options={CT_OPTIONS.map((o) => ({
                ...o,
                label: i18n._(o.label),
              }))}
            />
          </Field>

          {/* Advanced options: optional maps, height range, compression tuning. */}
          <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
            <CollapsibleTrigger className="group flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
              <ChevronRight
                size={15}
                className="transition-transform group-data-[state=open]:rotate-90"
              />{" "}
              {advancedCount > 0
                ? t`Advanced options (${advancedCount})`
                : t`Advanced options`}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-4">
                <AdvancedOptions
                  value={advanced}
                  onChange={setAdvanced}
                  defaultPath={cfg.lastTextureDir}
                  disabled={running}
                />
              </div>
            </CollapsibleContent>
          </Collapsible>

          <Collapsible open={showMapinfo} onOpenChange={setShowMapinfo}>
            <CollapsibleTrigger className="group flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
              <ChevronRight
                size={15}
                className="transition-transform group-data-[state=open]:rotate-90"
              />{" "}
              {mapinfoCount > 0 ? t`Map info (${mapinfoCount})` : t`Map info`}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-4">
                <MapinfoOptions
                  value={mapinfo}
                  onChange={setMapinfo}
                  outSuffix={outSuffix}
                  disabled={running}
                />
              </div>
            </CollapsibleContent>
          </Collapsible>

          {heightRangeBad && (
            <Alert variant="warning" className="p-2.5">
              <AlertCircle size={14} />
              <AlertDescription className="text-xs">
                <Trans>
                  Min height ({minHeight}) is at or above max height (
                  {maxHeight}) — the terrain will be flat or inverted. Set min
                  below max.
                </Trans>
              </AlertDescription>
            </Alert>
          )}

          <div className="flex items-center gap-2 pt-1">
            {running ? (
              <Button variant="outline" onClick={cancel}>
                <Square /> <Trans>Cancel</Trans>
              </Button>
            ) : (
              <Button onClick={run} disabled={!canRun}>
                <Play className="fill-current" /> <Trans>Compile</Trans>
              </Button>
            )}
            {running && (
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Loader2 size={14} className="animate-spin" />{" "}
                <Trans>compiling…</Trans>
              </span>
            )}
          </div>
        </div>

        {/* Right: live preview + log + result */}
        <div className="flex min-h-0 min-w-0 flex-col">
          {maintexture !== "" && advanced.heightmap !== "" && (
            <div className="border-b border-border bg-card/50 p-4">
              <MapPreview3D
                heightmapPath={advanced.heightmap}
                texturePath={maintexture}
                minHeight={numOr(advanced.minh, 0)}
                maxHeight={numOr(advanced.maxh, 1)}
                // Dimensions arrive with the texture decode; the preview shows a
                // loading state until they're known (worldWidth/Height > 0).
                worldWidth={textureInfo?.width ?? 0}
                worldHeight={textureInfo?.height ?? 0}
                appearance={appearance}
                skyboxSrc={skyboxSrc}
              />
            </div>
          )}
          {result && (
            <div className="border-b border-border bg-card/50 px-4 py-3">
              <div className="flex items-start gap-2 text-sm">
                <CheckCircle2
                  size={15}
                  className="mt-px shrink-0 text-emerald-600 dark:text-emerald-400"
                />
                <span className="min-w-0 break-all">
                  <Trans>
                    Compiled{" "}
                    <span className="font-mono text-xs">{smfPath}</span>
                  </Trans>
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    mcOpenPath({ path: result.outDir }).catch(() => {})
                  }
                >
                  <FolderOpen /> <Trans>Show in folder</Trans>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={writeMapinfo}
                  disabled={writingMapinfo}
                >
                  {writingMapinfo ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <FileText />
                  )}{" "}
                  <Trans>Write mapinfo.lua</Trans>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={packageMap}
                  disabled={packaging || writingMapinfo || installing}
                >
                  {packaging ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Package />
                  )}{" "}
                  <Trans>Package</Trans>
                </Button>
                {packResult && (
                  <Popover
                    open={replaceOpen}
                    onOpenChange={(o) => {
                      if (!o) setReplaceOpen(false);
                    }}
                  >
                    <PopoverAnchor asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void installMap(false)}
                        disabled={installing || !mapsRoot.path}
                      >
                        {installing ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <PackageCheck />
                        )}{" "}
                        <Trans>Install</Trans>
                      </Button>
                    </PopoverAnchor>
                    <PopoverContent
                      align="start"
                      side="bottom"
                      className="flex w-80 flex-col gap-3"
                    >
                      <div className="flex flex-col gap-1">
                        <h3 className="break-words text-sm font-medium">
                          {t`Replace ${basename(packResult.path)}?`}
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          <Trans>
                            A map with this name is already installed. The
                            engine caches archives by name, so a changed map
                            under an unchanged name can confuse it. Package it
                            under a new name with a version suffix, such as{" "}
                            {result.outSuffix}_v2, to keep both.
                          </Trans>
                        </p>
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setReplaceOpen(false)}
                        >
                          <Trans>Cancel</Trans>
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          disabled={installing}
                          onClick={() => void installMap(true)}
                        >
                          <Trans>Replace</Trans>
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                )}
              </div>
              {packResult && (
                <p className="mt-2 break-all text-sm">
                  <Trans>
                    Packaged{" "}
                    <span className="font-mono text-xs">{packResult.path}</span>
                  </Trans>
                </p>
              )}
              {packResult && !mapsRoot.loading && !mapsRoot.path && (
                <p className="mt-2 text-sm text-destructive">
                  <Trans>
                    No maps folder is set, so there is nowhere to install to.
                    Add a content folder in Settings.
                  </Trans>
                </p>
              )}
              {installResult && (
                <p className="mt-2 break-all text-sm">
                  {installResult.replaced ? (
                    <Trans>
                      Replaced{" "}
                      <span className="font-mono text-xs">
                        {installResult.path}
                      </span>
                    </Trans>
                  ) : (
                    <Trans>
                      Installed{" "}
                      <span className="font-mono text-xs">
                        {installResult.path}
                      </span>
                    </Trans>
                  )}{" "}
                  <Trans>
                    The engine sees it on its next archive scan. Press Rescan on
                    the{" "}
                    <Link
                      className="underline underline-offset-4"
                      to="/library/maps"
                    >
                      Maps page
                    </Link>
                    .
                  </Trans>
                </p>
              )}
              {packError && (
                <p className="mt-2 break-words text-sm text-destructive">
                  {packError}
                </p>
              )}
              {installError && (
                <p className="mt-2 break-words text-sm text-destructive">
                  {installError}
                </p>
              )}
              {mapinfoResult && (
                <p className="mt-2 break-all text-sm">
                  {mapinfoResult.created ? (
                    <Trans>
                      Created{" "}
                      <span className="font-mono text-xs">
                        {mapinfoResult.path}
                      </span>
                    </Trans>
                  ) : mapinfoResult.changed ? (
                    <Trans>
                      Updated{" "}
                      <span className="font-mono text-xs">
                        {mapinfoResult.path}
                      </span>
                    </Trans>
                  ) : (
                    <Trans>
                      Already up to date{" "}
                      <span className="font-mono text-xs">
                        {mapinfoResult.path}
                      </span>
                    </Trans>
                  )}
                </p>
              )}
              {mapinfoError && (
                <p className="mt-2 break-words text-sm text-destructive">
                  {mapinfoError}
                </p>
              )}
            </div>
          )}
          {result && (
            <div className="border-b border-border bg-card/50 px-4 py-3">
              <CompiledPlayability
                smfPath={result.smfPath}
                starts={mapinfo.startPositions
                  .filter((p) => p.x.trim() !== "" && p.z.trim() !== "")
                  .map((p) => ({ x: Number(p.x), z: Number(p.z) }))
                  .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.z))}
              />
            </div>
          )}
          {runError && (
            <Alert
              variant="destructive"
              className="rounded-none border-x-0 border-t-0"
            >
              <AlertCircle size={15} />
              <AlertDescription className="text-destructive">
                {runError}
              </AlertDescription>
            </Alert>
          )}
          <div className="min-h-0 flex-1 overflow-auto bg-card/20 p-4">
            {logLines.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                <Hammer size={26} className="opacity-30" />
                <p>
                  <Trans>Compile output streams here.</Trans>
                </p>
              </div>
            ) : (
              <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
                {logLines.map((l, i) => (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: log lines are append-only; index is a stable key
                    key={i}
                    className={
                      l.stream === "err"
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-foreground/90"
                    }
                  >
                    {l.line}
                  </div>
                ))}
                <div ref={logEndRef} />
              </pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
