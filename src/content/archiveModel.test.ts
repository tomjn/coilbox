import { describe, expect, it } from "vitest";
import {
  MODEL_PREVIEW_CAP,
  modelFormatFor,
  modelTooLargeToPreview,
} from "./archiveModel";

describe("modelFormatFor", () => {
  it("names the two formats the viewer draws", () => {
    expect(modelFormatFor("objects3d/armcom.s3o")).toBe("s3o");
    expect(modelFormatFor("objects3d/armcom.3do")).toBe("3do");
  });

  it("reads an archive's own casing", () => {
    expect(modelFormatFor("Objects3D/ARMCOM.S3O")).toBe("s3o");
    expect(modelFormatFor("Objects3D/ArmCom.3DO")).toBe("3do");
  });

  it("leaves everything else alone", () => {
    expect(modelFormatFor("unittextures/armcom.dds")).toBeUndefined();
    expect(modelFormatFor("scripts/armcom.bos")).toBeUndefined();
    expect(modelFormatFor("LuaUI/main.lua")).toBeUndefined();
  });

  /** The extension is the end of the name, not something in the middle of it:
   *  a folder called `s3o` holds files that are not models. */
  it("does not take a folder name for an extension", () => {
    expect(modelFormatFor("objects3d/s3o/readme.txt")).toBeUndefined();
    expect(modelFormatFor("armcom.s3o.bak")).toBeUndefined();
  });
});

describe("modelTooLargeToPreview", () => {
  it("passes a real model and refuses one past the cap", () => {
    expect(modelTooLargeToPreview(3.2 * 1024 * 1024)).toBe(false);
    expect(modelTooLargeToPreview(MODEL_PREVIEW_CAP)).toBe(false);
    expect(modelTooLargeToPreview(MODEL_PREVIEW_CAP + 1)).toBe(true);
  });

  it("reads a size it never got as a reason to try", () => {
    expect(modelTooLargeToPreview(undefined)).toBe(false);
  });
});
