//! Decompile a `.cob` to BOS and compile that back: the bytes must match. The
//! golden fixtures come from the Python reference and `roundtrip.bos` is
//! written for the shapes that are awkward to rebuild.

use std::path::Path;
use tauri_plugin_coilbox_anim::{compile_bos, decompile_cob};

fn fixtures() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

/// Decompile `cob`, compile the result, and assert it is `cob` again.
fn assert_round_trip(name: &str, cob: &[u8]) -> String {
    let decompiled = decompile_cob(cob).unwrap_or_else(|e| panic!("decompile {name}: {e}"));
    assert!(
        decompiled.warnings.is_empty(),
        "{name}: {:?}\n{}",
        decompiled.warnings,
        decompiled.source
    );
    let again = compile_bos(&decompiled.source, &fixtures())
        .unwrap_or_else(|e| panic!("recompile {name}: {e}\n{}", decompiled.source));
    assert!(
        again == cob,
        "{name}: recompiled bytes differ\n{}",
        decompiled.source
    );
    decompiled.source
}

#[test]
fn golden_fixtures_round_trip() {
    for name in ["min", "features", "folds", "anims"] {
        let cob = std::fs::read(fixtures().join(format!("{name}.cob"))).expect("read cob");
        assert_round_trip(name, &cob);
    }
}

#[test]
fn awkward_shapes_round_trip() {
    let src = std::fs::read_to_string(fixtures().join("roundtrip.bos")).expect("read bos");
    let cob = compile_bos(&src, &fixtures()).expect("compile roundtrip.bos");
    let bos = assert_round_trip("roundtrip", &cob);

    // Piece-returning callins name their argument after the piece.
    assert!(bos.contains("QueryWeapon1(flare_piece)"), "{bos}");
    assert!(bos.contains("\tflare_piece = flare;"), "{bos}");
    // Callins keep their conventional argument names.
    assert!(bos.contains("AimWeapon1(heading, pitch)"), "{bos}");
    assert!(bos.contains("Killed(severity, corpsetype)"), "{bos}");
    // A script called inside the file takes as many arguments as it is passed,
    // and the rest of its locals are declared.
    assert!(bos.contains("Restore(arg0, arg1)"), "{bos}");
    assert!(bos.contains("\tvar local0;"), "{bos}");
    assert!(bos.contains("Walk()\n{\n\tvar local0;"), "{bos}");
    assert!(
        bos.contains("turn torso to y-axis heading speed <225.5>;"),
        "{bos}"
    );
    assert!(bos.contains("move torso to y-axis [-1.25] now;"), "{bos}");
    assert!(bos.contains("static2 = static1 - (static0 - 1);"), "{bos}");
}

/// The listing from the original report, rebuilt from BOS a unit might have
/// had. Every statement in it should come back as the statement it was.
#[test]
fn start_building_reads_as_bos() {
    let pieces: Vec<String> = (0..16).map(|i| format!("p{i}")).collect();
    let src = format!(
        "piece {};\n\
         StartBuilding(heading, pitch)\n{{\n\
         signal 2;\nset-signal-mask 2;\nshow p14;\n\
         turn p12 to x-axis <-90> speed <180>;\n\
         turn p15 to y-axis heading speed <160>;\n\
         wait-for-turn p15 around y-axis;\n\
         set 5 to 1;\nshow p8;\nshow p9;\n\
         spin p8 around y-axis speed <450> accelerate <20>;\n\
         spin p9 around y-axis speed <-450> accelerate <20>;\n}}\n",
        pieces.join(", ")
    );
    let cob = compile_bos(&src, &fixtures()).expect("compile");
    let bos = assert_round_trip("start_building", &cob);
    let expected = "StartBuilding(heading, pitch)\n{\n\
        \tsignal 2;\n\
        \tset-signal-mask 2;\n\
        \tshow p14;\n\
        \tturn p12 to x-axis <-90> speed <180>;\n\
        \tturn p15 to y-axis heading speed <160>;\n\
        \twait-for-turn p15 around y-axis;\n\
        \tset INBUILDSTANCE to 1;\n\
        \tshow p8;\n\
        \tshow p9;\n\
        \tspin p8 around y-axis speed <450> accelerate <20>;\n\
        \tspin p9 around y-axis speed <-450> accelerate <20>;\n\
        \treturn (0);\n}\n";
    assert!(bos.contains(expected), "{bos}");
    // The name it uses is defined at the top, so the file compiles on its own.
    assert!(bos.contains("#define INBUILDSTANCE 5"), "{bos}");
}

/// Something BOS cannot say is kept as a comment and a line that will not
/// compile, rather than a guess that compiles into different behaviour.
#[test]
fn unwritable_script_fails_to_recompile() {
    // `compiler.rs` writes `PLAY_SOUND` without its operand, so build the
    // script by hand: PUSH_CONSTANT 1, PLAY_SOUND 0, PUSH_CONSTANT 0, RETURN.
    let words: [u32; 7] = [0x10021001, 1, 0x10072000, 0, 0x10021001, 0, 0x10065000];
    let mut code = Vec::new();
    for w in words {
        code.extend_from_slice(&w.to_le_bytes());
    }
    let cob = cob_with_one_script("Create", &code, &["base"]);
    let decompiled = decompile_cob(&cob).expect("decompile");
    assert_eq!(decompiled.warnings.len(), 1, "{:?}", decompiled.warnings);
    assert!(
        decompiled.warnings[0].contains("PLAY_SOUND names a sound"),
        "{:?}",
        decompiled.warnings
    );
    assert!(
        decompiled.source.contains("// 0002  PLAY_SOUND 0"),
        "{}",
        decompiled.source
    );
    assert!(compile_bos(&decompiled.source, &fixtures()).is_err());
}

/// COBBLER writes its own name into the stream after the first script's last
/// `RETURN`. That is data, not code, so the script still reads as BOS.
#[test]
fn compiler_signature_after_a_script_is_not_code() {
    let mut code = Vec::new();
    for w in [0x10021001u32, 0, 0x10065000] {
        code.extend_from_slice(&w.to_le_bytes());
    }
    code.extend_from_slice(b"Built by COBBLER");
    let cob = cob_with_one_script("Create", &code, &["base"]);
    let decompiled = decompile_cob(&cob).expect("decompile");
    assert_eq!(decompiled.warnings.len(), 1, "{:?}", decompiled.warnings);
    assert!(
        decompiled.warnings[0].contains("4 words that are not code"),
        "{:?}",
        decompiled.warnings
    );
    assert!(
        decompiled.source.contains("Create()\n{\n\t// 4 words"),
        "{}",
        decompiled.source
    );
    let again = compile_bos(&decompiled.source, &fixtures()).expect("recompile");
    assert_eq!(&again[44..56], &code[..12], "the code itself is unchanged");
}

/// A `.cob` holding a scale opcode cannot be written as BOS, because the
/// statement BARScriptCompiler has for it does not compile to this.
#[test]
fn a_scale_opcode_has_no_bos() {
    let mut code = Vec::new();
    // PUSH_CONSTANT 1, PUSH_CONSTANT 2, SCALE base, PUSH_CONSTANT 0, RETURN.
    for w in [
        0x10021001u32,
        1,
        0x10021001,
        2,
        0x100A0000,
        0,
        0x10021001,
        0,
        0x10065000,
    ] {
        code.extend_from_slice(&w.to_le_bytes());
    }
    let cob = cob_with_one_script("Create", &code, &["base"]);
    let decompiled = decompile_cob(&cob).expect("decompile");
    assert_eq!(decompiled.warnings.len(), 1, "{:?}", decompiled.warnings);
    assert!(
        decompiled.warnings[0].contains("scale opcodes have no BOS statement"),
        "{:?}",
        decompiled.warnings
    );
    assert!(compile_bos(&decompiled.source, &fixtures()).is_err());
}

/// A COB v4 file with one script, laid out the way `cob::encode` does it.
fn cob_with_one_script(name: &str, code: &[u8], pieces: &[&str]) -> Vec<u8> {
    let words = code.len() as u32 / 4;
    let off_code = 44u32;
    let off_code_index = off_code + code.len() as u32;
    let off_script_names = off_code_index + 4;
    let off_piece_names = off_script_names + 4;
    let off_names = off_piece_names + 4 * pieces.len() as u32;
    let header = [
        4,
        1,
        pieces.len() as u32,
        words,
        0,
        0,
        off_code_index,
        off_script_names,
        off_piece_names,
        off_code,
        off_names,
    ];
    let mut out = Vec::new();
    for v in header {
        out.extend_from_slice(&v.to_le_bytes());
    }
    out.extend_from_slice(code);
    out.extend_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(&off_names.to_le_bytes());
    let mut at = off_names + name.len() as u32 + 1;
    for piece in pieces {
        out.extend_from_slice(&at.to_le_bytes());
        at += piece.len() as u32 + 1;
    }
    out.extend_from_slice(name.as_bytes());
    out.push(0);
    for piece in pieces {
        out.extend_from_slice(piece.as_bytes());
        out.push(0);
    }
    out
}
