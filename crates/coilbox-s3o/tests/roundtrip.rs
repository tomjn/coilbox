use coilbox_s3o::{read, write, Error, Model, Piece, PrimitiveType, Vertex, WriteError};

const AMMOBOX2: &[u8] = include_bytes!("fixtures/ammobox2.s3o");

/// From Splinter Faction, reused with the author's permission. A real model
/// from a shipping game, so it pins the layout against something we did not
/// write ourselves.
fn fixture() -> Model {
    read(AMMOBOX2).expect("fixture parses")
}

#[test]
fn reads_a_shipped_model() {
    let model = fixture();

    assert_eq!(model.texture1, "ammobox2.png");
    assert_eq!(model.texture2, "ammobox2glowy.png");
    assert_eq!(model.height, 18.0);
    assert!((model.radius - 12.749_866).abs() < 1e-5);

    // An empty root that only names the hierarchy, which is how emit points and
    // aim points are represented too.
    assert_eq!(model.root.name, "base");
    assert!(model.root.vertices.is_empty());
    assert_eq!(model.root.children.len(), 1);

    let body = &model.root.children[0];
    assert_eq!(body.primitive_type, PrimitiveType::Triangles);
    assert_eq!(body.vertices.len(), 712);
    assert_eq!(body.indices.len(), 1068);
    assert_eq!(body.indices.len() % 3, 0);
}

#[test]
fn triangle_pieces_have_no_end_of_strip_markers() {
    let model = fixture();
    for piece in model.root.walk() {
        if piece.primitive_type == PrimitiveType::Triangles {
            assert!(
                piece.indices.iter().all(|&i| i != 0xffff_ffff),
                "piece {:?} has a strip marker in a triangle list",
                piece.name
            );
        }
    }
}

#[test]
fn front_faces_wind_counter_clockwise() {
    // The engine does not flip winding on load, so an exporter has to get this
    // right. Every triangle in a shipped model agrees with its vertex normals.
    let model = fixture();
    for piece in model.root.walk() {
        if piece.primitive_type != PrimitiveType::Triangles {
            continue;
        }
        for tri in piece.indices.chunks_exact(3) {
            let v: Vec<Vertex> = tri.iter().map(|&i| piece.vertices[i as usize]).collect();
            let u = sub(v[1].pos, v[0].pos);
            let w = sub(v[2].pos, v[0].pos);
            let face = cross(u, w);
            let mean = [
                (v[0].normal[0] + v[1].normal[0] + v[2].normal[0]) / 3.0,
                (v[0].normal[1] + v[1].normal[1] + v[2].normal[1]) / 3.0,
                (v[0].normal[2] + v[1].normal[2] + v[2].normal[2]) / 3.0,
            ];
            assert!(
                dot(face, mean) >= 0.0,
                "triangle {tri:?} in piece {:?} winds the wrong way",
                piece.name
            );
        }
    }
}

#[test]
fn round_trip_preserves_the_model() {
    let model = fixture();
    let bytes = write(&model).expect("writes");
    assert_eq!(read(&bytes).expect("re-reads"), model);
}

#[test]
fn our_own_output_is_byte_stable() {
    let bytes = write(&fixture()).expect("writes");
    let again = write(&read(&bytes).expect("re-reads")).expect("writes again");
    assert_eq!(again, bytes);
}

#[test]
fn our_layout_wastes_no_bytes() {
    // Both layouts are dense, so a correct writer lands on the same size even
    // though it orders the sections differently.
    let bytes = write(&fixture()).expect("writes");
    assert_eq!(bytes.len(), AMMOBOX2.len());
}

#[test]
fn writes_an_empty_piece_with_no_geometry() {
    let model = Model {
        radius: 0.0,
        height: 0.0,
        mid: [0.0, 0.0, 0.0],
        texture1: "t1.png".into(),
        texture2: String::new(),
        root: Piece {
            name: "base".into(),
            primitive_type: PrimitiveType::Triangles,
            offset: [0.0, 0.0, 0.0],
            vertices: Vec::new(),
            indices: Vec::new(),
            children: vec![Piece {
                name: "flare".into(),
                primitive_type: PrimitiveType::Triangles,
                offset: [1.0, 2.0, 3.0],
                vertices: Vec::new(),
                indices: Vec::new(),
                children: Vec::new(),
            }],
        },
    };

    let back = read(&write(&model).expect("writes")).expect("re-reads");
    assert_eq!(back, model);
    // An absent second texture stays absent rather than becoming an empty name.
    assert_eq!(back.texture2, "");
}

#[test]
fn rejects_indices_that_address_nothing() {
    let model = Model {
        radius: 0.0,
        height: 0.0,
        mid: [0.0, 0.0, 0.0],
        texture1: String::new(),
        texture2: String::new(),
        root: Piece {
            name: "base".into(),
            primitive_type: PrimitiveType::Triangles,
            offset: [0.0, 0.0, 0.0],
            vertices: vec![Vertex {
                pos: [0.0, 0.0, 0.0],
                normal: [0.0, 1.0, 0.0],
                uv: [0.0, 0.0],
            }],
            indices: vec![0, 0, 7],
            children: Vec::new(),
        },
    };

    assert_eq!(
        write(&model),
        Err(WriteError::IndexOutOfRange {
            piece: "base".into(),
            index: 7,
            vertices: 1,
        })
    );
}

#[test]
fn rejects_files_that_are_not_s3o() {
    assert_eq!(read(&[0u8; 8]), Err(Error::TooShort { need: 52, got: 8 }));
    assert_eq!(read(&[0u8; 64]), Err(Error::BadMagic));

    let mut truncated = AMMOBOX2[..200].to_vec();
    truncated.truncate(200);
    assert!(read(&truncated).is_err());
}

fn sub(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
