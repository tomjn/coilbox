//! COB container read side (`decode`) plus the compile-side writer (`encode`).
//! The 11-field little-endian header and section layout mirror `cob_file.py`.

use std::collections::HashMap;

/// The 11 `u32` header fields, in `COB_HEADER_FIELDS` order.
// `unknown2`/`off_names` are parsed for completeness; read by the writer/round-trip.
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct CobHeader {
    pub version: u32,
    pub num_scripts: u32,
    pub num_pieces: u32,
    pub total_script_len: u32,
    pub num_static_vars: u32,
    pub unknown2: u32,
    pub off_script_code_index: u32,
    pub off_script_name_offset: u32,
    pub off_piece_name_offset: u32,
    pub off_script_code: u32,
    pub off_names: u32,
}

pub const HEADER_WORDS: usize = 11;

fn read_u32(buf: &[u8], pos: usize) -> Result<u32, String> {
    buf.get(pos..pos + 4)
        .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .ok_or_else(|| format!("truncated COB: no u32 at offset {pos}"))
}

/// Read a NUL-terminated UTF-8 (lossy) string starting at `pos`.
fn read_cstr(buf: &[u8], pos: usize) -> String {
    let end = buf[pos.min(buf.len())..]
        .iter()
        .position(|&b| b == 0)
        .map(|n| pos + n)
        .unwrap_or(buf.len());
    String::from_utf8_lossy(&buf[pos.min(buf.len())..end]).into_owned()
}

impl CobHeader {
    pub fn parse(buf: &[u8]) -> Result<CobHeader, String> {
        if buf.len() < HEADER_WORDS * 4 {
            return Err("not a COB file: shorter than the 44-byte header".into());
        }
        let w = |i: usize| read_u32(buf, i * 4);
        Ok(CobHeader {
            version: w(0)?,
            num_scripts: w(1)?,
            num_pieces: w(2)?,
            total_script_len: w(3)?,
            num_static_vars: w(4)?,
            unknown2: w(5)?,
            off_script_code_index: w(6)?,
            off_script_name_offset: w(7)?,
            off_piece_name_offset: w(8)?,
            off_script_code: w(9)?,
            off_names: w(10)?,
        })
    }
}

/// A COB decoded into its scripts (name + code words) and piece names — enough
/// for the disassembler.
pub struct DecodedCob {
    pub header: CobHeader,
    pub pieces: Vec<String>,
    /// `(script_name, code_words)` per script.
    pub scripts: Vec<(String, Vec<u32>)>,
}

pub fn decode(buf: &[u8]) -> Result<DecodedCob, String> {
    let header = CobHeader::parse(buf)?;

    let names_at = |offset_array: u32, count: u32| -> Result<Vec<String>, String> {
        (0..count)
            .map(|i| {
                let name_off = read_u32(buf, offset_array as usize + 4 * i as usize)?;
                Ok(read_cstr(buf, name_off as usize))
            })
            .collect()
    };

    let pieces = names_at(header.off_piece_name_offset, header.num_pieces)?;
    let script_names = names_at(header.off_script_name_offset, header.num_scripts)?;

    // Whole script-code stream as words, starting at off_script_code (== 44).
    let code: Vec<u32> = (0..header.total_script_len as usize)
        .map(|i| read_u32(buf, header.off_script_code as usize + 4 * i))
        .collect::<Result<_, _>>()?;

    let starts: Vec<usize> = (0..header.num_scripts as usize)
        .map(|i| read_u32(buf, header.off_script_code_index as usize + 4 * i).map(|v| v as usize))
        .collect::<Result<_, _>>()?;

    let scripts = script_names
        .into_iter()
        .enumerate()
        .map(|(i, name)| {
            let start = starts[i];
            let end = starts.get(i + 1).copied().unwrap_or(code.len());
            (
                name,
                code[start.min(code.len())..end.min(code.len())].to_vec(),
            )
        })
        .collect();

    Ok(DecodedCob {
        header,
        pieces,
        scripts,
    })
}

/// Serialize a compiled program to COB bytes — a port of `cob_file.COB`
/// (cob_file.py L23-97). Layout: `[header 44B][all fn code, in function_names
/// order][code-offset array][script-name-offset array][piece-name-offset array]
/// [fn name strings NUL-term][piece name strings NUL-term]`. All `<L` LE.
pub fn encode(
    function_names: &[String],
    functions_code: &HashMap<String, Vec<u8>>,
    piece_names: &[String],
    static_vars: &[String],
    cob_version: u32,
) -> Vec<u8> {
    let total_script_len: u32 = functions_code.values().map(|c| c.len() as u32 / 4).sum();

    let mut content: Vec<u8> = Vec::new();
    let mut offset: u32 = HEADER_WORDS as u32 * 4; // 44

    let off_script_code = offset;

    // Function code, concatenated in declared order, with per-script word offsets.
    let mut code_offsets: Vec<u32> = Vec::new();
    let mut code_offset: u32 = 0;
    for name in function_names {
        let code = &functions_code[name];
        content.extend_from_slice(code);
        code_offsets.push(code_offset);
        code_offset += code.len() as u32 / 4;
        offset += code.len() as u32;
    }

    let off_script_code_index = offset;
    for v in &code_offsets {
        content.extend_from_slice(&v.to_le_bytes());
    }
    offset += code_offsets.len() as u32 * 4;

    // Reserve space for the two name-offset arrays (written below).
    let off_script_name_offset = offset;
    offset += function_names.len() as u32 * 4;
    let off_piece_name_offset = offset;
    offset += piece_names.len() as u32 * 4;

    let off_names = offset;

    // Name strings (NUL-terminated) and their absolute byte offsets.
    let write_strings = |names: &[String], start: u32| -> (Vec<u32>, Vec<u8>) {
        let mut offsets = Vec::new();
        let mut bytes = Vec::new();
        let mut o = start;
        for s in names {
            offsets.push(o);
            bytes.extend_from_slice(s.as_bytes());
            bytes.push(0);
            o += s.len() as u32 + 1;
        }
        (offsets, bytes)
    };
    let (script_name_offsets, script_name_content) = write_strings(function_names, off_names);
    let strings_after_scripts = off_names + script_name_content.len() as u32;
    let (piece_name_offsets, piece_name_content) =
        write_strings(piece_names, strings_after_scripts);

    // Append the two name-offset arrays (right after the code-offset array).
    for v in &script_name_offsets {
        content.extend_from_slice(&v.to_le_bytes());
    }
    for v in &piece_name_offsets {
        content.extend_from_slice(&v.to_le_bytes());
    }

    // Prepend the header, then append the name strings.
    let header: [u32; HEADER_WORDS] = [
        cob_version,
        function_names.len() as u32,
        piece_names.len() as u32,
        total_script_len,
        static_vars.len() as u32,
        0, // Unknown_2
        off_script_code_index,
        off_script_name_offset,
        off_piece_name_offset,
        off_script_code,
        off_names,
    ];
    let mut out: Vec<u8> = Vec::with_capacity(44 + content.len());
    for v in header {
        out.extend_from_slice(&v.to_le_bytes());
    }
    out.extend_from_slice(&content);
    out.extend_from_slice(&script_name_content);
    out.extend_from_slice(&piece_name_content);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_like_reference_cob_file() {
        let mut code = HashMap::new();
        code.insert("Create".to_string(), (4u8..12).collect::<Vec<u8>>());
        code.insert("Killed".to_string(), vec![0xAA, 0xBB, 0xCC, 0xDD]);
        let out = encode(
            &["Create".to_string(), "Killed".to_string()],
            &code,
            &["base".to_string(), "turret".to_string()],
            &["foo".to_string()],
            4,
        );
        let expected = "0400000002000000020000000300000001000000000000003800000040000000480000002c000000500000000405060708090a0baabbccdd000000000200000050000000570000005e00000063000000437265617465004b696c6c656400626173650074757272657400";
        assert_eq!(hex::encode(&out), expected);
    }

    // Minimal local hex encoder to avoid a dependency in tests.
    mod hex {
        pub fn encode(bytes: &[u8]) -> String {
            let mut s = String::with_capacity(bytes.len() * 2);
            for b in bytes {
                s.push_str(&format!("{b:02x}"));
            }
            s
        }
    }
}
