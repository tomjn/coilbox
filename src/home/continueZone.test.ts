import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResumeCandidate } from "./continue";

// Vitest runs in node with no DOM, and the published dists of @picoframe/frame
// and its plugin SDK use extensionless relative imports the node resolver won't
// load, so the leaves are stubbed and the component is called as a function
// (same approach as greeting.test.ts). The four stubs below the frame are the
// ones continue.test.ts needs to load the collector, kept because this test does
// load it: only `useResume` is replaced, so the card is checked against the real
// per-kind copy rather than against a second copy of it written here.
vi.mock("@picoframe/frame", () => ({
  useSetting: () => [{}, () => {}],
  buttonVariants: () => "button",
  cn: (...parts: unknown[]) => parts.filter(Boolean).join(" "),
}));
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));
vi.mock("../multiplayer/ringEffect", () => ({ triggerRing: () => {} }));
vi.mock("../multiplayer/ingameCue", () => ({ triggerIngameCue: () => {} }));
vi.mock("../multiplayer/chat/mentionCue", () => ({
  triggerMentionCue: () => {},
}));
vi.mock("react-router", () => ({ Link: () => null }));

const resume =
  vi.fn<() => { candidates: ResumeCandidate[]; loading: boolean }>();
vi.mock("./continue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./continue")>()),
  useResume: () => resume(),
}));

import { Link } from "react-router";
import Continue from "./zones/Continue";

const WARPATH: ResumeCandidate = {
  id: "warpath:run-1",
  kind: "warpath",
  title: "Kestrel",
  detail: "BAR · health 8/10",
  to: "/warpath/run-1",
  touchedAt: Date.parse("2026-08-01T12:00:00Z"),
};

const CONQUEST: ResumeCandidate = {
  id: "conquest:orion",
  kind: "conquest",
  title: "Orion Reach",
  detail: "Turn 7",
  to: "/conquest/orion",
  touchedAt: Date.parse("2026-07-30T12:00:00Z"),
};

/** Every element in the rendered tree, so a test can look for one part of it. */
function nodes(node: unknown): { type: unknown; props: Props }[] {
  const el = node as { type?: unknown; props?: Props } | null;
  if (!el || typeof el !== "object" || !("props" in el)) return [];
  const kids = el.props?.children;
  const children = (Array.isArray(kids) ? kids : [kids]).flatMap(nodes);
  return [{ type: el.type, props: el.props ?? {} }, ...children];
}

type Props = { children?: unknown; [key: string]: unknown };

/** Every string the card puts on the page, in order. */
function text(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(text);
  const kids = (node as { props?: Props } | null)?.props?.children;
  return kids === undefined ? [] : text(kids);
}

/** The card's action link, or undefined when there is no card. */
function action(node: unknown) {
  return nodes(node).find((n) => n.type === Link)?.props;
}

beforeEach(() => {
  resume.mockReturnValue({ candidates: [], loading: false });
});

describe("Continue zone", () => {
  it("shows the best candidate's kind, title and detail", () => {
    resume.mockReturnValue({ candidates: [WARPATH, CONQUEST], loading: false });
    expect(text(Continue({}))).toEqual([
      "Warpath run",
      "Kestrel",
      "BAR · health 8/10",
      "Resume run",
    ]);
  });

  it("takes only the head of the list, leaving the rest to the rail", () => {
    resume.mockReturnValue({ candidates: [WARPATH, CONQUEST], loading: false });
    expect(text(Continue({}))).not.toContain("Orion Reach");
  });

  it("sends its action where the candidate says", () => {
    resume.mockReturnValue({ candidates: [WARPATH], loading: false });
    expect(action(Continue({}))?.to).toBe("/warpath/run-1");
  });

  it("words its action for the kind it is offering", () => {
    resume.mockReturnValue({ candidates: [CONQUEST], loading: false });
    // The wording comes from the collector, so the rail describes the same run
    // the same way.
    expect(text(Continue({}))).toContain("Resume conquest");
  });

  it("offers to rejoin a battle rather than resume it", () => {
    resume.mockReturnValue({
      candidates: [
        {
          id: "battle:42",
          kind: "battle",
          title: "All Welcome 8v8",
          detail: "Match in progress · hosted by Zephyr",
          to: "/battle",
          touchedAt: Date.now(),
          expiresAt: "soon",
        },
      ],
      loading: false,
    });
    expect(text(Continue({}))).toContain("Rejoin battle");
  });

  it("names the thing its action resumes, not just the verb", () => {
    // "Resume run" alone is what a screen reader reads out when it lists the
    // page's links, and it says nothing about which run. The visible words open
    // the label so voice control can still ask for what is written on it.
    resume.mockReturnValue({ candidates: [WARPATH], loading: false });
    const label = action(Continue({}))?.["aria-label"];
    expect(label).toBe("Resume run: Kestrel");
    expect(String(label).startsWith("Resume run")).toBe(true);
  });

  it("renders nothing when there is nothing to resume", () => {
    // A fresh install. The Onboarding zone owns the one call to action there,
    // and a second one would have the page asking twice.
    expect(Continue({})).toBeNull();
  });

  it("renders nothing while the sources are still loading", () => {
    // Sources answer at different times, so the best of a half-read set can be
    // the wrong card. Waiting costs a beat, swapping the hero costs trust.
    resume.mockReturnValue({ candidates: [CONQUEST], loading: true });
    expect(Continue({})).toBeNull();
  });
});
