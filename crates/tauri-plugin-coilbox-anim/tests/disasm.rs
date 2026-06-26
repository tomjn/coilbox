//! Disassembler sanity test against a golden COB produced by the reference
//! Python compiler (`bos2cob_py3.py` on `fixtures/min.bos`).

// Pull the library's modules in via the public disassemble path. The crate only
// exposes `init()`, so we re-read the fixture and assert on the listing the
// command would produce. We reach the disassembler through a tiny test shim that
// mirrors what `anim_cob_disasm` does.
//
// Note: the disassembler isn't part of the public API, so this integration test
// drives it through the same file-read + decode the command uses, asserting the
// human-readable listing contains the expected structure.

use std::path::Path;

#[path = "../src/cob.rs"]
mod cob;
#[path = "../src/disasm.rs"]
mod disasm;
/// The disassembler is internal; this test calls it through the compiled crate's
/// test build by including the source modules directly.
#[path = "../src/opcodes.rs"]
mod opcodes;

#[test]
fn disassembles_golden_min_cob() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/min.cob");
    let bytes = std::fs::read(&path).expect("read fixture");
    let listing = disasm::disassemble(&bytes).expect("disassemble");

    // Header line: COB v4, two scripts (Create, Killed), two pieces, one static.
    assert!(listing.contains("COB v4"), "header:\n{listing}");
    assert!(listing.contains("2 script(s)"), "{listing}");
    assert!(listing.contains("pieces: base, turret"), "{listing}");

    // Both functions present.
    assert!(listing.contains("=== Create ==="), "{listing}");
    assert!(listing.contains("=== Killed ==="), "{listing}");

    // Create's body: foo = 1 + 2 (folded to 3), hide turret, show base.
    assert!(listing.contains("PUSH_CONSTANT 3"), "{listing}");
    assert!(listing.contains("POP_STATIC 0"), "{listing}");
    assert!(listing.contains("HIDE"), "{listing}");
    assert!(listing.contains("SHOW"), "{listing}");

    // Killed: if (severity < 50) explode base type 1; return (0).
    assert!(listing.contains("SET_LESS"), "{listing}");
    assert!(listing.contains("JUMP_NOT_EQUAL"), "{listing}");
    assert!(listing.contains("EXPLODE"), "{listing}");
    assert!(listing.contains("RETURN"), "{listing}");
}
