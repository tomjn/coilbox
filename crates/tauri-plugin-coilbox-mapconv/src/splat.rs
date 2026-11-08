//! Splat detail for a compiled map, generated from its heightmap (#5090).
//!
//! Writes, under `<dir>/maps/`:
//! - `splat_distribution.png`, one pixel per heightmap square, whose four
//!   channels weigh the four detail textures: rock, pebbles, ground and shore.
//! - Four tileable DNTS textures (a tangent space normal in RGB, brightness in
//!   alpha), one per channel. They do not depend on the map, so each is made
//!   once and kept in a cache folder.
//! - `detail_normals.dds`, a normal map over the whole map giving rock faces
//!   strata and ground a faint ripple.
//!
//! and names them in `mapinfo.lua` under `resources` and `splats`.
//!
//! Engine facts this relies on, from `~/dev/RecoilEngine`:
//! - `CMapInfo::ReadSMF` reads `resources.splatDistrTex`,
//!   `splatDetailNormalTex1` to `4`, `splatDetailNormalDiffuseAlpha` and
//!   `detailNormalTex`, and looks for each name under `maps/` when it is not
//!   found as given.
//! - The DNTS textures and the distribution are loaded with
//!   `CMipMapTexture`, which builds its own mips, so PNG is fine for them.
//! - `CBitmap::Load` hands a `.dds` to nv_dds with `flipImage` true (every
//!   name not under `unitpics`), and `CreateDDSTexture` only builds mips itself
//!   when the file has none. An uncompressed 32 bit DDS is accepted when its
//!   pixel format flags are exactly `DDPF_RGB | DDPF_ALPHAPIXELS` and it is
//!   uploaded as BGRA.
//! - In the shader's tangent space red is world +x, green is world +z and blue
//!   is up (`SMFFragProg.glsl`, `stnMatrix`).

use std::path::{Path, PathBuf};

use coilbox_springlua::SpringLua;
use image::{Rgba, RgbaImage};

use crate::luapatch::{apply, Key, Mode, Val};
use crate::smf;

/// The distribution's channels, in the order the engine pairs them with
/// `splatDetailNormalTex1` to `4`.
pub const DISTRIBUTION: &str = "splat_distribution.png";
pub const DETAIL_NORMALS: &str = "detail_normals.dds";

/// World units per tile of each DNTS texture is `1 / TEX_SCALE`, so one tile
/// covers 100 elmos, a little over twelve heightmap squares.
const TEX_SCALE: f64 = 0.01;

/// Edge of each cached DNTS texture, in pixels.
pub const DNTS_SIZE: u32 = 512;

/// Bumped whenever a texture's recipe changes, so a cache made by an older
/// build is not reused.
const DNTS_VERSION: u32 = 1;

/// Elmos between heightmap vertices.
const SQUARE: f64 = 8.0;

/// One of the detail textures.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Dnts {
    Rock,
    Pebbles,
    Grass,
    Sand,
    Snow,
    Shore,
}

impl Dnts {
    pub fn name(self) -> &'static str {
        match self {
            Dnts::Rock => "rock",
            Dnts::Pebbles => "pebbles",
            Dnts::Grass => "grass",
            Dnts::Sand => "sand",
            Dnts::Snow => "snow",
            Dnts::Shore => "shore",
        }
    }

    pub fn file(self) -> String {
        format!("dnts_{}.png", self.name())
    }

    const ALL: [Dnts; 6] = [
        Dnts::Rock,
        Dnts::Pebbles,
        Dnts::Grass,
        Dnts::Sand,
        Dnts::Snow,
        Dnts::Shore,
    ];
}

/// The ground texture for a map whose diffuse texture averages `rgb` (0 to 1
/// per channel). Bright and grey is snow, green ahead of red and blue is grass,
/// and anything else, the browns, yellows and reds, is sand.
pub fn pick_ground(rgb: [f64; 3]) -> Dnts {
    let [r, g, b] = rgb;
    let light = (r + g + b) / 3.0;
    let spread = r.max(g).max(b) - r.min(g).min(b);
    if light > 0.68 && spread < 0.12 {
        Dnts::Snow
    } else if g > r && g > b {
        Dnts::Grass
    } else {
        Dnts::Sand
    }
}

/// The average colour of the picture at `path`, read from a small copy.
fn mean_colour(path: &Path) -> Result<[f64; 3], String> {
    let img = image::open(path)
        .map_err(|e| format!("could not read {}: {e}", path.display()))?
        .thumbnail(64, 64)
        .to_rgb8();
    let mut sum = [0.0; 3];
    for p in img.pixels() {
        for c in 0..3 {
            sum[c] += f64::from(p[c]) / 255.0;
        }
    }
    let n = f64::from(img.width() * img.height()).max(1.0);
    Ok(sum.map(|s| s / n))
}

// ---------------------------------------------------------------------------
// Noise. Every function here repeats with a whole number of cells per unit, so
// a texture sampled over 0 to 1 tiles without a seam.

fn hash(x: i64, y: i64, seed: u32) -> u32 {
    let mut h = (x as u32).wrapping_mul(0x8da6_b343)
        ^ (y as u32).wrapping_mul(0xd816_3841)
        ^ seed.wrapping_mul(0xcb1a_b31f);
    h ^= h >> 13;
    h = h.wrapping_mul(0x5bd1_e995);
    h ^= h >> 15;
    h
}

fn unit(h: u32) -> f64 {
    f64::from(h) / f64::from(u32::MAX)
}

fn smooth(t: f64) -> f64 {
    t * t * (3.0 - 2.0 * t)
}

fn smoothstep(a: f64, b: f64, x: f64) -> f64 {
    smooth(((x - a) / (b - a)).clamp(0.0, 1.0))
}

/// Value noise in 0 to 1 with `period` cells across 0 to 1.
fn value(u: f64, v: f64, period: i64, seed: u32) -> f64 {
    let (x, y) = (u * period as f64, v * period as f64);
    let (x0, y0) = (x.floor(), y.floor());
    let (fx, fy) = (smooth(x - x0), smooth(y - y0));
    let at = |i: i64, j: i64| {
        unit(hash(
            (x0 as i64 + i).rem_euclid(period),
            (y0 as i64 + j).rem_euclid(period),
            seed,
        ))
    };
    let top = at(0, 0) + (at(1, 0) - at(0, 0)) * fx;
    let bottom = at(0, 1) + (at(1, 1) - at(0, 1)) * fx;
    top + (bottom - top) * fy
}

/// Several octaves of [`value`], each twice the cells of the last, in 0 to 1.
fn fbm(u: f64, v: f64, period: i64, octaves: u32, seed: u32) -> f64 {
    let (mut sum, mut amp, mut total) = (0.0, 1.0, 0.0);
    for o in 0..octaves {
        sum += amp * value(u, v, period << o, seed.wrapping_add(o * 7919));
        total += amp;
        amp *= 0.5;
    }
    sum / total
}

/// The nearest and second nearest of one jittered point per cell, `cells`
/// across 0 to 1, in cell widths, with the nearest point's offset from (u, v)
/// and a hash naming its cell.
struct Cell {
    f1: f64,
    f2: f64,
    dx: f64,
    dy: f64,
    id: u32,
}

fn voronoi(u: f64, v: f64, cells: i64, seed: u32) -> Cell {
    let (x, y) = (u * cells as f64, v * cells as f64);
    let (cx, cy) = (x.floor() as i64, y.floor() as i64);
    let mut best = Cell {
        f1: f64::MAX,
        f2: f64::MAX,
        dx: 0.0,
        dy: 0.0,
        id: 0,
    };
    for j in -1..=1 {
        for i in -1..=1 {
            let (gx, gy) = (cx + i, cy + j);
            let (wx, wy) = (gx.rem_euclid(cells), gy.rem_euclid(cells));
            let id = hash(wx, wy, seed);
            let px = gx as f64 + 0.1 + 0.8 * unit(id);
            let py = gy as f64 + 0.1 + 0.8 * unit(hash(wx, wy, seed ^ 0x9e37_79b9));
            let (dx, dy) = (px - x, py - y);
            let d = (dx * dx + dy * dy).sqrt();
            if d < best.f1 {
                best.f2 = best.f1;
                best = Cell {
                    f1: d,
                    f2: best.f2,
                    dx,
                    dy,
                    id,
                };
            } else if d < best.f2 {
                best.f2 = d;
            }
        }
    }
    best
}

// ---------------------------------------------------------------------------
// The DNTS textures.

/// Height (any scale) and brightness (0 to 1, 0.5 leaves the map's colour as it
/// is) of `kind` at (u, v) in its tile, and how strongly the height bends the
/// normal.
fn surface(kind: Dnts, u: f64, v: f64) -> (f64, f64) {
    match kind {
        Dnts::Rock => {
            let wx = fbm(u, v, 4, 3, 11) - 0.5;
            let wy = fbm(u, v, 4, 3, 12) - 0.5;
            let c = voronoi(u + 0.12 * wx, v + 0.12 * wy, 6, 13);
            let crack = 1.0 - smoothstep(0.0, 0.07, c.f2 - c.f1);
            let grain = fbm(u, v, 8, 5, 14);
            // Eight bands down the tile, bent by the same warp as the cracks.
            let strata = 0.5 + 0.5 * (std::f64::consts::TAU * (v * 8.0 + 0.6 * wx)).sin();
            let h = 0.6 * grain + 0.25 * strata - 0.5 * crack;
            let b = 0.5 + 0.35 * (grain - 0.5) + 0.06 * (strata - 0.5) - 0.18 * crack;
            (h, b)
        }
        Dnts::Pebbles => {
            let dome = |cells, seed| {
                let c = voronoi(u, v, cells, seed);
                (smoothstep(0.0, 0.4, c.f2 - c.f1).sqrt(), unit(c.id))
            };
            let (big, tint) = dome(10, 21);
            let (small, _) = dome(23, 22);
            let h = big.max(0.55 * small) + 0.04 * fbm(u, v, 16, 3, 23);
            let b = 0.5 + 0.12 * (big - 0.6) + 0.14 * (tint - 0.5) * big;
            (h, b)
        }
        Dnts::Grass => {
            let mut blades = 0.0f64;
            for (cells, seed) in [(28, 31), (41, 32)] {
                let c = voronoi(u, v, cells, seed);
                let angle = unit(c.id) * std::f64::consts::PI;
                let (s, co) = angle.sin_cos();
                let along = c.dx * co + c.dy * s;
                let across = -c.dx * s + c.dy * co;
                let blade =
                    (1.0 - across.abs() / 0.09).max(0.0) * (1.0 - along.abs() / 0.5).max(0.0);
                blades = blades.max(blade);
            }
            let clump = fbm(u, v, 6, 3, 33);
            let h = 0.7 * blades + 0.3 * clump;
            let b = 0.47 + 0.14 * blades + 0.1 * (clump - 0.5);
            (h, b)
        }
        Dnts::Sand => {
            let warp = fbm(u, v, 3, 3, 41) - 0.5;
            let phase = (u * 14.0 + 1.6 * warp).rem_euclid(1.0);
            // Ripples are steeper on their lee side.
            let ripple = if phase < 0.7 {
                phase / 0.7
            } else {
                (1.0 - phase) / 0.3
            };
            let grain = fbm(u, v, 32, 2, 42);
            let h = 0.6 * ripple + 0.15 * grain;
            let b = 0.5 + 0.06 * (ripple - 0.5) + 0.08 * (grain - 0.5);
            (h, b)
        }
        Dnts::Snow => {
            let drift = fbm(u, v, 3, 4, 51);
            let crust = fbm(u, v, 16, 2, 52);
            (0.5 * drift + 0.08 * crust, 0.6 + 0.05 * (drift - 0.5))
        }
        Dnts::Shore => {
            let warp = fbm(u, v, 4, 3, 61) - 0.5;
            let ripple = 0.5 + 0.5 * (std::f64::consts::TAU * (v * 18.0 + 1.2 * warp)).sin();
            let c = voronoi(u, v, 16, 62);
            let stone = smoothstep(0.0, 0.3, c.f2 - c.f1).sqrt();
            let scatter = smoothstep(0.62, 0.72, fbm(u, v, 5, 2, 63));
            let h = 0.25 * ripple + 0.6 * stone * scatter + 0.1 * fbm(u, v, 24, 2, 64);
            let b = 0.44 + 0.05 * (ripple - 0.5) + 0.1 * stone * scatter;
            (h, b)
        }
    }
}

/// How far a unit of height across one pixel of a 512 tile bends the normal.
fn strength(kind: Dnts) -> f64 {
    match kind {
        Dnts::Rock => 9.0,
        Dnts::Pebbles => 10.0,
        Dnts::Grass => 6.0,
        Dnts::Sand => 4.0,
        Dnts::Snow => 9.0,
        Dnts::Shore => 5.0,
    }
}

/// A unit normal with z up, as a pixel. `nx` and `ny` are the tilt along the
/// image's columns and rows, which are world +x and +z.
fn encode(nx: f64, ny: f64, alpha: f64) -> Rgba<u8> {
    let len = (nx * nx + ny * ny + 1.0).sqrt();
    let q = |c: f64| ((c / len * 0.5 + 0.5) * 255.0).round().clamp(0.0, 255.0) as u8;
    Rgba([
        q(nx),
        q(ny),
        q(1.0),
        (alpha * 255.0).round().clamp(0.0, 255.0) as u8,
    ])
}

/// `kind` at `size` pixels a side. Rows run down the picture, which the engine
/// reads as world +z, so the green channel is the tilt toward +z.
pub fn dnts(kind: Dnts, size: u32) -> RgbaImage {
    let n = size as usize;
    let mut height = vec![0.0; n * n];
    let mut bright = vec![0.0; n * n];
    for y in 0..n {
        for x in 0..n {
            let (u, v) = ((x as f64 + 0.5) / n as f64, (y as f64 + 0.5) / n as f64);
            let (h, b) = surface(kind, u, v);
            height[y * n + x] = h;
            bright[y * n + x] = b;
        }
    }
    // Slopes are per tile so a smaller test tile has the same look.
    let k = strength(kind) * n as f64 / f64::from(DNTS_SIZE);
    RgbaImage::from_fn(size, size, |x, y| {
        let (x, y) = (x as usize, y as usize);
        let at = |x: usize, y: usize| height[(y % n) * n + (x % n)];
        let dx = (at(x + 1, y) - at(x + n - 1, y)) / 2.0;
        let dy = (at(x, y + 1) - at(x, y + n - 1)) / 2.0;
        encode(-k * dx, -k * dy, bright[y * n + x])
    })
}

/// The cached PNG for `kind` under `cache`, made first when it is not there.
fn cached_dnts(kind: Dnts, cache: &Path) -> Result<PathBuf, String> {
    let path = cache.join(format!("v{DNTS_VERSION}-{}-{DNTS_SIZE}.png", kind.name()));
    if path.is_file() {
        return Ok(path);
    }
    std::fs::create_dir_all(cache)
        .map_err(|e| format!("could not create {}: {e}", cache.display()))?;
    let tmp = path.with_extension("png.tmp");
    dnts(kind, DNTS_SIZE)
        .save_with_format(&tmp, image::ImageFormat::Png)
        .map_err(|e| format!("could not write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, &path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("could not write {}: {e}", path.display())
    })?;
    Ok(path)
}

// ---------------------------------------------------------------------------
// The distribution.

/// A heightmap in elmos, one value per vertex, `w` by `h` vertices.
pub struct Heights {
    pub w: usize,
    pub h: usize,
    pub elmos: Vec<f64>,
}

impl Heights {
    fn at(&self, x: isize, y: isize) -> f64 {
        let x = x.clamp(0, self.w as isize - 1) as usize;
        let y = y.clamp(0, self.h as isize - 1) as usize;
        self.elmos[y * self.w + x]
    }

    /// Bilinear height at (x, y) in squares.
    fn sample(&self, x: f64, y: f64) -> f64 {
        let (x0, y0) = (x.floor(), y.floor());
        let (fx, fy) = (x - x0, y - y0);
        let (x0, y0) = (x0 as isize, y0 as isize);
        let top = self.at(x0, y0) * (1.0 - fx) + self.at(x0 + 1, y0) * fx;
        let bottom = self.at(x0, y0 + 1) * (1.0 - fx) + self.at(x0 + 1, y0 + 1) * fx;
        top * (1.0 - fy) + bottom * fy
    }

    /// Steepness at (x, y) in squares, as rise over run.
    fn slope(&self, x: f64, y: f64) -> f64 {
        let gx = (self.sample(x + 0.5, y) - self.sample(x - 0.5, y)) / SQUARE;
        let gz = (self.sample(x, y + 0.5) - self.sample(x, y - 0.5)) / SQUARE;
        (gx * gx + gz * gz).sqrt()
    }
}

/// The heights of the compiled map at `smf_path`, in elmos.
fn read_heights(smf_path: &Path) -> Result<Heights, String> {
    let at = smf::locate_smf_heights(smf_path)?;
    let words = smf::read_smf_heights(smf_path, &at)?;
    let (lo, hi) = (f64::from(at.info.min_height), f64::from(at.info.max_height));
    let elmos = words
        .chunks_exact(2)
        .map(|w| lo + (hi - lo) * f64::from(u16::from_le_bytes([w[0], w[1]])) / 65535.0)
        .collect();
    Ok(Heights {
        w: at.info.mapx as usize + 1,
        h: at.info.mapy as usize + 1,
        elmos,
    })
}

/// Rock, pebbles, ground and shore at the centre of square (x, y), summing to 1.
fn weights(map: &Heights, x: f64, y: f64) -> [f64; 4] {
    let height = map.sample(x, y);
    let slope = map.slope(x, y);
    // A hollow sits below the ring of ground four squares around it.
    let r = 4.0;
    let ring =
        (map.sample(x - r, y) + map.sample(x + r, y) + map.sample(x, y - r) + map.sample(x, y + r))
            / 4.0;
    let hollow = smoothstep(2.0, 10.0, ring - height);
    let moderate = smoothstep(0.2, 0.4, slope) * (1.0 - smoothstep(0.55, 0.8, slope));
    let noise = fbm(x / 64.0, y / 64.0, 16, 3, 71);

    let rock = smoothstep(0.55, 0.9, slope);
    let pebbles = (hollow.max(moderate) * (0.3 + 1.1 * noise)).clamp(0.0, 1.0) * (1.0 - rock);
    // The water level is height 0, and the band ends 24 elmos above it.
    let shore = (1.0 - smoothstep(6.0, 24.0, height)) * (1.0 - rock);
    let ground = (1.0 - rock - pebbles - shore).max(0.0);
    let sum = rock + pebbles + ground + shore;
    [rock / sum, pebbles / sum, ground / sum, shore / sum]
}

/// Four weights as bytes summing to exactly 255, by largest remainder.
fn quantise(w: [f64; 4]) -> [u8; 4] {
    let scaled = w.map(|v| v * 255.0);
    let mut out = scaled.map(|v| v.floor() as u8);
    let short = 255 - out.iter().map(|&b| u32::from(b)).sum::<u32>();
    let mut order = [0, 1, 2, 3];
    order.sort_by(|&a, &b| {
        let (ra, rb) = (scaled[a] - scaled[a].floor(), scaled[b] - scaled[b].floor());
        rb.total_cmp(&ra)
    });
    for &i in order.iter().take(short as usize) {
        out[i] += 1;
    }
    out
}

/// One pixel per heightmap square. Red is rock, green pebbles, blue ground and
/// alpha shore.
pub fn distribution(map: &Heights) -> RgbaImage {
    let (w, h) = (map.w as u32 - 1, map.h as u32 - 1);
    RgbaImage::from_fn(w, h, |x, y| {
        Rgba(quantise(weights(
            map,
            f64::from(x) + 0.5,
            f64::from(y) + 0.5,
        )))
    })
}

// ---------------------------------------------------------------------------
// The detail normal map.

/// Pixels per heightmap square: 4 on maps up to 8 by 8 map units, 2 above,
/// where 4 would make a texture of 4096 pixels or more a side.
pub fn detail_density(map: &Heights) -> usize {
    if (map.w - 1).max(map.h - 1) <= 512 {
        4
    } else {
        2
    }
}

/// The detail normal map at `per` pixels a square, rows down the picture
/// running toward world +z, before the flip the DDS needs.
pub fn detail_normals(map: &Heights, dist: &RgbaImage, per: usize) -> RgbaImage {
    let (w, h) = ((map.w - 1) * per, (map.h - 1) * per);
    let step = SQUARE / per as f64; // elmos per pixel
                                    // Weight of channel `c` of the distribution at (x, y) in squares.
    let weight = |x: f64, y: f64, c: usize| {
        let px = (x - 0.5).floor().clamp(0.0, f64::from(dist.width() - 1)) as u32;
        let py = (y - 0.5).floor().clamp(0.0, f64::from(dist.height() - 1)) as u32;
        f64::from(dist.get_pixel(px, py)[c]) / 255.0
    };
    let mut bump = vec![0.0; w * h];
    let mut alpha = vec![0.0; w * h];
    for py in 0..h {
        for px in 0..w {
            let (x, y) = (
                (px as f64 + 0.5) / per as f64,
                (py as f64 + 0.5) / per as f64,
            );
            let (rock, ground) = (weight(x, y, 0), weight(x, y, 2));
            let height = map.sample(x, y);
            // Wobble over a few dozen squares, so bands bend rather than break up.
            let noise = fbm(x / 64.0, y / 64.0, 4, 3, 81);
            // Strata follow the contours: bands every 24 elmos of height.
            let strata = 1.5 * (std::f64::consts::TAU * height / 24.0 + 2.0 * noise).sin();
            // A faint ripple across the ground, 6 elmos apart.
            let (wx, wz) = (x * SQUARE, y * SQUARE);
            let ripple =
                0.15 * (std::f64::consts::TAU * (0.8 * wx + 0.6 * wz) / 6.0 + 3.0 * noise).sin();
            bump[py * w + px] = rock * strata + ground * ripple;
            alpha[py * w + px] = (0.8 * rock + 0.35 * ground).min(1.0);
        }
    }
    RgbaImage::from_fn(w as u32, h as u32, |x, y| {
        let (x, y) = (x as usize, y as usize);
        let at = |x: usize, y: usize| bump[y.min(h - 1) * w + x.min(w - 1)];
        let dx = (at(x + 1, y) - at(x.saturating_sub(1), y)) / (2.0 * step);
        let dz = (at(x, y + 1) - at(x, y.saturating_sub(1))) / (2.0 * step);
        encode(-dx, -dz, alpha[y * w + x])
    })
}

/// The next mip level: each pixel the mean of the up to four beneath it, with
/// the normal in RGB made unit length again.
fn half(img: &RgbaImage) -> RgbaImage {
    let (w, h) = ((img.width() / 2).max(1), (img.height() / 2).max(1));
    RgbaImage::from_fn(w, h, |x, y| {
        let mut sum = [0.0f64; 4];
        let mut n = 0.0;
        for (sx, sy) in [
            (2 * x, 2 * y),
            (2 * x + 1, 2 * y),
            (2 * x, 2 * y + 1),
            (2 * x + 1, 2 * y + 1),
        ] {
            if sx < img.width() && sy < img.height() {
                let p = img.get_pixel(sx, sy);
                for c in 0..4 {
                    sum[c] += f64::from(p[c]) / 255.0;
                }
                n += 1.0;
            }
        }
        let v = sum.map(|s| s / n);
        let (nx, ny, nz) = (v[0] * 2.0 - 1.0, v[1] * 2.0 - 1.0, v[2] * 2.0 - 1.0);
        if nz <= 1e-6 {
            return encode(0.0, 0.0, v[3]);
        }
        encode(nx / nz, ny / nz, v[3])
    })
}

/// Every level from `img` down to 1 by 1.
pub fn mip_chain(img: &RgbaImage) -> Vec<RgbaImage> {
    let mut levels = vec![img.clone()];
    while levels
        .last()
        .is_some_and(|l| l.width() > 1 || l.height() > 1)
    {
        let next = half(levels.last().unwrap());
        levels.push(next);
    }
    levels
}

/// An uncompressed BGRA DDS of `img` with every mip level down to 1 by 1.
///
/// Recoil uploads the levels a DDS carries without building the rest, and a
/// texture with a short chain samples black, so the chain is always complete.
/// It also flips a DDS top to bottom as it loads it, so each level's rows are
/// stored bottom first and the engine ends up with `img` the right way up.
pub fn dds(img: &RgbaImage) -> Vec<u8> {
    const CAPS: u32 = 0x1;
    const HEIGHT: u32 = 0x2;
    const WIDTH: u32 = 0x4;
    const PITCH: u32 = 0x8;
    const PIXELFORMAT: u32 = 0x1000;
    const MIPMAPCOUNT: u32 = 0x2_0000;
    const RGBA: u32 = 0x41; // DDPF_RGB | DDPF_ALPHAPIXELS
    const TEXTURE: u32 = 0x1000;
    const COMPLEX: u32 = 0x8;
    const MIPMAP: u32 = 0x40_0000;

    let levels = mip_chain(img);
    let mut header = [0u32; 31];
    header[0] = 124;
    header[1] = CAPS | HEIGHT | WIDTH | PITCH | PIXELFORMAT | MIPMAPCOUNT;
    header[2] = img.height();
    header[3] = img.width();
    header[4] = img.width() * 4;
    header[6] = levels.len() as u32;
    // Pixel format, at word 18.
    header[18] = 32;
    header[19] = RGBA;
    header[21] = 32;
    header[22] = 0x00ff_0000;
    header[23] = 0x0000_ff00;
    header[24] = 0x0000_00ff;
    header[25] = 0xff00_0000;
    header[26] = TEXTURE | COMPLEX | MIPMAP;

    let mut out = Vec::with_capacity(128 + img.as_raw().len() * 4 / 3 + 64);
    out.extend_from_slice(b"DDS ");
    for word in header {
        out.extend_from_slice(&word.to_le_bytes());
    }
    for level in &levels {
        for y in (0..level.height()).rev() {
            for x in 0..level.width() {
                let [r, g, b, a] = level.get_pixel(x, y).0;
                out.extend_from_slice(&[b, g, r, a]);
            }
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Writing it all into a map.

/// What [`write_splats`] wrote.
#[derive(Debug)]
pub struct SplatsWritten {
    pub files: Vec<PathBuf>,
    pub ground: Dnts,
    pub mapinfo_changed: bool,
}

/// The `resources` keys this step owns.
const OWNED_KEYS: [&str; 6] = [
    "splatDistrTex",
    "splatDetailNormalTex1",
    "splatDetailNormalTex2",
    "splatDetailNormalTex3",
    "splatDetailNormalTex4",
    "detailNormalTex",
];

/// A name this step writes, so a second run replaces its own files.
fn is_ours(name: &str) -> bool {
    let name = name.trim();
    name.is_empty()
        || name.eq_ignore_ascii_case(DISTRIBUTION)
        || name.eq_ignore_ascii_case(DETAIL_NORMALS)
        || Dnts::ALL
            .iter()
            .any(|k| name.eq_ignore_ascii_case(&k.file()))
}

/// The splat textures `src` already names that this step did not write, so a
/// map's own textures are never replaced.
fn foreign_splats(dir: &Path, src: &str) -> Result<Vec<String>, String> {
    let value = SpringLua::new(dir)
        .and_then(|lua| lua.eval_expr_value(&format!("(function()\n{src}\nend)()"), "mapinfo.lua"))
        .map_err(|e| format!("could not evaluate mapinfo.lua: {e}"))?;
    let field = |v: &serde_json::Value, name: &str| {
        v.as_object()?
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.clone())
    };
    let Some(res) = field(&value, "resources") else {
        return Ok(Vec::new());
    };
    let mut named = Vec::new();
    for key in OWNED_KEYS {
        if let Some(serde_json::Value::String(s)) = field(&res, key) {
            named.push(s);
        }
    }
    // The table form wins over the numbered keys in the engine.
    match field(&res, "splatDetailNormalTex") {
        Some(serde_json::Value::Array(list)) => {
            named.extend(
                list.into_iter()
                    .filter_map(|v| v.as_str().map(String::from)),
            );
        }
        Some(serde_json::Value::Object(map)) => {
            named.extend(
                map.into_values()
                    .filter_map(|v| v.as_str().map(String::from)),
            );
        }
        _ => {}
    }
    Ok(named.into_iter().filter(|n| !is_ours(n)).collect())
}

fn name_path(path: &[&str]) -> Vec<Key> {
    path.iter().map(|s| Key::Name((*s).into())).collect()
}

/// The `mapinfo.lua` entries naming the generated files.
pub fn splat_edits(ground: Dnts) -> Vec<(Vec<Key>, Val)> {
    let str = |s: String| Val::Str(s);
    let layers = [Dnts::Rock, Dnts::Pebbles, ground, Dnts::Shore];
    let mut out = vec![(
        name_path(&["resources", "splatDistrTex"]),
        str(DISTRIBUTION.into()),
    )];
    for (i, kind) in layers.iter().enumerate() {
        out.push((
            name_path(&["resources", &format!("splatDetailNormalTex{}", i + 1)]),
            str(kind.file()),
        ));
    }
    out.push((
        name_path(&["resources", "splatDetailNormalDiffuseAlpha"]),
        Val::Bool(true),
    ));
    out.push((
        name_path(&["resources", "detailNormalTex"]),
        str(DETAIL_NORMALS.into()),
    ));
    out.push((
        name_path(&["splats", "texScales"]),
        Val::Array(vec![TEX_SCALE; 4]),
    ));
    out.push((name_path(&["splats", "texMults"]), Val::Array(vec![1.0; 4])));
    out
}

/// Generate the splat detail for the map compiled as `<dir>/<suffix>.smf` and
/// name it in `<dir>/mapinfo.lua`. `texture` is the diffuse texture the ground
/// type is picked from, grass when there is none or it cannot be read. `cache`
/// holds the DNTS textures between runs.
pub fn write_splats(
    dir: &Path,
    suffix: &str,
    texture: Option<&Path>,
    cache: &Path,
) -> Result<SplatsWritten, String> {
    let suffix = suffix.trim();
    let info = dir.join("mapinfo.lua");
    let src = std::fs::read_to_string(&info).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => {
            format!("{} is not there. Write mapinfo.lua first.", info.display())
        }
        _ => format!("could not read {}: {e}", info.display()),
    })?;
    let foreign = foreign_splats(dir, &src)?;
    if !foreign.is_empty() {
        return Err(format!(
            "mapinfo.lua already names its own splat textures ({}), so nothing was written",
            foreign.join(", ")
        ));
    }
    let smf_path = dir.join(format!("{suffix}.smf"));
    if !smf_path.is_file() {
        return Err(format!(
            "{} is not there. Compile the map first.",
            smf_path.display()
        ));
    }
    let map = read_heights(&smf_path)?;
    let ground = texture
        .and_then(|t| mean_colour(t).ok())
        .map_or(Dnts::Grass, pick_ground);

    let mut after = src.clone();
    for (path, val) in splat_edits(ground) {
        after = apply(&after, &path, &val, Mode::Set)?;
    }

    let dist = distribution(&map);
    let normals = detail_normals(&map, &dist, detail_density(&map));
    let maps = dir.join("maps");
    std::fs::create_dir_all(&maps)
        .map_err(|e| format!("could not create {}: {e}", maps.display()))?;

    // Everything is written aside first, so a failure leaves the map as it was.
    let mut staged: Vec<(PathBuf, PathBuf)> = Vec::new();
    let stage = |name: &str,
                 staged: &mut Vec<(PathBuf, PathBuf)>,
                 write: &dyn Fn(&Path) -> Result<(), String>| {
        let to = maps.join(name);
        let tmp = maps.join(format!("{name}.tmp"));
        staged.push((tmp.clone(), to));
        write(&tmp)
    };
    let result = (|| {
        stage(DISTRIBUTION, &mut staged, &|p| {
            dist.save_with_format(p, image::ImageFormat::Png)
                .map_err(|e| format!("could not write {}: {e}", p.display()))
        })?;
        stage(DETAIL_NORMALS, &mut staged, &|p| {
            std::fs::write(p, dds(&normals))
                .map_err(|e| format!("could not write {}: {e}", p.display()))
        })?;
        for kind in [Dnts::Rock, Dnts::Pebbles, ground, Dnts::Shore] {
            let from = cached_dnts(kind, cache)?;
            stage(&kind.file(), &mut staged, &|p| {
                std::fs::copy(&from, p)
                    .map(|_| ())
                    .map_err(|e| format!("could not write {}: {e}", p.display()))
            })?;
        }
        if after != src {
            let tmp = dir.join("mapinfo.lua.tmp");
            std::fs::write(&tmp, &after)
                .map_err(|e| format!("could not write {}: {e}", tmp.display()))?;
            staged.push((tmp, info.clone()));
        }
        Ok::<(), String>(())
    })();
    if let Err(e) = result {
        for (tmp, _) in &staged {
            let _ = std::fs::remove_file(tmp);
        }
        return Err(e);
    }
    let mut files = Vec::new();
    for (tmp, to) in &staged {
        std::fs::rename(tmp, to).map_err(|e| format!("could not replace {}: {e}", to.display()))?;
        if to != &info {
            files.push(to.clone());
        }
    }
    Ok(SplatsWritten {
        files,
        ground,
        mapinfo_changed: after != src,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("coilbox-splat-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Mean absolute difference per channel between two columns (or rows).
    fn diff(img: &RgbaImage, a: (u32, u32), b: (u32, u32), along_x: bool) -> f64 {
        let n = if along_x { img.height() } else { img.width() };
        let mut total = 0.0;
        for i in 0..n {
            let (pa, pb) = if along_x {
                (img.get_pixel(a.0, i), img.get_pixel(b.0, i))
            } else {
                (img.get_pixel(i, a.1), img.get_pixel(i, b.1))
            };
            for c in 0..4 {
                total += (f64::from(pa[c]) - f64::from(pb[c])).abs();
            }
        }
        total / f64::from(n * 4)
    }

    #[test]
    fn every_detail_texture_tiles_without_a_seam() {
        for kind in Dnts::ALL {
            let img = dnts(kind, 64);
            let last = img.width() - 1;
            // Across the wrap, the step from the last column to the first is no
            // bigger than the steps between neighbours inside the tile.
            let inside: f64 = (0..last)
                .map(|x| diff(&img, (x, 0), (x + 1, 0), true))
                .sum::<f64>()
                / f64::from(last);
            let seam_x = diff(&img, (last, 0), (0, 0), true);
            let inside_y: f64 = (0..last)
                .map(|y| diff(&img, (0, y), (0, y + 1), false))
                .sum::<f64>()
                / f64::from(last);
            let seam_y = diff(&img, (0, last), (0, 0), false);
            assert!(
                seam_x <= inside * 1.6 + 1.0,
                "{kind:?} x seam {seam_x} vs {inside}"
            );
            assert!(
                seam_y <= inside_y * 1.6 + 1.0,
                "{kind:?} y seam {seam_y} vs {inside_y}"
            );
        }
    }

    #[test]
    fn the_surfaces_repeat_exactly_one_tile_on() {
        for kind in Dnts::ALL {
            for (u, v) in [(0.0, 0.3), (0.37, 0.0), (0.999, 0.5)] {
                let here = surface(kind, u, v);
                let there = surface(kind, u + 1.0, v + 1.0);
                assert!((here.0 - there.0).abs() < 1e-9, "{kind:?} at {u},{v}");
                assert!((here.1 - there.1).abs() < 1e-9, "{kind:?} at {u},{v}");
            }
        }
    }

    #[test]
    fn detail_textures_are_not_flat() {
        for kind in Dnts::ALL {
            let img = dnts(kind, 64);
            let reds: Vec<u8> = img.pixels().map(|p| p[0]).collect();
            let spread = reds.iter().max().unwrap() - reds.iter().min().unwrap();
            assert!(spread > 8, "{kind:?} red spread {spread}");
        }
    }

    /// A map `w` by `h` squares whose heights come from `f(x, y)` in squares.
    fn map(w: usize, h: usize, f: impl Fn(f64, f64) -> f64) -> Heights {
        let mut elmos = Vec::new();
        for y in 0..=h {
            for x in 0..=w {
                elmos.push(f(x as f64, y as f64));
            }
        }
        Heights {
            w: w + 1,
            h: h + 1,
            elmos,
        }
    }

    #[test]
    fn the_four_weights_always_sum_to_one() {
        // Hills, a cliff and a shoreline in one map.
        let m = map(64, 64, |x, y| {
            let cliff = if x > 40.0 { 300.0 } else { 0.0 };
            -40.0 + 2.0 * y + 30.0 * (x / 5.0).sin() + cliff
        });
        let img = distribution(&m);
        assert_eq!((img.width(), img.height()), (64, 64));
        for p in img.pixels() {
            let sum: u32 = p.0.iter().map(|&c| u32::from(c)).sum();
            assert_eq!(sum, 255, "{:?}", p.0);
        }
    }

    #[test]
    fn steep_ground_is_rock_low_ground_is_shore_and_flat_land_is_ground() {
        // A slope of 1 in 1 down the middle columns, flat land at 200 elmos and
        // flat land at 5 elmos.
        let m = map(64, 32, |x, _| match x {
            x if x < 20.0 => 200.0,
            x if x < 40.0 => 200.0 - (x - 20.0) * SQUARE,
            _ => 5.0,
        });
        let img = distribution(&m);
        let at = |x: u32| img.get_pixel(x, 16).0;
        assert!(at(30)[0] > 200, "slope {:?}", at(30));
        assert!(at(55)[3] > 200, "shore {:?}", at(55));
        assert!(at(8)[2] > 200, "plateau {:?}", at(8));
    }

    #[test]
    fn quantised_weights_sum_to_255() {
        for w in [
            [0.25; 4],
            [1.0 / 3.0, 1.0 / 3.0, 1.0 / 3.0, 0.0],
            [0.999, 0.001, 0.0, 0.0],
            [0.1, 0.2, 0.3, 0.4],
        ] {
            assert_eq!(
                quantise(w).iter().map(|&b| u32::from(b)).sum::<u32>(),
                255,
                "{w:?}"
            );
        }
    }

    #[test]
    fn the_ground_suits_the_diffuse_colour() {
        assert_eq!(pick_ground([0.3, 0.5, 0.2]), Dnts::Grass);
        assert_eq!(pick_ground([0.6, 0.5, 0.3]), Dnts::Sand);
        assert_eq!(pick_ground([0.85, 0.87, 0.9]), Dnts::Snow);
        assert_eq!(pick_ground([0.4, 0.4, 0.42]), Dnts::Sand);
    }

    /// The levels of a DDS this module wrote, read the way nv_dds reads them:
    /// each level's rows flipped top to bottom as it loads.
    fn load_like_the_engine(bytes: &[u8]) -> (u32, Vec<RgbaImage>) {
        let word = |i: usize| u32::from_le_bytes(bytes[4 + i * 4..8 + i * 4].try_into().unwrap());
        assert_eq!(&bytes[..4], b"DDS ");
        assert_eq!(
            word(19),
            0x41,
            "pixel format flags must be exactly RGB | ALPHAPIXELS"
        );
        assert_eq!(word(21), 32);
        let (mut h, mut w, count) = (word(2), word(3), word(6));
        let mut at = 128;
        let mut levels = Vec::new();
        for _ in 0..count {
            let len = (w * h * 4) as usize;
            let raw = &bytes[at..at + len];
            at += len;
            levels.push(RgbaImage::from_fn(w, h, |x, y| {
                let i = (((h - 1 - y) * w + x) * 4) as usize;
                Rgba([raw[i + 2], raw[i + 1], raw[i], raw[i + 3]])
            }));
            w = (w / 2).max(1);
            h = (h / 2).max(1);
        }
        assert_eq!(
            at,
            bytes.len(),
            "the file holds exactly the levels it declares"
        );
        (count, levels)
    }

    #[test]
    fn the_dds_mip_chain_reaches_one_by_one() {
        for (w, h) in [(64, 64), (96, 40), (1, 1)] {
            let img = RgbaImage::from_pixel(w, h, Rgba([128, 128, 255, 200]));
            let (count, levels) = load_like_the_engine(&dds(&img));
            let expected = 32 - w.max(h).leading_zeros();
            assert_eq!(count, expected, "{w}x{h}");
            let last = levels.last().unwrap();
            assert_eq!((last.width(), last.height()), (1, 1));
        }
    }

    #[test]
    fn the_engine_reads_the_dds_the_right_way_up() {
        // A picture whose top half has a different green from its bottom half.
        let img = RgbaImage::from_fn(8, 8, |_, y| {
            Rgba([128, if y < 4 { 200 } else { 50 }, 220, 255])
        });
        let bytes = dds(&img);
        // As stored, the first row is the picture's bottom row.
        assert_eq!(bytes[128 + 1], 50);
        let (_, levels) = load_like_the_engine(&bytes);
        assert_eq!(levels[0], img);
    }

    #[test]
    fn a_ramp_tilts_the_detail_normal_away_from_the_rise_after_the_engine_flips_it() {
        // Rock everywhere, height rising toward world +z (down the picture).
        let m = map(16, 16, |_, y| y * SQUARE * 1.2);
        let rock = RgbaImage::from_pixel(16, 16, Rgba([255, 0, 0, 0]));
        let img = detail_normals(&m, &rock, 2);
        let (_, levels) = load_like_the_engine(&dds(&img));
        assert_eq!(levels[0], img);
        // Strata are bands across the rise, so the tilt is all along z: red stays
        // level and green swings to both sides as the bands go up and down.
        let col: Vec<Rgba<u8>> = (0..img.height())
            .map(|y| *levels[0].get_pixel(10, y))
            .collect();
        let red = col.iter().map(|p| p[0].abs_diff(128)).max().unwrap();
        let green = col.iter().map(|p| p[1].abs_diff(128)).max().unwrap();
        assert!(red * 2 < green, "{col:?}");
        assert!(col.iter().any(|p| p[1] < 110) && col.iter().any(|p| p[1] > 146));
        assert!(col.iter().all(|p| p[3] > 190));
    }

    #[test]
    fn where_there_is_no_rock_or_ground_the_detail_normals_leave_the_terrain_alone() {
        let m = map(16, 16, |x, y| x * y);
        let pebbles = RgbaImage::from_pixel(16, 16, Rgba([0, 255, 0, 0]));
        let img = detail_normals(&m, &pebbles, 2);
        assert!(img.pixels().all(|p| p.0 == [128, 128, 255, 0]));
    }

    #[test]
    fn a_dnts_normal_leans_away_from_where_its_surface_rises() {
        // The DNTS PNGs are not flipped on load, so a rise down the picture is a
        // rise toward world +z, and the normal must lean the other way.
        let n = 64;
        let h = |x: usize, y: usize| {
            let wrap = |i: usize| (i % n) as f64 + 0.5;
            surface(Dnts::Pebbles, wrap(x) / n as f64, wrap(y) / n as f64).0
        };
        let img = dnts(Dnts::Pebbles, n as u32);
        let (mut down, mut right) = ((0, 0, 0.0f64), (0, 0, 0.0f64));
        for y in 0..n {
            for x in 0..n {
                let dy = h(x, y + 1) - h(x, y + n - 1);
                let dx = h(x + 1, y) - h(x + n - 1, y);
                if dy > down.2 {
                    down = (x, y, dy);
                }
                if dx > right.2 {
                    right = (x, y, dx);
                }
            }
        }
        assert!(img.get_pixel(down.0 as u32, down.1 as u32)[1] < 100);
        assert!(img.get_pixel(right.0 as u32, right.1 as u32)[0] < 100);
    }

    fn write_smf(dir: &Path, name: &str, squares: i32, f: impl Fn(usize, usize) -> u16) {
        // A minimal SMF: header, then the heightmap words, and nothing else.
        let mut b = vec![0u8; 80];
        b[..16].copy_from_slice(b"spring map file\0");
        b[16..20].copy_from_slice(&1i32.to_le_bytes());
        b[24..28].copy_from_slice(&squares.to_le_bytes());
        b[28..32].copy_from_slice(&squares.to_le_bytes());
        b[32..36].copy_from_slice(&8i32.to_le_bytes());
        b[36..40].copy_from_slice(&32i32.to_le_bytes());
        b[40..44].copy_from_slice(&32i32.to_le_bytes());
        b[44..48].copy_from_slice(&(-50.0f32).to_le_bytes());
        b[48..52].copy_from_slice(&(400.0f32).to_le_bytes());
        b[52..56].copy_from_slice(&80i32.to_le_bytes());
        let n = squares as usize + 1;
        for y in 0..n {
            for x in 0..n {
                b.extend_from_slice(&f(x, y).to_le_bytes());
            }
        }
        std::fs::write(dir.join(format!("{name}.smf")), b).unwrap();
    }

    fn eval(dir: &Path) -> serde_json::Value {
        let src = std::fs::read_to_string(dir.join("mapinfo.lua")).unwrap();
        SpringLua::new(dir)
            .unwrap()
            .eval_expr_value(&format!("(function()\n{src}\nend)()"), "mapinfo.lua")
            .unwrap()
    }

    #[test]
    fn the_mapinfo_entries_name_files_that_are_there() {
        let dir = temp_dir("write");
        let cache = dir.join("cache");
        write_smf(&dir, "mymap", 32, |x, _| (x * 2000) as u16);
        std::fs::write(dir.join("mapinfo.lua"), "return { name = \"x\" }").unwrap();
        let w = write_splats(&dir, "mymap", None, &cache).unwrap();
        assert!(w.mapinfo_changed);
        assert_eq!(w.ground, Dnts::Grass);
        let v = eval(&dir);
        let res = &v["resources"];
        assert_eq!(res["splatDistrTex"], DISTRIBUTION);
        assert_eq!(res["splatDetailNormalTex1"], "dnts_rock.png");
        assert_eq!(res["splatDetailNormalTex2"], "dnts_pebbles.png");
        assert_eq!(res["splatDetailNormalTex3"], "dnts_grass.png");
        assert_eq!(res["splatDetailNormalTex4"], "dnts_shore.png");
        assert_eq!(res["splatDetailNormalDiffuseAlpha"], true);
        assert_eq!(res["detailNormalTex"], DETAIL_NORMALS);
        assert_eq!(
            v["splats"]["texScales"],
            serde_json::json!([0.01, 0.01, 0.01, 0.01])
        );
        assert_eq!(v["splats"]["texMults"], serde_json::json!([1, 1, 1, 1]));
        // Each name resolves under maps/, where the engine looks for it.
        for key in OWNED_KEYS {
            let name = res[key].as_str().unwrap();
            assert!(dir.join("maps").join(name).is_file(), "{name}");
        }
        let dist = image::open(dir.join("maps").join(DISTRIBUTION)).unwrap();
        assert_eq!((dist.width(), dist.height()), (32, 32));
        let normals = std::fs::read(dir.join("maps").join(DETAIL_NORMALS)).unwrap();
        let (_, levels) = load_like_the_engine(&normals);
        assert_eq!((levels[0].width(), levels[0].height()), (128, 128));
        // A second run reuses the cache and leaves mapinfo.lua alone.
        assert!(
            !write_splats(&dir, "mymap", None, &cache)
                .unwrap()
                .mapinfo_changed
        );
        assert!(!dir.join("maps").read_dir().unwrap().any(|e| e
            .unwrap()
            .path()
            .extension()
            .is_some_and(|x| x == "tmp")));
    }

    #[test]
    fn a_map_with_its_own_splats_keeps_them() {
        let dir = temp_dir("own");
        write_smf(&dir, "mymap", 32, |_, _| 0);
        std::fs::write(
            dir.join("mapinfo.lua"),
            "return { resources = { splatDetailNormalTex = { \"mine.dds\", alpha = true } } }",
        )
        .unwrap();
        let err = write_splats(&dir, "mymap", None, &dir.join("cache")).unwrap_err();
        assert!(err.contains("mine.dds"), "{err}");
        assert!(!dir.join("maps").exists());
    }

    #[test]
    fn splats_need_a_mapinfo_and_a_compiled_map() {
        let dir = temp_dir("missing");
        let err = write_splats(&dir, "mymap", None, &dir.join("cache")).unwrap_err();
        assert!(err.contains("Write mapinfo.lua first"), "{err}");
        std::fs::write(dir.join("mapinfo.lua"), "return {}").unwrap();
        let err = write_splats(&dir, "mymap", None, &dir.join("cache")).unwrap_err();
        assert!(err.contains("Compile the map first"), "{err}");
    }
}
