use super::*;

const DAGGER: &str = "[UNITINFO]\n{\n\tName=Dagger;\n\tMaxDamage=650;\n\t// Weapons\n\tWeapon1=KLight;\n\n\t[SFXTypes]\n\t{\n\t\texplosiongenerator0 = custom:damage_fire;\n\t}\n\t[customParams] {\n\t\ttype=small;\n\t\tcost=200;\n\t}\n}\n";

fn value(tree: &BTreeMap<String, Node>, path: &[&str]) -> Option<String> {
    let (key, sections) = path.split_last()?;
    let mut at = tree;
    for s in sections {
        match at.get(*s)? {
            Node::Table(t) => at = t,
            Node::Value(_) => return None,
        }
    }
    match at.get(*key)? {
        Node::Value(v) => Some(v.clone()),
        Node::Table(_) => None,
    }
}

#[test]
fn reads_keys_lowercased_with_sections_nested() {
    let tree = parse(DAGGER).unwrap().tree();
    assert_eq!(
        value(&tree, &["unitinfo", "maxdamage"]).as_deref(),
        Some("650")
    );
    assert_eq!(
        value(&tree, &["unitinfo", "sfxtypes", "explosiongenerator0"]).as_deref(),
        Some("custom:damage_fire")
    );
    assert_eq!(
        value(&tree, &["unitinfo", "customparams", "cost"]).as_deref(),
        Some("200")
    );
}

#[test]
fn reads_values_as_the_engine_does() {
    let text = "a = \"x;y\" ;;\nb=one two ;\nc=;\n/* block\ncomment */ d=1; // tail\nD=2;\n";
    let tree = parse(text).unwrap().tree();
    assert_eq!(value(&tree, &["a"]).as_deref(), Some("x;y"));
    assert_eq!(value(&tree, &["b"]).as_deref(), Some("one two "));
    assert_eq!(value(&tree, &["c"]).as_deref(), Some(""));
    // A later key of the same name replaces an earlier one.
    assert_eq!(value(&tree, &["d"]).as_deref(), Some("2"));
}

#[test]
fn refuses_what_the_engine_refuses() {
    for bad in [
        "a=1\n",
        "[s]\n{\n a=1;\n",
        "[s] a=1;",
        "a=1; }",
        "[]{ }",
        "= 1;",
    ] {
        assert!(parse(bad).is_err(), "{bad:?} parsed");
    }
}

#[test]
fn replaces_a_value_and_nothing_else() {
    let change = set(DAGGER, &["UNITINFO", "MaxDamage"], "700").unwrap();
    assert!(change.changed);
    assert_eq!(
        change.text,
        DAGGER.replacen("MaxDamage=650", "MaxDamage=700", 1)
    );
    assert_eq!(&DAGGER[change.start..change.end], "650");
}

#[test]
fn matches_keys_and_sections_without_regard_to_case() {
    let change = set(DAGGER, &["unitinfo", "customparams", "COST"], "250").unwrap();
    assert_eq!(change.text, DAGGER.replacen("cost=200", "cost=250", 1));
}

#[test]
fn the_same_value_changes_nothing() {
    let change = set(DAGGER, &["unitinfo", "maxdamage"], "650").unwrap();
    assert!(!change.changed);
    assert_eq!(change.text, DAGGER);
}

#[test]
fn a_new_key_goes_after_the_last_key_in_its_section() {
    let change = set(DAGGER, &["unitinfo", "cloakcost"], "10").unwrap();
    assert_eq!(
        change.text,
        DAGGER.replacen(
            "\tWeapon1=KLight;\n",
            "\tWeapon1=KLight;\n\tcloakcost=10;\n",
            1
        )
    );
    let change = set(
        DAGGER,
        &["unitinfo", "sfxtypes", "explosiongenerator1"],
        "custom:x",
    )
    .unwrap();
    assert!(change.text.contains(
        "\t\texplosiongenerator0 = custom:damage_fire;\n\t\texplosiongenerator1 = custom:x;\n\t}"
    ));
}

#[test]
fn a_new_key_keeps_windows_line_endings() {
    let text = "[UNITINFO]\r\n{\r\n\tname=Arm;\r\n\tMaxDamage=3500;\r\n}\r\n";
    let change = set(text, &["unitinfo", "cloakcost"], "10").unwrap();
    assert_eq!(
        change.text,
        "[UNITINFO]\r\n{\r\n\tname=Arm;\r\n\tMaxDamage=3500;\r\n\tcloakcost=10;\r\n}\r\n"
    );
}

#[test]
fn a_new_key_stays_inside_a_section_closed_on_the_same_line() {
    let text = "[UNITINFO] { a=1; }\n";
    let change = set(text, &["unitinfo", "b"], "2").unwrap();
    assert_eq!(change.text, "[UNITINFO] { a=1; b=2; }\n");
    let text = "[UNITINFO]\n{\n\ta=1; [sub] { x=1; }\n}\n";
    let change = set(text, &["unitinfo", "b"], "2").unwrap();
    assert_eq!(
        change.text,
        "[UNITINFO]\n{\n\ta=1; b=2; [sub] { x=1; }\n}\n"
    );
}

#[test]
fn a_new_key_in_a_section_with_no_keys() {
    let text = "[UNITINFO]\n{\n\t[customParams]\n\t{\n\t}\n}\n";
    let change = set(text, &["unitinfo", "customparams", "cost"], "5").unwrap();
    assert_eq!(
        change.text,
        "[UNITINFO]\n{\n\t[customParams]\n\t{\n\t\tcost=5;\n\t}\n}\n"
    );
    let change = set(text, &["unitinfo", "cost"], "5").unwrap();
    assert_eq!(
        change.text,
        "[UNITINFO]\n{\n\tcost=5;\n\t[customParams]\n\t{\n\t}\n}\n"
    );
}

#[test]
fn quotes_a_value_only_when_it_needs_them_or_had_them() {
    let change = set(DAGGER, &["unitinfo", "name"], "Dagger; Mk2").unwrap();
    assert!(change.text.contains("\tName=\"Dagger; Mk2\";\n"));
    let text = "[UNITINFO] { name=\"Dagger\"; }";
    let change = set(text, &["unitinfo", "name"], "Knife").unwrap();
    assert_eq!(change.text, "[UNITINFO] { name=\"Knife\"; }");
    assert!(matches!(
        set(DAGGER, &["unitinfo", "name"], "a\nb"),
        Err(SetError::InvalidValue(_))
    ));
    assert!(matches!(
        set(DAGGER, &["unitinfo", "name"], "\"a;b\""),
        Err(SetError::InvalidValue(_))
    ));
}

#[test]
fn refuses_a_key_written_twice_a_missing_section_and_a_section_as_a_value() {
    let text = "[UNITINFO] { MaxDamage=1; maxdamage=2; }";
    assert!(matches!(
        set(text, &["unitinfo", "maxdamage"], "3"),
        Err(SetError::KeyAmbiguous { .. })
    ));
    assert!(matches!(
        set(DAGGER, &["unitinfo", "weapons", "x"], "3"),
        Err(SetError::SectionMissing { .. })
    ));
    assert!(matches!(
        set(DAGGER, &["unitinfo", "customparams"], "3"),
        Err(SetError::NotAValue { .. })
    ));
    assert!(matches!(
        set(DAGGER, &["unitinfo", "name", "x"], "3"),
        Err(SetError::NotASection { .. })
    ));
    assert!(matches!(
        set(
            "[UNITINFO] { a=1; } [UNITINFO] { a=2; }",
            &["unitinfo", "a"],
            "3"
        ),
        Err(SetError::SectionAmbiguous { .. })
    ));
}

#[test]
fn the_post_check_catches_a_new_key_swallowed_by_a_comment() {
    // The last key's line ends inside a block comment, so a key put after
    // that line would be commented out.
    let text = "[UNITINFO]\n{\n\ta=1; /* note\n\tb=2; */\n}\n";
    assert!(matches!(
        set(text, &["unitinfo", "c"], "3"),
        Err(SetError::PostCheck(_))
    ));
}

#[test]
fn latin1_text_goes_back_as_the_same_bytes() {
    let bytes = b"[UNITINFO] { copyright=\xa9 1997; }".to_vec();
    let (text, encoding) = decode(&bytes);
    assert_eq!(encoding, Encoding::Latin1);
    let change = set(&text, &["unitinfo", "cost"], "5").unwrap();
    let back = encoding.encode(&change.text).unwrap();
    assert_eq!(
        back,
        b"[UNITINFO] { copyright=\xa9 1997; cost=5; }".to_vec()
    );
    assert_eq!(Encoding::Latin1.encode("\u{263a}"), None);
}
