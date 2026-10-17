// @vitest-environment happy-dom

/** The module share drawer (#3272): a code for a module of parts, the reason
 * and no code for one holding a piece lifted from a game. */

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
  PublishSection: ({ code }: { code: string }) => (
    <p data-testid="publish">{code}</p>
  ),
}));

import { identify } from "@/container/container";
import { type LegoProject, newProject } from "../../model";
import { ShareModuleForm } from "./ShareModuleForm";

function module(lifted: boolean): LegoProject {
  const base = newProject({
    id: "m1",
    rootPieceId: "root",
    name: "Turret",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
  });
  return {
    ...base,
    pieces: base.pieces.map((piece) =>
      lifted
        ? {
            ...piece,
            meshId: "m0",
            lifted: {
              game: { name: "Beyond All Reason", archive: "bar.sdd" },
              member: "objects3d/armcom.s3o",
            },
          }
        : piece,
    ),
  };
}

afterEach(cleanup);

describe("ShareModuleForm", () => {
  it("hands a module of parts to the hub as a module code", () => {
    render(<ShareModuleForm module={module(false)} />);
    const code = screen.getByTestId("publish").textContent ?? "";
    expect(identify(code).kind).toBe("module");
  });

  it("refuses a module with a lifted piece and offers no code", () => {
    render(<ShareModuleForm module={module(true)} />);
    expect(
      screen.getByText(/holds a piece from Beyond All Reason/),
    ).toBeTruthy();
    expect(screen.getByText(/cannot be uploaded to the hub/)).toBeTruthy();
    expect(screen.queryByTestId("publish")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
