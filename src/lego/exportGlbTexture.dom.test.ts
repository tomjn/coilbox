// @vitest-environment happy-dom
/**
 * What colours the `.glb` carries, read back out of the embedded picture
 * (#4173).
 *
 * This runs the real `exportGlb` and the real `GLTFExporter`. Two things are
 * stood in for because happy-dom has neither: WebGL, which `readTexturePixels`
 * decodes through, and a 2D canvas, which the exporter draws the picture into.
 * The canvas stand-in keeps the pixels it is given, applies the vertical flip
 * the exporter asks for, and "encodes" them as raw RGBA, so the bytes in the
 * container's image are the pixels the exporter embeds.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";

import { exportGlb } from "./exportGlb";
import { type LegoPiece, type LegoProject, newProject } from "./model";
import type { LegoPartInfo, LoadedPack } from "./pack";

type Rgba = [number, number, number, number];

/** What a url decodes to. A real browser reads a file with no alpha channel as
 *  alpha 255 everywhere, so a test models that by giving the pixels alpha 255. */
const pictures = new Map<
  string,
  { width: number; height: number; data: Uint8ClampedArray }
>();

vi.mock("../lib/texturePixels", () => ({
  readTexturePixels: async (url: string) => {
    const picture = pictures.get(url);
    if (!picture) throw new Error(`no picture for ${url}`);
    return {
      width: picture.width,
      height: picture.height,
      data: new Uint8ClampedArray(picture.data),
    };
  },
}));

interface CanvasState {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  flipped: boolean;
}

const canvases = new WeakMap<object, CanvasState>();

function stateOf(canvas: HTMLCanvasElement): CanvasState {
  let state = canvases.get(canvas);
  if (!state) {
    state = {
      width: 0,
      height: 0,
      data: new Uint8ClampedArray(0),
      flipped: false,
    };
    canvases.set(canvas, state);
  }
  return state;
}

beforeAll(() => {
  if (typeof ImageData === "undefined") {
    class FakeImageData {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number,
      ) {}
    }
    vi.stubGlobal("ImageData", FakeImageData);
  }

  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement) {
      return {
        translate: () => {},
        scale: (_x: number, y: number) => {
          if (y < 0) stateOf(this).flipped = true;
        },
        putImageData: (image: {
          data: Uint8ClampedArray;
          width: number;
          height: number;
        }) => {
          const state = stateOf(this);
          state.width = image.width;
          state.height = image.height;
          state.data = new Uint8ClampedArray(image.data);
        },
        drawImage: (source: HTMLCanvasElement) => {
          const from = stateOf(source);
          const to = stateOf(this);
          to.width = from.width;
          to.height = from.height;
          to.data = new Uint8ClampedArray(from.data.length);
          for (let y = 0; y < from.height; y++) {
            const row = to.flipped ? from.height - 1 - y : y;
            to.data.set(
              from.data.subarray(
                row * from.width * 4,
                (row + 1) * from.width * 4,
              ),
              y * from.width * 4,
            );
          }
        },
      } as unknown as CanvasRenderingContext2D;
    } as typeof HTMLCanvasElement.prototype.getContext,
  );

  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    this: HTMLCanvasElement,
    callback: BlobCallback,
  ) {
    callback(new Blob([stateOf(this).data.slice()]));
  });
});

/**
 * A 2 by 2 atlas, read top row first: red, green over blue, yellow. Alpha is the
 * team colour mask, 0 unless a test says otherwise.
 */
function atlas(alpha: [number, number, number, number] = [0, 0, 0, 0]) {
  const colours: [number, number, number][] = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 0],
  ];
  const data = new Uint8ClampedArray(16);
  colours.forEach(([r, g, b], i) => {
    data.set([r, g, b, alpha[i]], i * 4);
  });
  return { width: 2, height: 2, data };
}

/** One triangle whose corners all sit at (u, v), v counted up from the bottom
 *  of the atlas as the pack's UVs are. */
function pack(u: number, v: number): LoadedPack {
  const part: LegoPartInfo = {
    id: "tri",
    packId: "lego",
    shapeId: "tri",
    name: "tri",
    category: "grey",
    colourway: "grey",
    shape: "tri",
    material: "metal",
    tags: [],
    vFirst: 0,
    vCount: 3,
    iFirst: 0,
    iCount: 3,
    bbox: { min: [0, 0, 0], max: [1, 0, 1] },
    uvBox: { min: [u, v], max: [u, v] },
    pivot: [0, 0, 0],
    sourceNames: [],
    aliasCount: 0,
  };
  const vertices = new Float32Array([
    0,
    0,
    0,
    0,
    1,
    0,
    u,
    v,
    1,
    0,
    0,
    0,
    1,
    0,
    u,
    v,
    0,
    0,
    1,
    0,
    1,
    0,
    u,
    v,
  ]);
  return {
    manifest: {} as LoadedPack["manifest"],
    library: { packs: [], atlases: [], dir: "", problems: [] },
    parts: [part],
    byId: new Map([["tri", part]]),
    vertices,
    indices: new Uint16Array([0, 1, 2]),
  };
}

function project(): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "probe",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-16T00:00:00Z",
  });
  const piece: LegoPiece = {
    id: "hull",
    name: "hull",
    parentId: "root",
    partId: "tri",
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  } as LegoPiece;
  return { ...base, pieces: [...base.pieces, piece] };
}

const TEAM: Rgba = [0x10, 0x28, 0xcc, 255];

interface Embedded {
  width: number;
  height: number;
  data: Uint8Array;
  uv: [number, number];
}

/** The picture and the first UV in a binary glTF, as a glTF viewer reads them. */
function readGlb(bytes: ArrayBuffer): Embedded {
  const view = new DataView(bytes);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(
    new TextDecoder().decode(new Uint8Array(bytes, 20, jsonLength)),
  );
  const binStart = 20 + jsonLength + 8;
  const slice = (bufferView: number, extra = 0) => {
    const { byteOffset = 0, byteLength } = json.bufferViews[bufferView];
    return { start: binStart + byteOffset + extra, length: byteLength };
  };

  const image = slice(json.images[0].bufferView);
  const data = new Uint8Array(
    bytes.slice(image.start, image.start + image.length),
  );

  const accessor =
    json.accessors[json.meshes[0].primitives[0].attributes.TEXCOORD_0];
  const uvAt = slice(accessor.bufferView, accessor.byteOffset ?? 0);
  const uv = new Float32Array(bytes.slice(uvAt.start, uvAt.start + 8));

  // The atlas in these tests is always 2 by 2.
  return { width: 2, height: 2, data, uv: [uv[0], uv[1]] };
}

/** The pixel a viewer shows at the embedded picture's first UV: u across, v
 *  down from the top, which is how glTF counts. */
function sampled(glb: Embedded): Rgba {
  const x = Math.min(glb.width - 1, Math.floor(glb.uv[0] * glb.width));
  const y = Math.min(glb.height - 1, Math.floor(glb.uv[1] * glb.height));
  const at = (y * glb.width + x) * 4;
  return Array.from(glb.data.subarray(at, at + 4)) as Rgba;
}

async function exported(url: string, u: number, v: number) {
  const bytes = await exportGlb(project(), pack(u, v), null, url);
  return readGlb(bytes as ArrayBuffer);
}

describe("exportGlb colours", () => {
  it("shows a part's own colour from an atlas with an alpha of 0", async () => {
    pictures.set("atlas-alpha-0", atlas());

    const glb = await exported("atlas-alpha-0", 0.25, 0.25);

    // Every embedded pixel is the atlas's own, none is team colour.
    for (let i = 0; i < glb.data.length; i += 4) {
      expect(Array.from(glb.data.subarray(i, i + 4))).not.toEqual(TEAM);
    }
  });

  /**
   * The pack counts v up from the bottom of the atlas. A face at (0.25, 0.25) is
   * in the bottom left quadrant, which is blue. The exporter flips the picture
   * to match, so a viewer sampling v down from the top lands on blue too.
   */
  it("samples the colour the pack's UVs name, so v is not turned over", async () => {
    pictures.set("atlas-alpha-0", atlas());

    expect(sampled(await exported("atlas-alpha-0", 0.25, 0.25))).toEqual([
      0, 0, 255, 255,
    ]);
    expect(sampled(await exported("atlas-alpha-0", 0.75, 0.25))).toEqual([
      255, 255, 0, 255,
    ]);
    expect(sampled(await exported("atlas-alpha-0", 0.25, 0.75))).toEqual([
      255, 0, 0, 255,
    ]);
    expect(sampled(await exported("atlas-alpha-0", 0.75, 0.75))).toEqual([
      0, 255, 0, 255,
    ]);
  });

  /** An imported unit's own texture, or an atlas that has drawn its own mask. */
  it("keeps an alpha the texture has as the team colour mask", async () => {
    // Only the red pixel, top left, is all team colour.
    pictures.set("masked", atlas([255, 0, 0, 0]));

    const red = sampled(await exported("masked", 0.25, 0.75));
    const blue = sampled(await exported("masked", 0.25, 0.25));

    expect(red).toEqual(TEAM);
    expect(blue).toEqual([0, 0, 255, 255]);
  });

  /** What a browser reads a file with no alpha channel as. */
  it("turns an atlas read back with alpha 255 entirely to team colour", async () => {
    pictures.set("opaque", atlas([255, 255, 255, 255]));

    const glb = await exported("opaque", 0.25, 0.25);

    for (let i = 0; i < glb.data.length; i += 4) {
      expect(Array.from(glb.data.subarray(i, i + 4))).toEqual(TEAM);
    }
  });
});
