// @vitest-environment happy-dom

/**
 * The offer to reload a texture whose file changed on disk (issue #3225). The
 * Rust side's settling is covered in `texture_watch.rs`: here the backend has
 * already said a file settled, and this is what the unit builder does with it.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const called: { command: string; args: unknown }[] = [];
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand:
    (_plugin: string, command: string) => async (args: unknown) => {
      called.push({ command, args });
      return command === "lego_texture_import"
        ? { key: "new-key.png", name: "skin.png", bytes: 4 }
        : { watching: 0 };
    },
}));

let emit: (payload: { path: string }) => void = () => {};
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (
    _event: string,
    handler: (e: { payload: { path: string } }) => void,
  ) => {
    emit = (payload) => handler({ payload });
    return () => {};
  },
}));

vi.mock("@/lib/textureAlpha", () => ({
  textureHasAlpha: async () => false,
}));

import type { LegoImported } from "../../model";
import { TexturePicker } from "./TexturePicker";

function unit(
  texture?: { source?: string },
  texture2?: { source?: string },
): LegoImported {
  return {
    source: "/units/thing.s3o",
    texture: texture && { key: "old-key.png", name: "skin.png", ...texture },
    texture2: texture2 && {
      key: "old-key2.png",
      name: "shade.png",
      ...texture2,
    },
  } as LegoImported;
}

function watched() {
  return called.filter((c) => c.command === "lego_texture_watch");
}

beforeEach(() => {
  called.length = 0;
  emit = () => {};
});
afterEach(cleanup);

describe("the texture reload offer", () => {
  it("watches the file each texture came from", async () => {
    render(
      <TexturePicker
        imported={unit({ source: "/a/skin.png" }, { source: "/a/shade.png" })}
        onChange={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(watched().at(-1)?.args).toEqual({
        paths: ["/a/skin.png", "/a/shade.png"],
      }),
    );
  });

  it("watches nothing for a texture with no file behind it", async () => {
    render(<TexturePicker imported={unit({})} onChange={vi.fn()} />);
    await waitFor(() => expect(watched()).toHaveLength(1));
    expect(watched()[0]?.args).toEqual({ paths: [] });
  });

  it("stops watching when the unit is closed", async () => {
    const { unmount } = render(
      <TexturePicker
        imported={unit({ source: "/a/skin.png" })}
        onChange={vi.fn()}
      />,
    );
    await waitFor(() => expect(watched()).toHaveLength(1));
    unmount();
    expect(watched().at(-1)?.args).toEqual({ paths: [] });
  });

  it("shows nothing until a watched file changes", async () => {
    render(
      <TexturePicker
        imported={unit({ source: "/a/skin.png" })}
        onChange={vi.fn()}
      />,
    );
    await waitFor(() => expect(watched()).toHaveLength(1));
    act(() => emit({ path: "/somewhere/else.png" }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("offers a reload once, and accepting it reloads the file", async () => {
    const onChange = vi.fn();
    render(
      <TexturePicker
        imported={unit({ source: "/a/skin.png" })}
        onChange={onChange}
      />,
    );
    await waitFor(() => expect(watched()).toHaveLength(1));

    act(() => emit({ path: "/a/skin.png" }));
    act(() => emit({ path: "/a/skin.png" }));
    expect(screen.getAllByRole("status")).toHaveLength(1);
    // Nothing reloads without being asked.
    expect(called.some((c) => c.command === "lego_texture_import")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Reload" }));

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        texture: {
          key: "new-key.png",
          name: "skin.png",
          source: "/a/skin.png",
        },
        missingTexture: undefined,
      }),
    );
    expect(
      called.find((c) => c.command === "lego_texture_import")?.args,
    ).toEqual({ path: "/a/skin.png" });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("offers the shading map separately", async () => {
    const onChange = vi.fn();
    render(
      <TexturePicker
        imported={unit({ source: "/a/skin.png" }, { source: "/a/shade.png" })}
        onChange={onChange}
      />,
    );
    await waitFor(() => expect(watched()).toHaveLength(1));

    act(() => emit({ path: "/a/shade.png" }));
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          texture2: expect.objectContaining({ source: "/a/shade.png" }),
        }),
      ),
    );
  });

  it("dismissing the offer reloads nothing, and a later edit offers again", async () => {
    render(
      <TexturePicker
        imported={unit({ source: "/a/skin.png" })}
        onChange={vi.fn()}
      />,
    );
    await waitFor(() => expect(watched()).toHaveLength(1));

    act(() => emit({ path: "/a/skin.png" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(called.some((c) => c.command === "lego_texture_import")).toBe(false);

    act(() => emit({ path: "/a/skin.png" }));
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("drops the offer when the texture is changed to another file", async () => {
    const { rerender } = render(
      <TexturePicker
        imported={unit({ source: "/a/skin.png" })}
        onChange={vi.fn()}
      />,
    );
    await waitFor(() => expect(watched()).toHaveLength(1));
    act(() => emit({ path: "/a/skin.png" }));
    expect(screen.getAllByRole("status")).toHaveLength(1);

    rerender(
      <TexturePicker
        imported={unit({ source: "/b/other.png" })}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole("status")).toBeNull();
    await waitFor(() =>
      expect(watched().at(-1)?.args).toEqual({ paths: ["/b/other.png"] }),
    );
  });
});
