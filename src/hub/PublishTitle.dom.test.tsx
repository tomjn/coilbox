// @vitest-environment happy-dom

/** Each share drawer hands its item's name to the hub section, so the hub
 * Title starts as that name (#4821). The section itself is covered in
 * `PublishSection.dom.test.tsx`. */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@picoframe/frame", async () => {
  const { forwardRef } = await import("react");
  return {
    Button: forwardRef<HTMLButtonElement, Record<string, unknown>>(
      ({ variant: _v, size: _s, ...props }, ref) => (
        <button ref={ref} type="button" {...props} />
      ),
    ),
  };
});
vi.mock("@/hub/PublishSection", () => ({
  PublishSection: ({ title }: { title?: string }) => (
    <p data-testid="publish-title">{title}</p>
  ),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));

import { newStoredBlueprint } from "@/blueprint/library";
import { ShareBlueprintForm } from "@/blueprint/pages/components/ShareBlueprintForm";
import { ChallengeCodeView } from "@/challenge/ChallengeCodeView";
import { ShareProjectForm } from "@/workshop/pages/components/ShareProjectForm";
import { EMPTY_EDITS } from "@/workshop/project";

afterEach(cleanup);

const titleShown = () => screen.getByTestId("publish-title").textContent;

describe("the hub Title starts as the item's name", () => {
  it("for a blueprint", () => {
    render(
      <ShareBlueprintForm
        record={newStoredBlueprint("Example: raised plaza", "Zero-K v1")}
      />,
    );
    expect(titleShown()).toBe("Example: raised plaza");
  });

  it("for a tweak project", () => {
    render(
      <ShareProjectForm
        installed={[]}
        project={{
          id: "p1",
          name: "Big guns",
          gameName: "Balanced Annihilation V15.9.8",
          edits: EMPTY_EDITS,
          createdAt: "2026-09-08T00:00:00.000Z",
          updatedAt: "2026-09-08T00:00:00.000Z",
        }}
      />,
    );
    expect(titleShown()).toBe("Big guns");
  });

  it("for a challenge, through the shared code view", () => {
    render(<ChallengeCodeView code="cbz1.x" helpText="Help" title="Duel" />);
    expect(titleShown()).toBe("Duel");
  });
});
