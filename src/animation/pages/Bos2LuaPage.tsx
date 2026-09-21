import { Button, Drawer, Input } from "@picoframe/frame";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  FileCode2,
  Search,
  TriangleAlert,
  Upload,
} from "lucide-react";
import {
  type InputHTMLAttributes,
  type Ref,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CheckField } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { Label } from "@/components/ui/label";
import { errorText } from "@/lib/helpers";
import { MissionLuaCode } from "@/scenario/pages/components/MissionLuaCode";
import {
  findMatches,
  stepMatch,
} from "@/scenario/pages/components/missionLuaSearch";
import { useLuaTokens } from "@/scenario/pages/components/missionLuaTokens";
import {
  animBos2lua,
  animBosLint,
  animBosRead,
  type LintDiagnostic,
} from "../bindings";
import { BosSource } from "./BosSource";
import { LintProblems } from "./LintProblems";

/** `Input` forwards `ref` at runtime but its type has none, and the find box
 *  needs its node to take focus on Cmd/Ctrl+F. See `MissionLuaView`. */
const FindInput = Input as unknown as (
  props: InputHTMLAttributes<HTMLInputElement> & {
    ref?: Ref<HTMLInputElement>;
  },
) => ReturnType<typeof Input>;

const PLACEHOLDER = `piece base, turret, barrel;

Create()
{
    hide barrel;
    start-script SmokeUnit();
}
...`;

interface Converted {
  lua: string;
  warnings: string[];
  cobVars: string | null;
  error: string | null;
}

const BOS = /\.bos$/i;

const EMPTY: Converted = { lua: "", warnings: [], cobVars: null, error: null };

/**
 * BOS → Lua unit-script converter. Converts as you type through the Rust
 * converter, whose Lua runs as it is. A script loaded from disk has its
 * `#include` files read from its folder, even as it is edited here. A pasted
 * script has none, so one that includes anything is refused rather than
 * converted without the macros and functions those files hold.
 */
export default function Bos2LuaPage() {
  const [bos, setBos] = useState("");
  const [fileName, setFileName] = useState("script.bos");
  // Where the script was loaded from, so its includes are read from beside it.
  const [path, setPath] = useState<string | null>(null);
  const [converted, setConverted] = useState<Converted>(EMPTY);
  // Not remembered between visits, so a box unticked once to compare cannot
  // go on writing the unused code weeks later.
  const [prune, setPrune] = useState(true);
  const [copied, setCopied] = useState<"lua" | "cobVars" | null>(null);
  const [warningsOpen, setWarningsOpen] = useState(false);
  const [cobVarsOpen, setCobVarsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rawMatch, setRawMatch] = useState(0);
  const findRef = useRef<HTMLInputElement | null>(null);
  // Only the newest conversion is shown, so a slow one for an older version
  // of the text cannot land on top of the current one.
  const latest = useRef(0);
  const [diagnostics, setDiagnostics] = useState<LintDiagnostic[]>([]);
  const [lintError, setLintError] = useState<string | null>(null);
  // The line of the problem last clicked, 1-indexed as the lint pass reports
  // it. Cleared whenever the source changes underneath it.
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const latestLint = useRef(0);

  useEffect(() => {
    const ticket = ++latest.current;
    if (bos.trim() === "") {
      setConverted(EMPTY);
      return;
    }
    animBos2lua({
      source: bos,
      name: fileName,
      prune,
      ...(path ? { path } : {}),
    })
      .then(({ lua, warnings, cobVars, missingIncludes }) => {
        if (ticket !== latest.current) return;
        if (missingIncludes.length > 0) {
          setConverted({
            ...EMPTY,
            error: path
              ? `${fileName} includes ${missingIncludes.join(", ")}, which could not be found beside it or in a scripts folder above it, so it cannot be converted.`
              : `This script includes ${missingIncludes.join(", ")}. A script pasted here cannot load its includes, so it cannot be converted. Load the .bos from its folder instead, or open the unit out of its game.`,
          });
          return;
        }
        setConverted({ lua, warnings, cobVars, error: null });
      })
      .catch((error: unknown) => {
        if (ticket === latest.current) {
          setConverted({
            ...EMPTY,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
  }, [bos, fileName, path, prune]);

  // Linted separately from the conversion above, on a short debounce: a lint
  // pass is not needed on every keystroke the way the live Lua view is.
  useEffect(() => {
    if (bos.trim() === "") {
      setDiagnostics([]);
      setLintError(null);
      return;
    }
    const ticket = ++latestLint.current;
    const timer = setTimeout(() => {
      animBosLint({ source: bos, name: fileName })
        .then(({ diagnostics, error }) => {
          if (ticket !== latestLint.current) return;
          setDiagnostics(diagnostics);
          setLintError(error ?? null);
        })
        .catch((error: unknown) => {
          if (ticket === latestLint.current) {
            setDiagnostics([]);
            setLintError(errorText(error));
          }
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [bos, fileName]);

  // A picked problem stops pointing anywhere once the text it was about has
  // moved.
  // biome-ignore lint/correctness/useExhaustiveDependencies: bos is the reset trigger, not read in the body
  useEffect(() => {
    setSelectedLine(null);
  }, [bos]);

  const problemLines = useMemo(() => {
    const map = new Map<number, "error" | "warning">();
    for (const d of diagnostics) {
      if (d.severity === "info") continue;
      if (map.get(d.line - 1) !== "error") map.set(d.line - 1, d.severity);
    }
    return map;
  }, [diagnostics]);

  async function loadPath(picked: string) {
    try {
      const { source } = await animBosRead({ path: picked });
      setPath(picked);
      setFileName(picked.split(/[\\/]/).pop() ?? picked);
      setBos(source);
    } catch (error) {
      setConverted({ ...EMPTY, error: errorText(error) });
    }
  }

  async function browse() {
    const picked = await open({
      title: "Select a .bos unit script to convert",
      multiple: false,
      filters: [{ name: "Unit script source", extensions: ["bos", "txt"] }],
    });
    if (typeof picked === "string") await loadPath(picked);
  }

  // A file dropped on the window. Tauri hands over real paths, which a
  // browser drop does not, and the includes are found from the path.
  // biome-ignore lint/correctness/useExhaustiveDependencies: subscribe once on mount, not per render
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type !== "drop") return;
        const dropped = event.payload.paths.find((f) => BOS.test(f));
        if (dropped) void loadPath(dropped);
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

  // The Lua is shown with line numbers and colour, the same view the scenario
  // editor gives its compiled mission. Find searches the BOS.
  const lines = useMemo(() => converted.lua.split("\n"), [converted.lua]);
  const tokens = useLuaTokens(converted.lua, lines);
  const bosLines = useMemo(() => bos.split("\n"), [bos]);
  const matches = useMemo(
    () => findMatches(bosLines, query),
    [bosLines, query],
  );
  const matchAt =
    matches.length === 0 ? null : Math.min(rawMatch, matches.length - 1);
  const activeMatch = matchAt === null ? null : matches[matchAt];

  // A fresh query starts from its first match.
  // biome-ignore lint/correctness/useExhaustiveDependencies: query is the reset trigger, not read in the body
  useEffect(() => {
    setRawMatch(0);
  }, [query]);

  // Cmd/Ctrl+F finds in the BOS, while this page is open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() !== "f") return;
      event.preventDefault();
      setFindOpen(true);
      setFindAsked((n) => n + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // An empty find box is only its icon until it is asked for. Asking again
  // while it is open focuses it again, so the request is a count.
  const [findOpen, setFindOpen] = useState(false);
  const [findAsked, setFindAsked] = useState(0);
  function openFind() {
    setFindOpen(true);
    setFindAsked((n) => n + 1);
  }
  useEffect(() => {
    if (findAsked === 0) return;
    findRef.current?.focus();
    findRef.current?.select();
  }, [findAsked]);

  const goToMatch = (direction: 1 | -1) => {
    const next = stepMatch(matches.length, matchAt, direction);
    if (next !== null) setRawMatch(next);
  };

  const searching = query.trim() !== "";
  const warningCount = converted.warnings.length;

  async function copy(text: string, which: "lua" | "cobVars") {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(
        () => setCopied((current) => (current === which ? null : current)),
        1500,
      );
    } catch {
      // The clipboard may be unavailable, and the textarea stays selectable.
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        className="border-b border-border px-6 py-4"
        title={
          <>
            <FileCode2 size={18} /> BOS → Lua
          </>
        }
        description={
          <>
            Convert a <code>.bos</code> unit script to Lua.
          </>
        }
        actions={
          <>
            {warningCount > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="text-amber-700 dark:text-amber-400"
                onClick={() => setWarningsOpen(true)}
              >
                <TriangleAlert className="size-4" />
                {warningCount} {warningCount === 1 ? "warning" : "warnings"}
              </Button>
            )}
            {converted.cobVars && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCobVarsOpen(true)}
              >
                <FileCode2 className="size-4" />
                Needs cob_vars.lua
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => void browse()}>
              <Upload /> Load .bos…
            </Button>
            <Button
              size="sm"
              onClick={() => void copy(converted.lua, "lua")}
              disabled={!converted.lua}
            >
              {copied === "lua" ? <Check /> : <Copy />}{" "}
              {copied === "lua" ? "Copied" : "Copy Lua"}
            </Button>
          </>
        }
      />

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-4 p-6">
        <div className="flex min-h-0 flex-col gap-2">
          <div className="flex h-8 items-center gap-2">
            <Label
              htmlFor="bos-input"
              className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium text-muted-foreground"
            >
              BOS
              {path && (
                <>
                  , from <code className="font-mono text-xs">{path}</code>
                </>
              )}
            </Label>
            {!findOpen && !searching ? (
              <Button
                size="icon"
                variant="ghost"
                className="ml-auto size-8 shrink-0"
                aria-label="Find in the BOS (Cmd+F)"
                onClick={openFind}
              >
                <Search className="size-4" />
              </Button>
            ) : (
              <div className="relative ml-auto w-48 shrink-0">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <FindInput
                  ref={findRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onBlur={() => {
                    if (!searching) setFindOpen(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setQuery("");
                      setFindOpen(false);
                      return;
                    }
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    goToMatch(e.shiftKey ? -1 : 1);
                  }}
                  placeholder="Find (Cmd+F)"
                  aria-label="Find in the BOS"
                  className="h-8 pl-7 text-xs"
                />
              </div>
            )}
            {searching && (
              <>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  aria-label="Previous match"
                  disabled={matches.length === 0}
                  onClick={() => goToMatch(-1)}
                >
                  <ChevronUp className="size-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  aria-label="Next match"
                  disabled={matches.length === 0}
                  onClick={() => goToMatch(1)}
                >
                  <ChevronDown className="size-4" />
                </Button>
              </>
            )}
            <span
              aria-live="polite"
              className="whitespace-nowrap text-xs text-muted-foreground empty:-ml-2"
            >
              {!searching
                ? ""
                : matchAt === null
                  ? "None"
                  : `${matchAt + 1} of ${matches.length}`}
            </span>
          </div>
          <BosSource
            id="bos-input"
            value={bos}
            onChange={(value) => {
              setBos(value);
              if (value.trim() === "") setPath(null);
            }}
            placeholder={PLACEHOLDER}
            lines={bosLines}
            matches={matches}
            activeMatch={activeMatch}
            highlightLine={selectedLine === null ? null : selectedLine - 1}
            problemLines={problemLines}
          />
          <div className="max-h-40 shrink-0 overflow-y-auto">
            <LintProblems
              diagnostics={diagnostics}
              error={lintError}
              selectedLine={selectedLine}
              onSelect={setSelectedLine}
            />
          </div>
        </div>
        <div className="flex min-h-0 flex-col gap-2">
          <div className="flex h-8 items-center gap-2">
            <h2 className="text-sm font-medium text-muted-foreground">Lua</h2>
            <div className="ml-auto">
              <CheckField
                label="Leave out unused code"
                checked={prune}
                onChange={setPrune}
              />
            </div>
          </div>
          <div className="min-h-0 flex-1">
            {converted.lua ? (
              <MissionLuaCode
                lines={lines}
                tokens={tokens}
                matches={[]}
                activeMatch={null}
                label="Converted Lua"
              />
            ) : (
              <p className="flex h-full items-center justify-center rounded-md border border-dashed border-border/50 p-4 text-xs text-muted-foreground">
                Converted Lua appears here as you type.
              </p>
            )}
          </div>
          {converted.error && (
            <p role="alert" className="text-sm text-destructive">
              {converted.error}
            </p>
          )}
        </div>
      </div>
      <Drawer
        open={warningsOpen && warningCount > 0}
        onOpenChange={setWarningsOpen}
        title="Conversion warnings"
        description="Where the Lua may do something different from the BOS."
        width="34rem"
      >
        <ul className="flex list-disc flex-col gap-2 pl-4 text-sm">
          {converted.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      </Drawer>
      <Drawer
        open={cobVarsOpen && converted.cobVars !== null}
        onOpenChange={setCobVarsOpen}
        title="Add lualibs/cob_vars.lua to the game"
        description="This script shares values with other units, which it keeps as rules params."
        width="34rem"
      >
        <div className="flex flex-col gap-3 text-sm">
          <p>
            The file lets the game's synced gadgets set those values, and its
            gadgets and widgets read them, through{" "}
            <code>Spring.SetUnitCOBValue</code>,{" "}
            <code>Spring.GetCOBTeamVar</code> and their siblings.
          </p>
          <p>
            Put <code>VFS.Include("lualibs/cob_vars.lua")</code> on the first
            line of <code>LuaRules/main.lua</code>,{" "}
            <code>LuaRules/draw.lua</code> and <code>luaui.lua</code> (or{" "}
            <code>LuaUI/main.lua</code>).
          </p>
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => void copy(converted.cobVars ?? "", "cobVars")}
          >
            {copied === "cobVars" ? <Check /> : <Copy />}{" "}
            {copied === "cobVars" ? "Copied" : "Copy file"}
          </Button>
        </div>
      </Drawer>
    </div>
  );
}
