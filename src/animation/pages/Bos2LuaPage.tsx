import { Button } from "@picoframe/frame";
import { Check, Copy, FileCode2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { animBos2lua } from "../bindings";

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
  error: string | null;
}

const EMPTY: Converted = { lua: "", warnings: [], error: null };

/**
 * BOS → Lua unit-script converter. Converts as you type through the Rust
 * converter, whose Lua runs as it is. A pasted script has no `#include` files
 * beside it, so the warnings say which it asked for, and the engine's own
 * names stand in for the unit values those headers usually define.
 */
export default function Bos2LuaPage() {
  const [bos, setBos] = useState("");
  const [fileName, setFileName] = useState("script.bos");
  const [converted, setConverted] = useState<Converted>(EMPTY);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // Only the newest conversion is shown, so a slow one for an older version
  // of the text cannot land on top of the current one.
  const latest = useRef(0);

  useEffect(() => {
    const ticket = ++latest.current;
    if (bos.trim() === "") {
      setConverted(EMPTY);
      return;
    }
    animBos2lua({ source: bos, name: fileName })
      .then(({ lua, warnings }) => {
        if (ticket === latest.current)
          setConverted({ lua, warnings, error: null });
      })
      .catch((error: unknown) => {
        if (ticket === latest.current) {
          setConverted({
            ...EMPTY,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
  }, [bos, fileName]);

  async function loadFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setBos(await file.text());
  }

  async function copyLua() {
    if (!converted.lua) return;
    try {
      await navigator.clipboard.writeText(converted.lua);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
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
            that runs as it is, comments and all. A script opened out of a game
            brings its <code>#include</code> files with it. One pasted here does
            not, so any it asks for are listed under the Lua.
          </>
        }
        actions={
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".bos,.txt"
              className="hidden"
              onChange={(e) => {
                void loadFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
            >
              <Upload /> Load .bos…
            </Button>
            <Button size="sm" onClick={copyLua} disabled={!converted.lua}>
              {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy Lua"}
            </Button>
          </>
        }
      />

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-4 p-6">
        <Label
          htmlFor="bos-input"
          className="flex min-h-0 flex-col items-stretch gap-2 font-normal"
        >
          <span className="text-sm font-medium text-muted-foreground">BOS</span>
          <Textarea
            id="bos-input"
            value={bos}
            onChange={(e) => setBos(e.target.value)}
            onDrop={(e) => {
              const file = e.dataTransfer.files?.[0];
              if (file) {
                e.preventDefault();
                void loadFile(file);
              }
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
        </div>
      </div>
    </div>
  );
}
