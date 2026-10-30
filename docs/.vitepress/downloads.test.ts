import { afterEach, describe, expect, it, vi } from "vitest";
import { pickDownloads, RELEASE_PAGE, resolveDownloads } from "./downloads";

const url = (name: string) => `https://example.test/${name}`;
const file = (name: string) => ({ name, browser_download_url: url(name) });

// The file list of the 1.24.0 release.
const RELEASE = [
  "Coilbox_1.24.0_aarch64.dmg",
  "Coilbox_1.24.0_amd64.AppImage",
  "Coilbox_1.24.0_amd64.AppImage.sig",
  "Coilbox_1.24.0_x64-portable.zip",
  "Coilbox_1.24.0_x64-portable.zip.sig",
  "Coilbox_1.24.0_x64-setup.exe",
  "Coilbox_1.24.0_x64-setup.exe.sig",
  "Coilbox_aarch64.app.tar.gz",
  "Coilbox_aarch64.app.tar.gz.sig",
  "latest.json",
].map(file);

afterEach(() => vi.unstubAllGlobals());

describe("pickDownloads", () => {
  it("picks the disk image, the installer and the AppImage", () => {
    expect(pickDownloads(RELEASE)).toEqual({
      macos: url("Coilbox_1.24.0_aarch64.dmg"),
      windows: url("Coilbox_1.24.0_x64-setup.exe"),
      linux: url("Coilbox_1.24.0_amd64.AppImage"),
    });
  });

  it.each([
    "Coilbox_1.24.0_aarch64.dmg",
    "Coilbox_1.24.0_x64-setup.exe",
    "Coilbox_1.24.0_amd64.AppImage",
  ])("throws when %s is missing, even with its signature there", (name) => {
    expect(() => pickDownloads(RELEASE.filter((f) => f.name !== name))).toThrow(
      /expected one file ending/,
    );
  });

  it("throws when two files match one button", () => {
    expect(() =>
      pickDownloads([...RELEASE, file("Other_x64-setup.exe")]),
    ).toThrow(/found 2/);
  });
});

describe("resolveDownloads", () => {
  it("links the release page on a local build with no token", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const found = await resolveDownloads({});
    expect(found.macos.startsWith(RELEASE_PAGE)).toBe(true);
    expect(found.windows.startsWith(RELEASE_PAGE)).toBe(true);
    expect(found.linux.startsWith(RELEASE_PAGE)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails on GitHub Actions with no token", async () => {
    await expect(resolveDownloads({ GITHUB_ACTIONS: "true" })).rejects.toThrow(
      /GH_TOKEN/,
    );
  });

  it("fails when GitHub refuses the request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 403 })),
    );
    await expect(resolveDownloads({ GH_TOKEN: "t" })).rejects.toThrow(/403/);
  });

  it("reads the files of the latest release", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ assets: RELEASE })),
    );
    const found = await resolveDownloads({ GH_TOKEN: "t" });
    expect(found.linux).toBe(url("Coilbox_1.24.0_amd64.AppImage"));
  });
});
