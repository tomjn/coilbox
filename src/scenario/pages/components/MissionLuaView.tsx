/**
 * The mission file the engine is handed, shown to be read (issue #2163).
 *
 * `compileScenario` already turns a document into the exact text that gets
 * written into the game archive, and until now the only copy of it was the one
 * inside that archive. So the same function runs here and its output is put on
 * screen, which needs no launch, no engine and no write.
 *
 * The text is selectable as well as copyable, because the clipboard can be
 * unavailable and a reader who only wants one line should not have to take the
 * whole file to get it.
 *
 * A mission is thousands of lines, so it is shown with line numbers, syntax
 * colour and a find box rather than as one undifferentiated block (issue
 * #2282): `MissionLuaCode` carries the line-numbered, virtualized, coloured
 * view, and this component owns the find box and the keyboard around it.
 */

import { Button, Input } from "@picoframe/frame";
import { Check, ChevronDown, ChevronUp, Copy, Search } from "lucide-react";
import {
  type InputHTMLAttributes,
  type Ref,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { compileScenario, missionPath } from "../../compile";
import type { Scenario } from "../../model";
import { MissionLuaCode, type MissionLuaCodeHandle } from "./MissionLuaCode";
import { findMatches, stepMatch } from "./missionLuaSearch";
import { useLuaTokens } from "./missionLuaTokens";

/**
 * `@picoframe/frame`'s `Input` forwards `ref` to the underlying `<input>` at
 * runtime (React 19 passes `ref` through to any function component, no
 * `forwardRef` needed), but its published type is plain
 * `InputHTMLAttributes` with no `ref`, so TypeScript refuses it. The find box
 * genuinely needs the DOM node, to focus it on Cmd/Ctrl+F and to tell whether
 * it is the thing focused when Escape is pressed, so this re-types the same
 * component rather than reaching for a hand-rolled input.
 */
const FindInput = Input as unknown as (
  props: InputHTMLAttributes<HTMLInputElement> & {
    ref?: Ref<HTMLInputElement>;
  },
) => ReturnType<typeof Input>;

/** How long the copy button says it copied before going back to offering. */
const COPIED_MS = 1500;

/**
 * Compile a document, or say why it would not compile.
 *
 * The compiler throws on a document it cannot emit, and a mission that will not
 * compile is exactly the mission somebody opens this to look at, so the throw is
 * caught and reported rather than taking the editor down with it.
 */
export function compiledMissionText(scenario: Scenario): {
  lua: string;
  error?: string;
} {
  try {
    return { lua: compileScenario(scenario) };
  } catch (e) {
    return { lua: "", error: e instanceof Error ? e.message : String(e) };
  }
}

/** The match count read out for the find box's `aria-live` region: colour is
 *  the only other signal a match has, and that carries nothing to a screen
 *  reader (issue #2282). Empty while there is no query, so an empty box does
 *  not announce "no matches" the moment the drawer opens. */
function matchCountLabel(query: string, count: number, at: number | null) {
  if (!query.trim()) return "";
  if (count === 0) return "No matches";
  return `${(at ?? 0) + 1} of ${count}`;
}

export function MissionLuaView({ scenario }: { scenario: Scenario }) {
  const { lua, error } = useMemo(
    () => compiledMissionText(scenario),
    [scenario],
  );
  const lines = useMemo(() => lua.split("\n"), [lua]);
  const tokens = useLuaTokens(lua, lines);

  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState("");
  const [rawIndex, setRawIndex] = useState(0);

  const matches = useMemo(() => findMatches(lines, query), [lines, query]);
  const activeIndex =
    matches.length === 0 ? null : Math.min(rawIndex, matches.length - 1);
  const activeMatch = activeIndex !== null ? matches[activeIndex] : null;

  // A fresh query starts from the first match rather than wherever the last
  // one happened to leave off.
  // biome-ignore lint/correctness/useExhaustiveDependencies: query is the reset trigger, not read in the body
  useEffect(() => {
    setRawIndex(0);
  }, [query]);

  const findInputRef = useRef<HTMLInputElement | null>(null);
  const codeRef = useRef<MissionLuaCodeHandle | null>(null);

  // Jump to whichever match is active, including the first one a fresh query
  // lands on, and including a match not currently mounted by the code view's
  // own virtualization.
  useEffect(() => {
    if (activeMatch) codeRef.current?.scrollToLine(activeMatch.line);
  }, [activeMatch]);

  const goToMatch = (direction: 1 | -1) => {
    const next = stepMatch(matches.length, activeIndex, direction);
    if (next !== null) setRawIndex(next);
  };

  // Cmd/Ctrl+F focuses the find box. Scoped to this component's own lifetime
  // (mounted only while the drawer holding it is open, per Radix's own
  // unmount-on-close), so unlike the editor's page-level shortcuts in
  // `shortcuts.ts` this needs no guard against firing while the drawer is
  // shut: it does not exist to fire.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() !== "f") return;
      event.preventDefault();
      findInputRef.current?.focus();
      findInputRef.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Escape leaves the find box (blurs it) without closing the drawer around
  // it. Radix's dialog closes itself on Escape via a `keydown` listener on
  // `document` in the capture phase (see `@radix-ui/react-dismissable-layer`),
  // which fires before any handler reachable through this component's own
  // JSX tree - a bubble-phase `onKeyDown` on the find input, in particular,
  // is too late to stop it. A `useLayoutEffect` here registers a capture
  // listener of its own on the same target instead. React runs every
  // component's layout effects, tree-wide, before any component's regular
  // effects, so this one is in place before Radix's (added in a plain
  // `useEffect`) exists to race against. Radix only treats Escape as its own
  // once nothing upstream has called `preventDefault()` on it, which is
  // exactly what this does when the find input is the thing focused.
  useLayoutEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.activeElement !== findInputRef.current) return;
      event.preventDefault();
      findInputRef.current?.blur();
    };
    document.addEventListener("keydown", onEscape, { capture: true });
    return () =>
      document.removeEventListener("keydown", onEscape, { capture: true });
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(lua);
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      // The clipboard can be unavailable. The text below is selectable either
      // way, so there is nothing to report and nothing to fix.
    }
  };

  return (
    // Fills the drawer's body so the file itself is what scrolls. Left to grow,
    // the drawer scrolls instead and the copy button leaves with it: a mission
    // is thousands of lines and the button would be at the top of all of them.
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          What the mission runtime reads, compiled from this document. It is
          written into the game as{" "}
          <code className="font-mono">{missionPath(scenario.id)}</code> when the
          mission is played.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          disabled={error !== undefined}
          onClick={() => void copy()}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      {error ? (
        <p className="text-xs text-destructive">
          This document does not compile: {error}
        </p>
      ) : (
        <>
          <div className="flex shrink-0 items-center gap-2">
            <div className="relative max-w-56 flex-1">
              <Search
                size={14}
                className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <FindInput
                ref={findInputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  goToMatch(e.shiftKey ? -1 : 1);
                }}
                placeholder="Find (Cmd+F)"
                aria-label="Find in mission.lua"
                className="h-8 pl-7 text-xs"
              />
            </div>
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
            <span
              data-testid="mission-lua-match-count"
              aria-live="polite"
              className="min-w-0 text-xs text-muted-foreground"
            >
              {matchCountLabel(query, matches.length, activeIndex)}
            </span>
          </div>
          <div className="min-h-0 flex-1">
            <MissionLuaCode
              ref={codeRef}
              lines={lines}
              tokens={tokens}
              matches={matches}
              activeMatch={activeMatch}
            />
          </div>
        </>
      )}
    </div>
  );
}
