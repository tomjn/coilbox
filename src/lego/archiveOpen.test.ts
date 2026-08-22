import { describe, expect, it } from "vitest";

import {
  builderOpenUrl,
  modelName,
  openableInBuilder,
  openRequest,
} from "./archiveOpen";

describe("openableInBuilder", () => {
  it("is a .s3o, whatever case it is written in", () => {
    expect(openableInBuilder("objects3d/ARMCOM.S3O")).toBe(true);
    expect(openableInBuilder("objects3d/armcom.s3o")).toBe(true);
  });

  it("is not a .3do, which the import cannot read", () => {
    expect(openableInBuilder("objects3d/armcom.3do")).toBe(false);
    expect(openableInBuilder("unittextures/armcom.dds")).toBe(false);
  });
});

describe("builderOpenUrl", () => {
  const back = (url: string) =>
    openRequest(new URLSearchParams(url.split("?")[1]));

  it("survives an archive and a member with spaces and slashes in them", () => {
    const url = builderOpenUrl({
      archive: "comet catcher remake.sd7",
      member: "objects3d/features/rock 1.s3o",
    });
    expect(back(url)).toEqual({
      archive: "comet catcher remake.sd7",
      member: "objects3d/features/rock 1.s3o",
    });
  });

  it("carries a display name that says more than the file name", () => {
    const url = builderOpenUrl({
      archive: "comet_catcher_remake.sd7",
      member: "objects3d/rock.s3o",
      name: "Comet Catcher Remake",
    });
    expect(back(url)?.name).toBe("Comet Catcher Remake");
  });

  it("leaves out a display name that is only the archive again", () => {
    const url = builderOpenUrl({
      archive: "Game.sdd",
      member: "objects3d/rock.s3o",
      name: "Game.sdd",
    });
    expect(url).not.toContain("name=");
    expect(back(url)?.name).toBeUndefined();
  });
});

describe("openRequest", () => {
  it("is null when either half is missing or blank", () => {
    expect(openRequest(new URLSearchParams(""))).toBeNull();
    expect(openRequest(new URLSearchParams("archive=Game.sdd"))).toBeNull();
    expect(
      openRequest(new URLSearchParams("archive=Game.sdd&member=%20%20")),
    ).toBeNull();
  });
});

describe("modelName", () => {
  it("is the file's own name without its extension or its folders", () => {
    expect(modelName("objects3d/arm/armcom.s3o")).toBe("armcom");
    expect(modelName("objects3d\\arm\\armcom.S3O")).toBe("armcom");
  });
});
