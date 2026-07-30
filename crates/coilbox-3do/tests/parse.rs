//! Two kinds of test.
//!
//! The first synthesises files byte by byte, because no `.3do` can be checked
//! in: every installed game's models descend from Total Annihilation's, which
//! are not ours to redistribute.
//!
//! The second parses the real thing, over a corpus of models extracted from the
//! installed games. It is skipped unless `COILBOX_3DO_CORPUS` points at a
//! directory of `.3do` files, so it never runs in CI. See `docs/3do-format.md`
//! for how to fill one.

use std::path::{Path, PathBuf};

use coilbox_3do::{read, Error, Model, Texture, OBJECT_SIZE};

/// One unit, as the file counts.
const UNIT: i32 = 65536;

#[test]
fn reads_a_piece_tree() {
    let mut file = File3do::new();
    let name = file.text("Flare");
    let flare = file.object(&Obj {
        name,
        from_parent: [UNIT, 2 * UNIT, 3 * UNIT],
        ..Obj::default()
    });
    let quad = quad(&mut file, [0, 0, 0], 4 * UNIT, Some("ARMTEX"));
    let name = file.text("BASE");
    file.root(&Obj {
        name,
        vertices: quad.vertices,
        primitives: quad.primitives,
        child: flare,
        ..Obj::default()
    });

    let model = read(&file.bytes).expect("parses");

    // Names are lower cased, as the engine does, because unit scripts address
    // pieces by name.
    assert_eq!(model.root.name, "base");
    assert_eq!(model.root.children.len(), 1);

    let flare = &model.root.children[0];
    assert_eq!(flare.name, "flare");
    // Scaled to engine units, and Z negated.
    assert_eq!(flare.offset, [1.0, 2.0, -3.0]);
    assert!(flare.vertices.is_empty());
    assert!(flare.primitives.is_empty());

    assert_eq!(
        model.root.vertices,
        [
            [0.0, 0.0, 0.0],
            [0.0, 0.0, -4.0],
            [4.0, 0.0, -4.0],
            [4.0, 0.0, 0.0]
        ]
    );

    let face = &model.root.primitives[0];
    assert_eq!(face.texture, Texture::Name("armtex".into()));
    assert_eq!(face.normal, [0.0, 1.0, 0.0]);
    assert_eq!(face.vertex_normals, vec![[0.0, 1.0, 0.0]; 4]);

    // The file has no radius, height or middle, so these are the engine's own
    // figures over the whole box: 4 by 0 by 4, cornered on the origin.
    assert_eq!(model.height, 0.0);
    assert_eq!(model.mid, [2.0, 0.0, -2.0]);
    assert!((model.radius - 8.0f32.sqrt()).abs() < 1e-6);
}

#[test]
fn a_face_with_no_texture_name_is_a_palette_colour() {
    let mut file = File3do::new();
    let quad = quad(&mut file, [0, 0, 0], 4 * UNIT, None);
    let name = file.text("base");
    file.root(&Obj {
        name,
        vertices: quad.vertices,
        primitives: quad.primitives,
        ..Obj::default()
    });

    let model = read(&file.bytes).expect("parses");
    assert_eq!(model.root.primitives[0].texture, Texture::Palette(9));
}

#[test]
fn drops_the_root_selection_face_only() {
    let mut file = File3do::new();

    let child_quad = quad(&mut file, [0, 0, 0], 4 * UNIT, Some("child"));
    let name = file.text("turret");
    let child = file.object(&Obj {
        name,
        vertices: child_quad.vertices,
        primitives: child_quad.primitives,
        // The engine reads this field on every piece and honours it on the root
        // alone, so a child's own face survives.
        selection: 0,
        ..Obj::default()
    });

    let root_quad = quad(&mut file, [0, 0, 0], 4 * UNIT, Some("root"));
    let name = file.text("base");
    file.root(&Obj {
        name,
        vertices: root_quad.vertices,
        primitives: root_quad.primitives,
        selection: 0,
        child,
        ..Obj::default()
    });

    let model = read(&file.bytes).expect("parses");
    assert!(model.root.primitives.is_empty());
    assert_eq!(model.root.children[0].primitives.len(), 1);
}

#[test]
fn drops_faces_the_engine_never_draws() {
    let mut file = File3do::new();
    // Four corners 40 units apart, low enough to be under the unit and wound so
    // the face points at the ground.
    let plate = [
        [0, 0, 0],
        [40 * UNIT, 0, 0],
        [40 * UNIT, 0, 40 * UNIT],
        [0, 0, 40 * UNIT],
    ];
    let vertices = file.vertices(&plate);
    let corners = file.indices(&[0, 1, 2, 3]);
    let edge = file.indices(&[0, 1]);
    let plate_texture = file.text("plate");
    let line_texture = file.text("line");
    let primitives = file.primitives(&[
        Prim {
            indices: corners,
            texture: plate_texture,
            ..Prim::default()
        },
        // Two corners is a line, not a face.
        Prim {
            indices: edge,
            texture: line_texture,
            ..Prim::default()
        },
    ]);
    let name = file.text("base");
    file.root(&Obj {
        name,
        vertices: (4, vertices),
        primitives: (2, primitives),
        ..Obj::default()
    });

    let model = read(&file.bytes).expect("parses");
    assert!(
        model.root.primitives.is_empty(),
        "a base plate and a two-corner face both have to go, got {:?}",
        model.root.primitives
    );
}

#[test]
fn keeps_the_last_of_a_set_of_duplicate_faces() {
    let mut file = File3do::new();
    let square = [
        [0, 0, 0],
        [0, 0, 4 * UNIT],
        [4 * UNIT, 0, 4 * UNIT],
        [4 * UNIT, 0, 0],
    ];
    let vertices = file.vertices(&square);
    let forwards = file.indices(&[0, 1, 2, 3]);
    // The same four corners named in another order: 3do models animate by
    // stacking faces on one another, and the engine draws only the last.
    let backwards = file.indices(&[2, 3, 0, 1]);
    let off = file.text("off");
    let on = file.text("on");
    let primitives = file.primitives(&[
        Prim {
            indices: forwards,
            texture: off,
            ..Prim::default()
        },
        Prim {
            indices: backwards,
            texture: on,
            ..Prim::default()
        },
    ]);
    let name = file.text("base");
    file.root(&Obj {
        name,
        vertices: (4, vertices),
        primitives: (2, primitives),
        ..Obj::default()
    });

    let model = read(&file.bytes).expect("parses");
    assert_eq!(model.root.primitives.len(), 1);
    assert_eq!(model.root.primitives[0].texture, Texture::Name("on".into()));
}

#[test]
fn smooths_a_corner_over_the_faces_that_meet_gently() {
    // A flat quad and a ramp folded up from its far edge, 45 degrees apart.
    let model = two_quads(&[
        [0, 0, 0],
        [0, 0, 4 * UNIT],
        [4 * UNIT, 0, 4 * UNIT],
        [4 * UNIT, 0, 0],
        [8 * UNIT, 4 * UNIT, 4 * UNIT],
        [8 * UNIT, 4 * UNIT, 0],
    ]);

    let flat = &model.root.primitives[0];
    let ramp = &model.root.primitives[1];
    let blend = normalize(add(flat.normal, ramp.normal));

    // The two corners on the shared edge blend, the ones off it do not.
    assert_close(flat.vertex_normals[0], flat.normal);
    assert_close(flat.vertex_normals[1], flat.normal);
    assert_close(flat.vertex_normals[2], blend);
    assert_close(flat.vertex_normals[3], blend);
}

#[test]
fn leaves_a_hard_edge_hard() {
    // The same shared edge with the second quad folded straight up, past the
    // angle the engine treats as one surface.
    let model = two_quads(&[
        [0, 0, 0],
        [0, 0, 4 * UNIT],
        [4 * UNIT, 0, 4 * UNIT],
        [4 * UNIT, 0, 0],
        [4 * UNIT, 4 * UNIT, 4 * UNIT],
        [4 * UNIT, 4 * UNIT, 0],
    ]);

    let flat = &model.root.primitives[0];
    assert!((dot(flat.normal, model.root.primitives[1].normal)).abs() < 1e-6);
    for corner in &flat.vertex_normals {
        assert_close(*corner, flat.normal);
    }
}

#[test]
fn rejects_files_it_cannot_read() {
    assert_eq!(
        read(&[]),
        Err(Error::TooShort {
            need: OBJECT_SIZE,
            got: 0
        })
    );
    // One model in Metal Factions 2.58 is zero bytes long.
    assert_eq!(
        read(&[0u8; 20]),
        Err(Error::TooShort {
            need: OBJECT_SIZE,
            got: 20
        })
    );
    // No magic number, so the version signature is the only thing that says a
    // file is not a 3do.
    assert_eq!(read(&[0u8; 64]), Err(Error::BadVersion(0)));
}

#[test]
fn rejects_a_face_that_names_a_vertex_the_piece_does_not_have() {
    let mut file = File3do::new();
    let vertices = file.vertices(&[[0, 0, 0], [0, 0, UNIT], [UNIT, 0, UNIT]]);
    let indices = file.indices(&[0, 1, 7]);
    let texture = file.text("tex");
    let primitives = file.primitives(&[Prim {
        indices,
        texture,
        ..Prim::default()
    }]);
    let name = file.text("base");
    file.root(&Obj {
        name,
        vertices: (3, vertices),
        primitives: (1, primitives),
        ..Obj::default()
    });

    assert_eq!(
        read(&file.bytes),
        Err(Error::IndexOutOfRange {
            piece: "base".into(),
            index: 7,
            vertices: 3,
        })
    );
}

#[test]
fn rejects_a_tree_that_is_not_a_tree() {
    let mut file = File3do::new();
    let name = file.text("base");
    // A piece that is its own next sibling, which the engine would follow until
    // it ran out of stack.
    let child = file.object(&Obj {
        name,
        ..Obj::default()
    });
    file.place(
        child as usize,
        &Obj {
            name,
            sibling: child,
            ..Obj::default()
        },
    );
    file.root(&Obj {
        name,
        child,
        ..Obj::default()
    });
    assert_eq!(read(&file.bytes), Err(Error::Cycle(child as usize)));

    let mut file = File3do::new();
    let name = file.text("base");
    let sibling = file.object(&Obj {
        name,
        ..Obj::default()
    });
    file.root(&Obj {
        name,
        sibling,
        ..Obj::default()
    });
    assert_eq!(read(&file.bytes), Err(Error::RootHasSibling));
}

/// Every `.3do` in a real game has to parse. The count and the digest below
/// were taken from the models in Balanced Annihilation 15.9.8, Metal Factions
/// 2.58, Spring 1944 2.31, XTA 9.65 and Basically OTA 1.7.
#[test]
fn parses_the_installed_games() {
    let Some(root) = std::env::var_os("COILBOX_3DO_CORPUS").map(PathBuf::from) else {
        return;
    };

    let mut files = Vec::new();
    collect(&root, &mut files);
    assert!(!files.is_empty(), "no .3do files under {}", root.display());

    let mut failed = Vec::new();
    let mut checked_commander = false;
    for path in &files {
        let bytes = std::fs::read(path).expect("reads");
        // Metal Factions 2.58 ships one model that is zero bytes long. The
        // engine will not load that either, so it is not ours to cope with.
        if bytes.is_empty() {
            continue;
        }
        match read(&bytes) {
            Ok(model) => {
                let name = path.to_string_lossy();
                if name.contains("balanced_annihilation") && name.ends_with("/armcom.3do") {
                    // Balanced Annihilation's Arm commander, the one model this
                    // pins byte for byte.
                    assert_eq!(digest(&model), 0x70cb_4907_91f3_b0a9);
                    checked_commander = true;
                }
            }
            Err(e) => failed.push(format!("{}: {e}", path.display())),
        }
    }

    assert!(
        failed.is_empty(),
        "{} failed:\n{}",
        failed.len(),
        failed.join("\n")
    );
    assert!(
        checked_commander || files.len() < 100,
        "the corpus has no armcom.3do to pin"
    );
}

fn collect(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect(&path, out);
        } else if path
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("3do"))
        {
            out.push(path);
        }
    }
}

/// FNV-1a over everything the parser produces, so a change in any field moves
/// it. Hand rolled because the crate has no dependencies.
fn digest(model: &Model) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    let mut eat = |bytes: &[u8]| {
        for byte in bytes {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
    };
    let eat_f32s = |values: &[f32], eat: &mut dyn FnMut(&[u8])| {
        for value in values {
            eat(&value.to_bits().to_le_bytes());
        }
    };

    eat_f32s(&[model.radius, model.height], &mut eat);
    eat_f32s(&model.mid, &mut eat);
    for piece in model.root.walk() {
        eat(piece.name.as_bytes());
        eat_f32s(&piece.offset, &mut eat);
        for vertex in &piece.vertices {
            eat_f32s(vertex, &mut eat);
        }
        for primitive in &piece.primitives {
            for index in &primitive.indices {
                eat(&index.to_le_bytes());
            }
            match &primitive.texture {
                Texture::Name(name) => eat(name.as_bytes()),
                Texture::Palette(entry) => eat(&entry.to_le_bytes()),
            }
            eat_f32s(&primitive.normal, &mut eat);
            for normal in &primitive.vertex_normals {
                eat_f32s(normal, &mut eat);
            }
        }
    }
    hash
}

// --- Building a file by hand -------------------------------------------------
//
// Not a writer, and never to become one: enough layout to state a test's bytes,
// with every offset placed where the test asks for it.

struct Obj {
    name: i32,
    /// Count and file offset.
    vertices: (i32, i32),
    primitives: (i32, i32),
    selection: i32,
    from_parent: [i32; 3],
    child: i32,
    sibling: i32,
}

impl Default for Obj {
    fn default() -> Self {
        Self {
            name: 0,
            vertices: (0, 0),
            primitives: (0, 0),
            // Minus one is how a piece says it has no selection face.
            selection: -1,
            from_parent: [0; 3],
            child: 0,
            sibling: 0,
        }
    }
}

#[derive(Default)]
struct Prim {
    palette: i32,
    /// Count and file offset.
    indices: (i32, i32),
    texture: i32,
}

struct File3do {
    bytes: Vec<u8>,
}

impl File3do {
    /// The engine always starts at offset 0, so the root is reserved up front
    /// and filled in last.
    fn new() -> Self {
        Self {
            bytes: vec![0; OBJECT_SIZE],
        }
    }

    /// A NUL terminated string, wherever there is room for it.
    fn text(&mut self, text: &str) -> i32 {
        let at = self.bytes.len() as i32;
        self.bytes.extend_from_slice(text.as_bytes());
        self.bytes.push(0);
        at
    }

    fn vertices(&mut self, vertices: &[[i32; 3]]) -> i32 {
        let at = self.bytes.len() as i32;
        for vertex in vertices {
            for value in vertex {
                self.bytes.extend_from_slice(&value.to_le_bytes());
            }
        }
        at
    }

    fn indices(&mut self, indices: &[u16]) -> (i32, i32) {
        let at = self.bytes.len() as i32;
        for index in indices {
            self.bytes.extend_from_slice(&index.to_le_bytes());
        }
        (indices.len() as i32, at)
    }

    fn primitives(&mut self, primitives: &[Prim]) -> i32 {
        let at = self.bytes.len() as i32;
        for primitive in primitives {
            let fields = [
                primitive.palette,
                primitive.indices.0,
                0,
                primitive.indices.1,
                primitive.texture,
                0,
                0,
                0,
            ];
            for field in fields {
                self.bytes.extend_from_slice(&field.to_le_bytes());
            }
        }
        at
    }

    fn object(&mut self, object: &Obj) -> i32 {
        let at = self.bytes.len();
        self.bytes.extend_from_slice(&[0; OBJECT_SIZE]);
        self.place(at, object);
        at as i32
    }

    fn root(&mut self, object: &Obj) {
        self.place(0, object);
    }

    fn place(&mut self, at: usize, object: &Obj) {
        let fields = [
            1,
            object.vertices.0,
            object.primitives.0,
            object.selection,
            object.from_parent[0],
            object.from_parent[1],
            object.from_parent[2],
            object.name,
            0,
            object.vertices.1,
            object.primitives.1,
            object.sibling,
            object.child,
        ];
        for (i, field) in fields.iter().enumerate() {
            self.bytes[at + i * 4..at + i * 4 + 4].copy_from_slice(&field.to_le_bytes());
        }
    }
}

struct Quad {
    vertices: (i32, i32),
    primitives: (i32, i32),
}

/// One square face on the ground plane, wound so it faces up.
fn quad(file: &mut File3do, at: [i32; 3], size: i32, texture: Option<&str>) -> Quad {
    let vertices = file.vertices(&[
        [at[0], at[1], at[2]],
        [at[0], at[1], at[2] + size],
        [at[0] + size, at[1], at[2] + size],
        [at[0] + size, at[1], at[2]],
    ]);
    let indices = file.indices(&[0, 1, 2, 3]);
    let texture = texture.map_or(0, |t| file.text(t));
    let primitives = file.primitives(&[Prim {
        palette: 9,
        indices,
        texture,
    }]);
    Quad {
        vertices: (4, vertices),
        primitives: (1, primitives),
    }
}

/// Two quads sharing the edge between vertices 2 and 3.
fn two_quads(vertices: &[[i32; 3]; 6]) -> Model {
    let mut file = File3do::new();
    let at = file.vertices(vertices);
    let first = file.indices(&[0, 1, 2, 3]);
    let second = file.indices(&[3, 2, 4, 5]);
    let a = file.text("a");
    let b = file.text("b");
    let primitives = file.primitives(&[
        Prim {
            indices: first,
            texture: a,
            ..Prim::default()
        },
        Prim {
            indices: second,
            texture: b,
            ..Prim::default()
        },
    ]);
    let name = file.text("base");
    file.root(&Obj {
        name,
        vertices: (6, at),
        primitives: (2, primitives),
        ..Obj::default()
    });
    read(&file.bytes).expect("parses")
}

fn add(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn normalize(a: [f32; 3]) -> [f32; 3] {
    let scale = 1.0 / dot(a, a).sqrt();
    [a[0] * scale, a[1] * scale, a[2] * scale]
}

fn assert_close(got: [f32; 3], want: [f32; 3]) {
    let off = (0..3).map(|i| (got[i] - want[i]).abs()).fold(0.0, f32::max);
    assert!(off < 1e-6, "got {got:?}, want {want:?}");
}
