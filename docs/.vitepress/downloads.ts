// The files the home page's download buttons point at. The release's file names
// carry the version, so the addresses are read from GitHub when the site is built
// and a visitor's browser never has to ask (issue #4877).
export const RELEASE_PAGE = "https://github.com/tomjn/coilbox/releases/latest";
const LATEST_RELEASE_API =
  "https://api.github.com/repos/tomjn/coilbox/releases/latest";

const FILE_ENDINGS = {
  macos: "_aarch64.dmg",
  windows: "_x64-setup.exe",
  linux: "_amd64.AppImage",
};

type Os = keyof typeof FILE_ENDINGS;
export type Downloads = Record<Os, string>;
type ReleaseFile = { name: string; browser_download_url: string };

export function pickDownloads(files: ReleaseFile[]): Downloads {
  const pick = (os: Os) => {
    const found = files.filter((f) => f.name.endsWith(FILE_ENDINGS[os]));
    if (found.length !== 1) {
      const names = files.map((f) => f.name).join(", ");
      throw new Error(
        `expected one file ending ${FILE_ENDINGS[os]} in the latest release, found ${found.length}. It has: ${names}`,
      );
    }
    return found[0].browser_download_url;
  };
  return {
    macos: pick("macos"),
    windows: pick("windows"),
    linux: pick("linux"),
  };
}

// A throw here stops the build, so a deploy keeps the last good site rather than
// publishing a broken button. Only a local build with no token skips the lookup.
export async function resolveDownloads(
  env: Record<string, string | undefined> = process.env,
): Promise<Downloads> {
  if (!env.GH_TOKEN) {
    if (env.GITHUB_ACTIONS) {
      throw new Error(
        "GH_TOKEN is not set, so the site cannot read the release",
      );
    }
    // Distinct addresses, because the hero uses each button's link as its Vue key.
    return {
      macos: `${RELEASE_PAGE}#macos`,
      windows: `${RELEASE_PAGE}#windows`,
      linux: `${RELEASE_PAGE}#linux`,
    };
  }
  const response = await fetch(LATEST_RELEASE_API, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.GH_TOKEN}`,
    },
  });
  if (!response.ok) {
    throw new Error(
      `reading the latest release failed: HTTP ${response.status}`,
    );
  }
  const release = (await response.json()) as { assets: ReleaseFile[] };
  return pickDownloads(release.assets);
}
