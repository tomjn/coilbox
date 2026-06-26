import { Button } from "@picoframe/frame";
import { Check, Copy, FileCode2, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { bos2lua } from "../bos2lua";

const PLACEHOLDER = `piece base, turret, barrel;

Create()
{
    hide barrel;
    start-script SmokeUnit();
}
...`;

/**
 * BOS → Lua unit-script converter. Converts live as you type via the in-repo
 * `bos2lua` port — fully client-side, no backend. The conversion is best-effort
 * (it mirrors CarRepairer's original tool) and the output usually needs
 * hand-fixing, so we surface that up front.
 */
export default function Bos2LuaPage() {
  const [bos, setBos] = useState("");
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const lua = useMemo(() => (bos.trim() === "" ? "" : bos2lua(bos)), [bos]);

  async function loadFile(file: File | undefined) {
    if (!file) return;
    setBos(await file.text());
  }

  async function copyLua() {
    if (!lua) return;
    try {
      await navigator.clipboard.writeText(lua);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may be unavailable; the textarea is selectable as a fallback
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold leading-none">
            <FileCode2 size={18} /> BOS → Lua
          </h1>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Convert an old <code>.bos</code> unit script to a Lua unit script.
            Best-effort (a port of CarRepairer's converter) — it does the bulk
            of the mechanical work, but expect to hand-fix the result.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
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
          <Button size="sm" onClick={copyLua} disabled={!lua}>
            {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy Lua"}
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-4 p-6">
        <label htmlFor="bos-input" className="flex min-h-0 flex-col gap-2">
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
        </label>
        <label htmlFor="lua-output" className="flex min-h-0 flex-col gap-2">
          <span className="text-sm font-medium text-muted-foreground">Lua</span>
          <Textarea
            id="lua-output"
            value={lua}
            readOnly
            placeholder="Converted Lua appears here as you type."
            spellCheck={false}
            className="min-h-0 flex-1 resize-none bg-card/30 font-mono text-xs leading-relaxed"
          />
        </label>
      </div>
    </div>
  );
}
