import { beforeEach, describe, expect, it, vi } from "vitest";

import { newProject } from "./model";
import { serializeModuleFile } from "./moduleFile";

const save = vi.fn();
const open = vi.fn();
const ask = vi.fn();
const write = vi.fn();
const read = vi.fn();
const saveCompound = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: (a: unknown) => save(a),
  open: (a: unknown) => open(a),
  ask: (...a: unknown[]) => ask(...a),
}));
vi.mock("./bindings", () => ({
  legoWriteTextFile: (a: unknown) => write(a),
  legoReadTextFile: (a: unknown) => read(a),
}));
vi.mock("./projects", () => ({
  saveCompound: (a: unknown) => saveCompound(a),
}));

const { loadModuleFromFile, saveModuleToFile } = await import("./moduleFileIo");

function module(id: string, name: string, partId: string | null = null) {
  const base = newProject({
    id,
    rootPieceId: "root",
    name,
    packId: "lego",
    packVersion: "1",
    now: "2026-07-29T00:00:00Z",
  });
  return {
    ...base,
    pieces: [
      ...base.pieces,
      {
        id: "p1",
        name: "barrel",
        parentId: "root",
        partId,
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  saveCompound.mockImplementation(async (m) => m);
});

describe("saveModuleToFile", () => {
  it("writes the module where the save dialog said", async () => {
    save.mockResolvedValue("/tmp/Turret.coilbox-module.json");
    const out = await saveModuleToFile(module("a", "Turret"));
    expect(save.mock.calls[0][0].defaultPath).toBe(
      "Turret.coilbox-module.json",
    );
    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0][0].path).toBe("/tmp/Turret.coilbox-module.json");
    expect(JSON.parse(write.mock.calls[0][0].text).fileVersion).toBe(1);
    expect(out?.level).toBe("success");
  });

  it("writes nothing when the dialog is cancelled", async () => {
    save.mockResolvedValue(null);
    expect(await saveModuleToFile(module("a", "Turret"))).toBeNull();
    expect(write).not.toHaveBeenCalled();
  });

  it("reports a failed write", async () => {
    save.mockResolvedValue("/tmp/x.json");
    write.mockRejectedValue(new Error("disk full"));
    const out = await saveModuleToFile(module("a", "Turret"));
    expect(out).toMatchObject({ level: "error", body: "disk full" });
  });
});

describe("loadModuleFromFile", () => {
  const known = new Set(["part1"]);

  it("adds a module from a file", async () => {
    open.mockResolvedValue("/tmp/t.json");
    read.mockResolvedValue({
      text: serializeModuleFile(module("a", "Turret", "part1")),
    });
    const out = await loadModuleFromFile([], known);
    expect(saveCompound).toHaveBeenCalledOnce();
    expect(saveCompound.mock.calls[0][0].id).toBe("a");
    expect(out?.level).toBe("success");
  });

  it("does nothing when the dialog is cancelled", async () => {
    open.mockResolvedValue(null);
    expect(await loadModuleFromFile([], known)).toBeNull();
    expect(saveCompound).not.toHaveBeenCalled();
  });

  it("refuses a file that is not a module and says why", async () => {
    open.mockResolvedValue("/tmp/t.json");
    read.mockResolvedValue({ text: '{"a":1}' });
    const out = await loadModuleFromFile([], known);
    expect(out).toMatchObject({
      level: "error",
      body: "The file does not hold a module.",
    });
    expect(saveCompound).not.toHaveBeenCalled();
  });

  it("loads a module with missing parts and lists them", async () => {
    open.mockResolvedValue("/tmp/t.json");
    read.mockResolvedValue({
      text: serializeModuleFile(module("a", "Turret", "gone")),
    });
    const out = await loadModuleFromFile([], known);
    expect(saveCompound).toHaveBeenCalledOnce();
    expect(out).toMatchObject({ level: "warning" });
    expect(out?.body).toContain("barrel");
  });

  it("asks before an id clash and replaces when the user says so", async () => {
    open.mockResolvedValue("/tmp/t.json");
    read.mockResolvedValue({
      text: serializeModuleFile(module("a", "Turret")),
    });
    ask.mockResolvedValue(true);
    await loadModuleFromFile([module("a", "Turret")], known);
    expect(ask).toHaveBeenCalledOnce();
    expect(saveCompound.mock.calls[0][0].id).toBe("a");
  });

  it("keeps both under a new id when the user does not replace", async () => {
    open.mockResolvedValue("/tmp/t.json");
    read.mockResolvedValue({
      text: serializeModuleFile(module("a", "Turret")),
    });
    ask.mockResolvedValue(false);
    await loadModuleFromFile([module("a", "Turret")], known);
    const saved = saveCompound.mock.calls[0][0];
    expect(saved.id).not.toBe("a");
    expect(saved.name).toBe("Turret 2");
  });

  it("does not ask for a built in module and saves a copy", async () => {
    open.mockResolvedValue("/tmp/t.json");
    const builtIn = module("builtin.wheel", "Wheel");
    read.mockResolvedValue({ text: serializeModuleFile(builtIn) });
    await loadModuleFromFile([builtIn], known);
    expect(ask).not.toHaveBeenCalled();
    expect(saveCompound.mock.calls[0][0].id).not.toBe("builtin.wheel");
  });
});
