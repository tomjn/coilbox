//! COB opcode table (standard / version-4). Ported verbatim from
//! `bos2cob_py3.py` (L34-106) — the same values `cob_decompiler.py` uses. Values
//! are the 32-bit little-endian instruction words the engine executes.

/// `(mnemonic, value)` in source order. Note `DONT_SHADE` and `DONT_SHADOW`
/// share `0x1000E000`; reverse lookups resolve to the later one (`DONT_SHADOW`),
/// matching the Python `rop` dict.
pub const OPCODES: &[(&str, u32)] = &[
    ("MOVE", 0x10001000),
    ("TURN", 0x10002000),
    ("SCALE", 0x100A0000),
    ("SPIN", 0x10003000),
    ("STOP_SPIN", 0x10004000),
    ("SHOW", 0x10005000),
    ("HIDE", 0x10006000),
    ("CACHE", 0x10007000),
    ("DONT_CACHE", 0x10008000),
    ("MOVE_NOW", 0x1000B000),
    ("TURN_NOW", 0x1000C000),
    ("SCALE_NOW", 0x100A1000),
    ("SHADE", 0x1000D000),
    ("DONT_SHADE", 0x1000E000),
    ("DONT_SHADOW", 0x1000E000),
    ("EMIT_SFX", 0x1000F000),
    ("WAIT_FOR_TURN", 0x10011000),
    ("WAIT_FOR_MOVE", 0x10012000),
    ("WAIT_FOR_SCALE", 0x100A2000),
    ("SLEEP", 0x10013000),
    ("PUSH_CONSTANT", 0x10021001),
    ("PUSH_LOCAL_VAR", 0x10021002),
    ("PUSH_STATIC", 0x10021004),
    ("CREATE_LOCAL_VAR", 0x10022000),
    ("POP_LOCAL_VAR", 0x10023002),
    ("POP_STATIC", 0x10023004),
    ("POP_STACK", 0x10024000),
    ("ADD", 0x10031000),
    ("SUB", 0x10032000),
    ("MUL", 0x10033000),
    ("DIV", 0x10034000),
    ("MOD", 0x10034001),
    ("BITWISE_AND", 0x10035000),
    ("BITWISE_OR", 0x10036000),
    ("BITWISE_XOR", 0x10037000),
    ("BITWISE_NOT", 0x10038000),
    ("RAND", 0x10041000),
    ("GET_UNIT_VALUE", 0x10042000),
    ("GET", 0x10043000),
    ("SET_LESS", 0x10051000),
    ("SET_LESS_OR_EQUAL", 0x10052000),
    ("SET_GREATER", 0x10053000),
    ("SET_GREATER_OR_EQUAL", 0x10054000),
    ("SET_EQUAL", 0x10055000),
    ("SET_NOT_EQUAL", 0x10056000),
    ("LOGICAL_AND", 0x10057000),
    ("LOGICAL_OR", 0x10058000),
    ("LOGICAL_XOR", 0x10059000),
    ("LOGICAL_NOT", 0x1005A000),
    ("START_SCRIPT", 0x10061000),
    ("CALL_SCRIPT", 0x10062000),
    ("REAL_CALL", 0x10062001),
    ("LUA_CALL", 0x10062002),
    ("JUMP", 0x10064000),
    ("RETURN", 0x10065000),
    ("JUMP_NOT_EQUAL", 0x10066000),
    ("SIGNAL", 0x10067000),
    ("SET_SIGNAL_MASK", 0x10068000),
    ("EXPLODE", 0x10071000),
    ("PLAY_SOUND", 0x10072000),
    ("SET", 0x10082000),
    ("ATTACH_UNIT", 0x10083000),
    ("DROP_UNIT", 0x10084000),
];

/// Opcode value for a mnemonic (case-sensitive; names are already upper-snake).
// Used by the compiler codegen (in progress — see PORTING.md).
#[allow(dead_code)]
pub fn opcode(name: &str) -> Option<u32> {
    OPCODES.iter().find(|(n, _)| *n == name).map(|(_, v)| *v)
}

/// Mnemonic for an instruction word, or `None` if it isn't a known opcode.
/// Returns the *last* matching entry so shared values resolve like Python `rop`.
pub fn mnemonic(value: u32) -> Option<&'static str> {
    OPCODES.iter().rev().find(|(_, v)| *v == value).map(|(n, _)| *n)
}
