//! Reading a real Collada file, rather than the hand-built structures the unit
//! tests use.
//!
//! The fixture is a cube in a two deep node tree, written by hand rather than
//! taken from a game, because the games that ship `.dae` models are licensed
//! and their files are not ours to vendor. Two nested nodes is the smallest
//! shape that proves the part most likely to go wrong: that a child's offset
//! comes back relative to its parent rather than already accumulated.

use coilbox_assimp::{read, Piece};

const CUBE: &[u8] = include_bytes!("fixtures/cube.dae");

/// Depth first search by name. The tree's exact shape is left alone on purpose:
/// Assimp's Collada importer is free to add a wrapper node of its own, and a
/// test that pinned the shape would fail on an Assimp upgrade without anything
/// being wrong.
fn find<'a>(piece: &'a Piece, name: &str) -> Option<&'a Piece> {
    if piece.name == name {
        return Some(piece);
    }
    piece.children.iter().find_map(|c| find(c, name))
}

fn triangles(piece: &Piece) -> usize {
    piece
        .meshes
        .iter()
        .map(|m| m.indices.len() / 3)
        .sum::<usize>()
        + piece.children.iter().map(triangles).sum::<usize>()
}

#[test]
fn reads_the_node_tree_with_parent_relative_offsets() {
    let model = read(CUBE, "dae").expect("the fixture should parse");

    let branch = find(&model.root, "branch").expect("the child node should be a piece");
    // 10 along x in the file, and it must arrive as 10 rather than as the 10
    // plus its parent's own position.
    assert!(
        (branch.offset[0] - 10.0).abs() < 0.001,
        "expected the child's own offset, got {:?}",
        branch.offset
    );

    let trunk = find(&model.root, "trunk").expect("the parent node should be a piece");
    assert!(
        find(trunk, "branch").is_some(),
        "the child should sit under its parent, not beside it"
    );
}

#[test]
fn reads_every_triangle_of_the_cube() {
    let model = read(CUBE, "dae").expect("the fixture should parse");
    assert_eq!(triangles(&model.root), 12);
}

#[test]
fn sizes_the_model_from_its_geometry() {
    let model = read(CUBE, "dae").expect("the fixture should parse");
    // The cube spans -1 to 1 on every axis, so it is 2 high wherever it sits.
    assert!(
        (model.height - 2.0).abs() < 0.001,
        "expected a height of 2, got {}",
        model.height
    );
    // Sitting 10 along x, the middle of the bounding box goes with it.
    assert!(
        (model.mid[0] - 10.0).abs() < 0.001,
        "expected the centre to follow the geometry, got {:?}",
        model.mid
    );
}

const ROTATED: &[u8] = include_bytes!("fixtures/rotated.dae");

/// A piece can only hold a position, so a parent's rotation has to reach its
/// children as a moved offset rather than as a rotation they inherit.
#[test]
fn a_parents_rotation_moves_where_its_child_sits() {
    let model = read(ROTATED, "dae").expect("the fixture should parse");
    let branch = find(&model.root, "branch").expect("the child node should be a piece");
    // The child sits 10 along x inside a parent turned a quarter turn about y,
    // so it belongs 10 away along z. Which way round z it lands depends on a
    // handedness convention worth no test of its own, so this asks only that it
    // left the x axis and arrived on z.
    assert!(
        branch.offset[0].abs() < 0.01,
        "expected the child off the x axis, got {:?}",
        branch.offset
    );
    assert!(
        (branch.offset[2].abs() - 10.0).abs() < 0.01,
        "expected the child 10 along z, got {:?}",
        branch.offset
    );
}

/// The other half of the same rule: the geometry itself has to turn, or a
/// rotated piece draws in the orientation it was modelled in.
#[test]
fn a_rotation_reaches_the_vertices_themselves() {
    let plain = read(CUBE, "dae").expect("the fixture should parse");
    let turned = read(ROTATED, "dae").expect("the fixture should parse");
    let corner = |m: &coilbox_assimp::Model| {
        let branch = find(&m.root, "branch").expect("the child node should be a piece");
        let v = branch
            .meshes
            .first()
            .expect("the cube should have geometry")
            .vertices[0];
        v.pos
    };
    let before = corner(&plain);
    let after = corner(&turned);
    assert!(
        (before[0] - after[0]).abs() > 0.5 || (before[2] - after[2]).abs() > 0.5,
        "the cube's own vertices should have turned, got {before:?} then {after:?}"
    );
}

#[test]
fn a_file_that_is_not_a_model_fails_rather_than_returning_an_empty_model() {
    let err = read(b"this is not a model", "dae").unwrap_err();
    assert!(!err.is_empty(), "a failure should say something");
}
