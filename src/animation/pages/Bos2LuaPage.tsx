import { Button } from "@picoframe/frame";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { Check, Copy, FileCode2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { errorText } from "@/lib/helpers";
import { animBos2lua, animBosRead } from "../bindings";

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
  const [copied, setCopied] = useState<"lua" | "cobVars" | null>(null);
  // Only the newest conversion is shown, so a slow one for an older version
  // of the text cannot land on top of the current one.
  const latest = useRef(0);

  useEffect(() => {
    const ticket = ++latest.current;
    if (bos.trim() === "") {
      setConverted(EMPTY);
      return;
    }
    animBos2lua({ source: bos, name: fileName, ...(path ? { path } : {}) })
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
  }, [bos, fileName, path]);

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
            Convert an old <code>.bos</code> unit script to a Lua unit script
            that runs as it is, comments and all. A script loaded or dropped
            here has its <code>#include</code> files read from its folder, and
            one opened out of a game brings them with it. A pasted script has
            none, so one that includes anything cannot be converted.
          </>
        }
        actions={
          <>
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
        <Label
          htmlFor="bos-input"
          className="flex min-h-0 flex-col items-stretch gap-2 font-normal"
        >
          <span className="text-sm font-medium text-muted-foreground">
            {path ? `BOS, from ${path}` : "BOS"}
          </span>
          <Textarea
            id="bos-input"
            value={bos}
            onChange={(e) => {
              setBos(e.target.value);
              if (e.target.value.trim() === "") setPath(null);
            }}
            placeholder={PLACEHOLDER}
            spellCheck={false}
            className="min-h-0 flex-1 resize-none font-mono text-xs leading-relaxed"
          />
        </Label>
        <div className="flex min-h-0 flex-col gap-2">
          <Label
            htmlFor="lua-output"
            className="flex min-h-0 flex-1 flex-col items-stretch gap-2 font-normal"
          >
            <span className="text-sm font-medium text-muted-foreground">
              Lua
            </span>
            <Textarea
              id="lua-output"
              value={converted.lua}
              readOnly
              placeholder="Converted Lua appears here as you type."
              spellCheck={false}
              className="min-h-0 flex-1 resize-none bg-card/30 font-mono text-xs leading-relaxed"
            />
          </Label>
          {converted.error && (
            <p role="alert" className="text-sm text-destructive">
              {converted.error}
            </p>
          )}
          {converted.warnings.length > 0 && (
            <ul className="max-h-32 list-disc overflow-y-auto pl-5 text-xs text-muted-foreground">
              {converted.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
          {converted.cobVars && (
            <section
              aria-labelledby="cob-vars-heading"
              className="flex flex-col gap-2 rounded-md border border-border p-3 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 id="cob-vars-heading" className="text-sm font-medium">
                  Add <code>lualibs/cob_vars.lua</code> to the game
                </h2>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void copy(converted.cobVars ?? "", "cobVars")}
                >
                  {copied === "cobVars" ? <Check /> : <Copy />}{" "}
                  {copied === "cobVars" ? "Copied" : "Copy file"}
                </Button>
              </div>
              <p className="text-muted-foreground">
                This script can share values with other units, which it keeps as
                rules params. The file lets the game's synced gadgets set them,
                and its gadgets and widgets read them, through{" "}
                <code>Spring.SetUnitCOBValue</code>,{" "}
                <code>Spring.GetCOBTeamVar</code> and their siblings. Put{" "}
                <code>VFS.Include("lualibs/cob_vars.lua")</code> on the first
                line of <code>LuaRules/main.lua</code>,{" "}
                <code>LuaRules/draw.lua</code> and <code>luaui.lua</code> (or{" "}
                <code>LuaUI/main.lua</code>).
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
