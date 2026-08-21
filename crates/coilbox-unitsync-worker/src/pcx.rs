//! PCX decoding, which no Rust image crate we depend on provides.
//!
//! The engine reads build pics through DevIL, so `unitpics/<unit>.pcx` is a
//! format it draws and coilbox could not (issue: missing build icons in games
//! like Expand and Exterminate, which ships 319 of them).
//!
//! PCX is a 128-byte header followed by byte-level RLE scanlines, one run of
//! bytes per colour plane per row. Colour comes out of it three ways: direct
//! from the planes at 8 bits (24-bit RGB and 32-bit RGBA), from the 256-colour
//! palette stored after the pixels, or from the 16-colour palette in the header
//! for the planar EGA depths.

/// PCX holds small legacy pictures. Refuse a header claiming more than this
/// rather than allocating gigabytes because a byte in it is wrong.
const MAX_PIXELS: usize = 4096 * 4096;
const MAX_SCANLINE_BYTES: usize = 64 * 1024 * 1024;

const HEADER_LEN: usize = 128;
const VGA_PALETTE_LEN: usize = 768;
/// Byte that introduces the 256-colour palette at the end of the file.
const VGA_PALETTE_MARKER: u8 = 0x0c;

/// Decode PCX bytes into RGBA8, or `None` if they are not a PCX this can read.
///
/// Alpha is opaque unless the file stores a fourth 8-bit plane, which is what
/// PCX's rare RGBA form is.
pub fn decode(bytes: &[u8]) -> Option<image::RgbaImage> {
    let header = Header::parse(bytes)?;
    let scanlines = scanline_bytes(&bytes[HEADER_LEN..], header.encoding, header.total())?;
    let palette = (header.depth() == 8).then(|| vga_palette(bytes)).flatten();
    header.to_rgba(&scanlines, palette)
}

/// The fields of the 128-byte header this decoder reads. The rest of it is
/// screen geometry and DPI, which say nothing about the pixels.
struct Header {
    /// 1 for RLE, 0 for pixels stored straight.
    encoding: u8,
    /// Bits per pixel *per plane*: 1, 2, 4 or 8.
    bits: u32,
    /// Colour planes: 1 (paletted), 3 (RGB) or 4 (RGBA, or planar EGA at 1 bit).
    planes: usize,
    width: u32,
    height: u32,
    /// Bytes one plane occupies per row, which may pad past the width.
    stride: usize,
    /// The header's own 16-colour palette, used at the EGA depths.
    ega: [u8; 48],
}

impl Header {
    fn parse(bytes: &[u8]) -> Option<Header> {
        if bytes.len() < HEADER_LEN || bytes[0] != 0x0a {
            return None;
        }
        let at = |i: usize| u32::from(u16::from_le_bytes([bytes[i], bytes[i + 1]]));
        let (xmin, ymin, xmax, ymax) = (at(4), at(6), at(8), at(10));
        if xmax < xmin || ymax < ymin {
            return None;
        }
        let mut ega = [0u8; 48];
        ega.copy_from_slice(&bytes[16..64]);
        let header = Header {
            encoding: bytes[2],
            bits: u32::from(bytes[3]),
            planes: usize::from(bytes[65]),
            width: xmax - xmin + 1,
            height: ymax - ymin + 1,
            stride: at(66) as usize,
            ega,
        };
        if !matches!(header.encoding, 0 | 1)
            || !matches!(header.bits, 1 | 2 | 4 | 8)
            || !matches!(header.planes, 1 | 3 | 4)
        {
            return None;
        }
        // A stride that does not even cover the row means the header is wrong
        // about something, and every read below trusts it.
        if header.stride < (header.width as usize * header.bits as usize).div_ceil(8) {
            return None;
        }
        let pixels = (header.width as usize).checked_mul(header.height as usize)?;
        if pixels > MAX_PIXELS || header.total() > MAX_SCANLINE_BYTES {
            return None;
        }
        Some(header)
    }

    /// Bits making up one pixel across all planes, which is what the palette
    /// index is wide and how many colours the file can hold.
    fn depth(&self) -> u32 {
        self.bits * self.planes as u32
    }

    /// Bytes of scanline data the whole image occupies once expanded.
    fn total(&self) -> usize {
        self.stride * self.planes * self.height as usize
    }

    /// Turn expanded scanlines into pixels, reading `x` out of each plane in turn.
    fn to_rgba(&self, scanlines: &[u8], palette: Option<&[u8]>) -> Option<image::RgbaImage> {
        let row_len = self.stride * self.planes;
        let mut out = Vec::with_capacity(self.width as usize * self.height as usize * 4);
        for row in scanlines.chunks_exact(row_len).take(self.height as usize) {
            for x in 0..self.width as usize {
                out.extend_from_slice(&self.pixel(row, x, palette));
            }
        }
        image::RgbaImage::from_raw(self.width, self.height, out)
    }

    /// One pixel: the planes are the channels at 8 bits, and are the bits of a
    /// palette index at every narrower depth.
    fn pixel(&self, row: &[u8], x: usize, palette: Option<&[u8]>) -> [u8; 4] {
        let plane = |p: usize| &row[p * self.stride..(p + 1) * self.stride];
        if self.bits == 8 && self.planes >= 3 {
            return [
                plane(0)[x],
                plane(1)[x],
                plane(2)[x],
                if self.planes == 4 { plane(3)[x] } else { 255 },
            ];
        }
        let index = (0..self.planes).fold(0usize, |acc, p| {
            acc | bits_at(plane(p), x, self.bits) << (p as u32 * self.bits)
        });
        self.colour(index, palette)
    }

    /// The colour a palette index means: the 256-colour palette if the file
    /// carries one, else the header's 16 colours, else a grey ramp.
    ///
    /// A single 1-bit plane skips both palettes and comes out black and white.
    /// That is what DevIL does, and DevIL is how the engine reads these, so a
    /// mono build pic drawn from the header palette instead could disagree with
    /// the game about its own artwork.
    ///
    /// The ramp is also the answer for a file whose header palette was left
    /// blank, which encoders do. Without it such a picture is a black rectangle.
    fn colour(&self, index: usize, palette: Option<&[u8]>) -> [u8; 4] {
        if let Some(rgb) = palette
            .filter(|p| p.len() >= (index + 1) * 3)
            .map(|p| &p[index * 3..index * 3 + 3])
        {
            return [rgb[0], rgb[1], rgb[2], 255];
        }
        if self.depth() > 1 && index < 16 && self.ega.iter().any(|b| *b != 0) {
            let rgb = &self.ega[index * 3..index * 3 + 3];
            return [rgb[0], rgb[1], rgb[2], 255];
        }
        let full = (1u32 << self.depth()) - 1;
        let grey = (index as u32 * 255 / full) as u8;
        [grey, grey, grey, 255]
    }
}

/// Expand `total` bytes of pixel data.
///
/// A byte with its top two bits set is a run: the low six bits are the count and
/// the next byte is the value. Anything else is one literal byte. `encoding` 0
/// means the file skipped all that and stored the bytes straight.
fn scanline_bytes(data: &[u8], encoding: u8, total: usize) -> Option<Vec<u8>> {
    if encoding == 0 {
        return (data.len() >= total).then(|| data[..total].to_vec());
    }
    let mut out = Vec::with_capacity(total);
    let mut it = data.iter().copied();
    while out.len() < total {
        let byte = it.next()?;
        if byte & 0xc0 == 0xc0 {
            let value = it.next()?;
            // The last run of a file can encode padding past the final row, so
            // keep only as much of it as the image asked for.
            let count = usize::from(byte & 0x3f).min(total - out.len());
            out.extend(std::iter::repeat_n(value, count));
        } else {
            out.push(byte);
        }
    }
    Some(out)
}

/// The 256-colour palette a version 5 PCX writes after the pixels: a `0x0c`
/// marker then 768 RGB bytes, at the very end of the file.
fn vga_palette(bytes: &[u8]) -> Option<&[u8]> {
    let marker = bytes.len().checked_sub(VGA_PALETTE_LEN + 1)?;
    (marker >= HEADER_LEN && bytes[marker] == VGA_PALETTE_MARKER).then(|| &bytes[marker + 1..])
}

/// Read pixel `x`'s value out of one plane's row. Sub-byte pixels are packed
/// high bits first, so a 4-bit image's first pixel is the leading nibble.
fn bits_at(plane: &[u8], x: usize, bits: u32) -> usize {
    if bits == 8 {
        return usize::from(plane[x]);
    }
    let per_byte = 8 / bits as usize;
    let shift = 8 - bits * (x % per_byte + 1) as u32;
    usize::from(plane[x / per_byte] >> shift) & ((1 << bits) - 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a PCX the way an encoder would: the header, the RLE-packed planes,
    /// then the 256-colour palette when there is one.
    ///
    /// `rows` is the raw plane data, `stride * planes * height` bytes, laid out
    /// plane after plane within each row.
    fn pcx(
        bits: u8,
        planes: u8,
        (w, h): (u16, u16),
        stride: u16,
        ega: &[u8],
        rows: &[u8],
        vga: Option<&[u8]>,
    ) -> Vec<u8> {
        let mut out = vec![0u8; HEADER_LEN];
        out[0] = 0x0a;
        out[1] = 5;
        out[2] = 1; // RLE
        out[3] = bits;
        out[8..10].copy_from_slice(&(w - 1).to_le_bytes());
        out[10..12].copy_from_slice(&(h - 1).to_le_bytes());
        out[16..16 + ega.len()].copy_from_slice(ega);
        out[65] = planes;
        out[66..68].copy_from_slice(&stride.to_le_bytes());
        out.extend(rle(rows));
        if let Some(vga) = vga {
            out.push(VGA_PALETTE_MARKER);
            out.extend_from_slice(vga);
        }
        out
    }

    /// RLE-pack bytes. A literal at or above 0xc0 would read back as a run, so
    /// it has to go out as a one-long run instead.
    fn rle(data: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        let mut i = 0;
        while i < data.len() {
            let byte = data[i];
            let mut run = 1;
            while i + run < data.len() && data[i + run] == byte && run < 63 {
                run += 1;
            }
            if run > 1 || byte >= 0xc0 {
                out.push(0xc0 | run as u8);
            }
            out.push(byte);
            i += run;
        }
        out
    }

    /// What every Expand and Exterminate build pic is: three 8-bit planes, one
    /// per channel, a row at a time.
    #[test]
    fn decodes_planar_24_bit_pixels() {
        let rows = [
            0xff, 0x00, // red
            0x00, 0x80, // green
            0x00, 0x40, // blue
        ];
        let img = decode(&pcx(8, 3, (2, 1), 2, &[], &rows, None)).expect("24-bit pcx decodes");
        assert_eq!((img.width(), img.height()), (2, 1));
        assert_eq!(img.get_pixel(0, 0).0, [0xff, 0x00, 0x00, 255]);
        assert_eq!(img.get_pixel(1, 0).0, [0x00, 0x80, 0x40, 255]);
    }

    /// A fourth 8-bit plane is alpha, so a build pic that stores one keeps its
    /// transparent background instead of coming out on a black square.
    #[test]
    fn a_fourth_plane_is_alpha() {
        let rows = [0x10, 0x20, 0x30, 0x00];
        let img = decode(&pcx(8, 4, (1, 1), 1, &[], &rows, None)).expect("32-bit pcx decodes");
        assert_eq!(img.get_pixel(0, 0).0, [0x10, 0x20, 0x30, 0x00]);
    }

    /// The common flavour: one 8-bit plane of indices into the palette written
    /// after the pixels.
    #[test]
    fn decodes_8_bit_indices_through_the_trailing_palette() {
        let mut vga = vec![0u8; VGA_PALETTE_LEN];
        vga[3..6].copy_from_slice(&[1, 2, 3]);
        vga[255 * 3..255 * 3 + 3].copy_from_slice(&[9, 8, 7]);
        let img = decode(&pcx(8, 1, (2, 1), 2, &[], &[1, 255], Some(&vga)))
            .expect("paletted pcx decodes");
        assert_eq!(img.get_pixel(0, 0).0, [1, 2, 3, 255]);
        assert_eq!(img.get_pixel(1, 0).0, [9, 8, 7, 255]);
    }

    /// Planar EGA: four 1-bit planes whose bits make up a 16-colour index, low
    /// plane first, read out of the header's own palette.
    #[test]
    fn decodes_four_1_bit_planes_through_the_header_palette() {
        let mut ega = vec![0u8; 48];
        ega[5 * 3..5 * 3 + 3].copy_from_slice(&[70, 80, 90]);
        // Pixel 0 sets planes 0 and 2, so its index is 0b0101.
        let rows = [0x80, 0x00, 0x80, 0x00];
        let img = decode(&pcx(1, 4, (1, 1), 1, &ega, &rows, None)).expect("ega pcx decodes");
        assert_eq!(img.get_pixel(0, 0).0, [70, 80, 90, 255]);
    }

    /// 4-bit pixels pack two to a byte, leading nibble first.
    #[test]
    fn reads_sub_byte_pixels_high_bits_first() {
        let mut ega = vec![0u8; 48];
        ega[3..6].copy_from_slice(&[11, 22, 33]);
        ega[2 * 3..2 * 3 + 3].copy_from_slice(&[44, 55, 66]);
        let img = decode(&pcx(4, 1, (2, 1), 1, &ega, &[0x12], None)).expect("4-bit pcx decodes");
        assert_eq!(img.get_pixel(0, 0).0, [11, 22, 33, 255]);
        assert_eq!(img.get_pixel(1, 0).0, [44, 55, 66, 255]);
    }

    /// A single 1-bit plane is black and white whatever the header palette says,
    /// which is what DevIL gives the engine. Encoders leave that palette blank on
    /// monochrome files anyway, and reading it literally would make every such
    /// picture a black rectangle.
    #[test]
    fn one_1_bit_plane_is_black_and_white() {
        let img = decode(&pcx(1, 1, (2, 1), 1, &[], &[0x40], None)).expect("mono pcx decodes");
        assert_eq!(img.get_pixel(0, 0).0, [0, 0, 0, 255]);
        assert_eq!(img.get_pixel(1, 0).0, [255, 255, 255, 255]);

        // The same file with red and green as its two colours still decodes to
        // black and white, because that is what the game will draw.
        let mut ega = vec![0u8; 48];
        ega[0..6].copy_from_slice(&[255, 0, 0, 0, 255, 0]);
        let img = decode(&pcx(1, 1, (2, 1), 1, &ega, &[0x40], None)).expect("mono pcx decodes");
        assert_eq!(img.get_pixel(0, 0).0, [0, 0, 0, 255]);
        assert_eq!(img.get_pixel(1, 0).0, [255, 255, 255, 255]);
    }

    /// A row is padded out to an even stride, and those bytes are not pixels.
    #[test]
    fn ignores_stride_padding_past_the_width() {
        let rows = [1, 2, 0xee, 3, 4, 0xee];
        let img = decode(&pcx(8, 1, (2, 2), 3, &[], &rows, None)).expect("padded pcx decodes");
        assert_eq!((img.width(), img.height()), (2, 2));
        assert_eq!(img.get_pixel(0, 0).0[0], 1);
        assert_eq!(img.get_pixel(0, 1).0[0], 3);
    }

    /// A run is a count byte and one value, and covers up to 63 pixels.
    #[test]
    fn expands_runs_up_to_63_long() {
        let rows = vec![0x77; 63];
        let raw = pcx(8, 1, (63, 1), 63, &[], &rows, None);
        // The whole row is one run, so the pixel data is exactly two bytes.
        assert_eq!(raw.len(), HEADER_LEN + 2);
        let img = decode(&raw).expect("run decodes");
        assert!((0..63).all(|x| img.get_pixel(x, 0).0[0] == 0x77));
    }

    /// Pixels stored without RLE at all.
    #[test]
    fn decodes_an_uncompressed_file() {
        let mut raw = pcx(8, 1, (2, 1), 2, &[], &[0, 0], None);
        raw[2] = 0; // encoding: none
        raw.truncate(HEADER_LEN);
        raw.extend_from_slice(&[0x11, 0x22]);
        let img = decode(&raw).expect("uncompressed pcx decodes");
        assert_eq!(img.get_pixel(0, 0).0[0], 0x11);
        assert_eq!(img.get_pixel(1, 0).0[0], 0x22);
    }

    #[test]
    fn refuses_bytes_that_are_not_pcx() {
        assert!(decode(&[0; 200]).is_none());
        assert!(decode(b"not a pcx at all").is_none());
    }

    /// Pixel data that stops early is refused rather than half-drawn.
    #[test]
    fn refuses_a_truncated_file() {
        let mut raw = pcx(8, 3, (16, 16), 16, &[], &[0x40; 16 * 3 * 16], None);
        raw.truncate(HEADER_LEN + 4);
        assert!(decode(&raw).is_none());
    }

    /// A header claiming a picture nothing could hold is refused before any of
    /// it is allocated.
    #[test]
    fn refuses_an_impossible_size() {
        let mut raw = pcx(8, 4, (2, 2), 2, &[], &[0; 16], None);
        raw[8..10].copy_from_slice(&u16::MAX.to_le_bytes());
        raw[10..12].copy_from_slice(&u16::MAX.to_le_bytes());
        raw[66..68].copy_from_slice(&u16::MAX.to_le_bytes());
        assert!(decode(&raw).is_none());
    }

    /// A stride too narrow for the row means a header we cannot trust.
    #[test]
    fn refuses_a_stride_that_does_not_cover_the_row() {
        let mut raw = pcx(8, 1, (8, 1), 8, &[], &[0; 8], None);
        raw[66..68].copy_from_slice(&2u16.to_le_bytes());
        assert!(decode(&raw).is_none());
    }

    /// Depths and plane counts PCX never had.
    #[test]
    fn refuses_depths_pcx_does_not_have() {
        for (bits, planes) in [(16u8, 1u8), (8, 2), (8, 5), (3, 1)] {
            let raw = pcx(bits, planes, (2, 1), 2, &[], &[0; 16], None);
            assert!(
                decode(&raw).is_none(),
                "{bits}bpp x{planes} should not decode"
            );
        }
    }
}
