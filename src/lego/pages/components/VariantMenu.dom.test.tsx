// @vitest-environment happy-dom

/**
 * The variant menu (#3240): each kind makes a variant and saves it, and a kind
 * that cannot be made is disabled. The variants themselves are tested in
 * `variant.test.ts`.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LegoProject } from "../../model";
import type { LoadedPack } from "../../pack";
import { VariantMenu } from "./VariantMenu";

const makeVariant = vi.fn();
const variantRefusal = vi.fn();
const saveProject = vi.fn();
const notify = vi.fn();

vi.mock("@/notify/notify", () => ({
  notify: (...args: unknown[]) => notify(...args),
}));
vi.mock("../../projects", () => ({
  saveProject: (...args: unknown[]) => saveProject(...args),
}));
vi.mock("../../starterModules", () => ({ starterModules: () => [] }));
vi.mock("../../variant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../variant")>()),
  makeVariant: (...args: unknown[]) => makeVariant(...args),
  variantRefusal: (...args: unknown[]) => variantRefusal(...args),
}));

const unit = { id: "unit", name: "Unit", pieces: [] } as unknown as LegoProject;
const pack = {} as LoadedPack;

function open() {
  render(<VariantMenu project={unit} pack={pack} projects={[]} />);
  fireEvent.keyDown(screen.getByRole("button", { name: "Make a variant" }), {
    key: "Enter",
  });
}

beforeEach(() => {
  makeVariant.mockReset();
  variantRefusal.mockReset().mockReturnValue(null);
  saveProject.mockReset().mockImplementation(async (p: LegoProject) => p);
  notify.mockReset();
});
afterEach(cleanup);

describe("VariantMenu", () => {
  it("saves the variant a kind makes", async () => {
    const made = { id: "v", name: "Unit (heavier)" } as LegoProject;
    makeVariant.mockReturnValue({ status: "ok", unit: made, kind: "heavier" });
    open();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Heavier" }));
    await waitFor(() => expect(saveProject).toHaveBeenCalledWith(made));
    expect(makeVariant.mock.calls[0]?.[1]).toBe("heavier");
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ level: "success" }),
    );
  });

  it("says why a variant failed, and saves nothing", async () => {
    makeVariant.mockReturnValue({ status: "failed", message: "Too tall." });
    open();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Lighter" }));
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({ body: "Too tall.", level: "error" }),
      ),
    );
    expect(saveProject).not.toHaveBeenCalled();
  });

  it("disables a kind that cannot be made", async () => {
    variantRefusal.mockImplementation((_p, kind) =>
      kind === "weapon" ? "No weapon." : null,
    );
    open();
    const item = await screen.findByRole("menuitem", {
      name: "Different weapon",
    });
    expect(item.getAttribute("aria-disabled")).toBe("true");
    expect(item.getAttribute("title")).toBe("No weapon.");
  });
});
