//! COB disassembler. A clean reimplementation of `cob_decompiler.py`'s walk: a
//! word that matches a known opcode starts a new instruction; the words after it
//! (until the next opcode) are its operands. This is a disassembly listing, not
//! recompilable BOS — operand semantics (signed vs piece index vs offset) aren't
//! recovered, matching the reference oracle's limitation.

use crate::cob;
use crate::opcodes::mnemonic;
use std::fmt::Write;

pub fn disassemble(buf: &[u8]) -> Result<String, String> {
    let decoded = cob::decode(buf)?;
    let h = &decoded.header;

    let mut out = String::new();
    let _ = writeln!(
        out,
        "; COB v{}  ·  {} script(s)  ·  {} piece(s)  ·  {} static var(s)  ·  {} code words",
        h.version, h.num_scripts, h.num_pieces, h.num_static_vars, h.total_script_len
    );
    if !decoded.pieces.is_empty() {
        let _ = writeln!(out, "; pieces: {}", decoded.pieces.join(", "));
    }

    for (name, code) in &decoded.scripts {
        let _ = writeln!(out, "\n=== {name} ===");
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
                    i = j;
                }
                None => {
                    // A leading non-opcode word (shouldn't happen in valid code).
                    let _ = writeln!(out, "{i:04}  .word {word}");
                    i += 1;
                }
            }
        }
    }
    Ok(out)
}
