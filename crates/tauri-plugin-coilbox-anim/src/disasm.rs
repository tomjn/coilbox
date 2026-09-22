//! COB disassembler. A clean reimplementation of `cob_decompiler.py`'s walk: a
//! word that matches a known opcode starts a new instruction; the words after it
//! (until the next opcode) are its operands. This is a disassembly listing, not
//! recompilable BOS — operand semantics (signed vs piece index vs offset) aren't
//! recovered, matching the reference oracle's limitation.

use crate::cob;
use crate::opcodes::mnemonic;
use std::fmt::Write;

/// A disassembly listing, plus which offset into the whole code stream each of
/// its lines is about.
///
/// The offset a line prints (`{:04}`) is local to the script it is inside, the
/// same as the reference oracle's, and stays that way for anyone already
/// reading it. `line_offsets` carries the offset a caller actually needs: one
/// into the same stream a `JUMP` targets and a run's coverage is reported
/// against, so the two can be matched up without reparsing the text.
pub struct Disassembly {
    pub text: String,
    /// One entry per line of `text`, in order. `None` for a line that is not
    /// one instruction: the header, a script's own name, or a blank line.
    pub line_offsets: Vec<Option<u32>>,
}

pub fn disassemble(buf: &[u8]) -> Result<Disassembly, String> {
    let decoded = cob::decode(buf)?;
    let h = &decoded.header;

    let mut out = String::new();
    let mut line_offsets: Vec<Option<u32>> = Vec::new();

    let _ = writeln!(
        out,
        "; COB v{}  ·  {} script(s)  ·  {} piece(s)  ·  {} static var(s)  ·  {} code words",
        h.version, h.num_scripts, h.num_pieces, h.num_static_vars, h.total_script_len
    );
    line_offsets.push(None);
    if !decoded.pieces.is_empty() {
        let _ = writeln!(out, "; pieces: {}", decoded.pieces.join(", "));
        line_offsets.push(None);
    }

    for (script_index, (name, code)) in decoded.scripts.iter().enumerate() {
        // A blank line then the header, same bytes as the old `"\n=== {name} ==="`
        // in one `writeln!`, but as two lines so each gets its own entry.
        let _ = writeln!(out);
        line_offsets.push(None);
        let _ = writeln!(out, "=== {name} ===");
        line_offsets.push(None);

        let start = decoded.offsets[script_index] as u32;
        let mut i = 0usize;
        while i < code.len() {
            let word = code[i];
            match mnemonic(word) {
                Some(op) => {
                    // Gather operands up to the next opcode boundary.
                    let mut operands = Vec::new();
                    let mut j = i + 1;
                    while j < code.len() && mnemonic(code[j]).is_none() {
                        operands.push(code[j].to_string());
                        j += 1;
                    }
                    let _ = writeln!(
                        out,
                        "{:04}  {}{}{}",
                        i,
                        op,
                        if operands.is_empty() { "" } else { " " },
                        operands.join(", ")
                    );
                    line_offsets.push(Some(start + i as u32));
                    i = j;
                }
                None => {
                    // A leading non-opcode word (shouldn't happen in valid code).
                    let _ = writeln!(out, "{i:04}  .word {word}");
                    line_offsets.push(Some(start + i as u32));
                    i += 1;
                }
            }
        }
    }
    Ok(Disassembly {
        text: out,
        line_offsets,
    })
}
