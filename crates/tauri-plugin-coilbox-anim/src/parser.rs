//! Parser — a port of the generic recursive-descent driver in `bos2cob_py3.py`
//! (`Node` L323, `Pump` L1100, `parse`/`try_parse` L1144-1193). It is grammar-
//! table driven (see `grammar.rs`): each rule is a tuple of alternatives, first
//! match wins, with `~` (zero-or-more) and `?` (optional) child suffixes, and
//! pump-rewind backtracking on failure.

use crate::grammar;

/// Maximum grammar-rule nesting depth. Real scripts nest only a handful of
/// levels; this is a backstop so pathological input (e.g. thousands of nested
/// parentheses, or a runaway from unbalanced brackets) surfaces as an error
/// instead of overflowing the stack and aborting the process.
const MAX_DEPTH: usize = 1024;

/// A parse-tree node. `text` is `None` for rule nodes, whose text is the
/// concatenation of their children's text (`get_text`) — load-bearing for
/// multi-token operators (`==`) and names.
#[derive(Debug, Clone)]
pub struct Node {
    pub ntype: String,
    pub text: Option<String>,
    pub children: Vec<Node>,
}

impl Node {
    pub fn new(ntype: &str) -> Node {
        Node {
            ntype: ntype.to_string(),
            text: None,
            children: Vec::new(),
        }
    }

    fn leaf(ntype: &str, text: String) -> Node {
        Node {
            ntype: ntype.to_string(),
            text: Some(text),
            children: Vec::new(),
        }
    }

    /// `Node.get_text()` — own text, else concatenation of children's text.
    pub fn get_text(&self) -> String {
        match &self.text {
            Some(t) => t.clone(),
            None => self.children.iter().map(|c| c.get_text()).collect(),
        }
    }
}

/// Token cursor with backtracking (`Pump`). `next()` returns `""` past the end.
pub struct Pump {
    tokens: Vec<String>,
    index: usize,
    max_index: usize,
    /// Set when parsing recursed past `MAX_DEPTH`; surfaced as a clear error.
    depth_exceeded: bool,
}

impl Pump {
    pub fn new(tokens: Vec<String>) -> Pump {
        Pump {
            tokens,
            index: 0,
            max_index: 0,
            depth_exceeded: false,
        }
    }

    fn next(&mut self) -> String {
        if self.index < self.tokens.len() {
            let token = self.tokens[self.index].clone();
            self.index += 1;
            self.max_index = self.max_index.max(self.index);
            token
        } else {
            String::new()
        }
    }

    fn get_index(&self) -> usize {
        self.index
    }

    fn update(&mut self, result: bool, index: usize) {
        if !result {
            self.index = index;
        }
    }
}

fn parse_int(pump: &mut Pump, node: &mut Node) -> bool {
    let token = pump.next();
    if token.is_empty() {
        return false;
    }
    if let Some(hex) = token.strip_prefix("0x") {
        return match i64::from_str_radix(hex, 16) {
            Ok(v) => {
                node.children.push(Node::leaf("integerConstant", v.to_string()));
                true
            }
            Err(_) => false,
        };
    }
    if token.chars().all(|c| c.is_ascii_digit()) {
        node.children.push(Node::leaf("integerConstant", token));
        return true;
    }
    false
}

fn parse_float(pump: &mut Pump, node: &mut Node) -> bool {
    let token = pump.next();
    if token.is_empty() {
        return false;
    }
    if token.matches('.').count() > 1 {
        return false;
    }
    let stripped: String = token.chars().filter(|&c| c != '.').collect();
    if !stripped.is_empty() && stripped.chars().all(|c| c.is_ascii_digit()) {
        node.children.push(Node::leaf("floatConstant", token));
        return true;
    }
    false
}

fn parse_string(pump: &mut Pump, node: &mut Node) -> bool {
    let token = pump.next();
    if token.is_empty() {
        return false;
    }
    if token.starts_with('"') {
        node.children
            .push(Node::leaf("stringConstant", token.trim_matches('"').to_string()));
        return true;
    }
    false
}

fn parse_identifier(pump: &mut Pump, node: &mut Node) -> bool {
    let token = pump.next();
    if token.is_empty() {
        return false;
    }
    let first = token.chars().next().unwrap();
    if first.is_ascii_alphabetic() || first == '_' {
        node.children.push(Node::leaf("identifier", token));
        return true;
    }
    false
}

/// `parse(pump, node, block_type, depth)` — atom, terminal, or grammar rule.
/// `depth` bounds recursion (see `MAX_DEPTH`).
fn parse(pump: &mut Pump, node: &mut Node, block_type: &str, depth: usize) -> bool {
    if pump.depth_exceeded {
        return false;
    }
    if depth > MAX_DEPTH {
        pump.depth_exceeded = true;
        return false;
    }
    match block_type {
        "_integerConstant" => return parse_int(pump, node),
        "_floatConstant" => return parse_float(pump, node),
        "_stringConstant" => return parse_string(pump, node),
        "_identifier" => return parse_identifier(pump, node),
        _ => {}
    }

    let lower = block_type.to_lowercase();
    if grammar::KEYWORDS.contains(&lower.as_str()) {
        let next = pump.next();
        if next.to_lowercase() == lower {
            node.children.push(Node::leaf("keyword", next));
            return true;
        }
        return false;
    }
    if grammar::SYMBOLS.contains(&lower.as_str()) {
        let next = pump.next();
        if next.to_lowercase() == lower {
            node.children.push(Node::leaf("symbol", next));
            return true;
        }
        return false;
    }

    let alternatives = grammar::rule(block_type)
        .unwrap_or_else(|| panic!("grammar: unknown rule {block_type}"));
    let node_type = block_type.trim_matches(|c| c == '?' || c == '%' || c == '_');
    let mut current = Node::new(node_type);

    for alternative in alternatives {
        let mut alternative_correct = true;
        let index = pump.get_index();
        for child_type in *alternative {
            let multiple = child_type.ends_with('~');
            let maybe = multiple || child_type.ends_with('?');
            let base = child_type.trim_end_matches(['?', '~']);

            let mut result = false;
            let mut first = true;
            while first || multiple {
                first = false;
                let before = pump.get_index();
                result = try_parse(pump, &mut current, base, depth + 1);
                if !result {
                    break;
                }
                // A zero-width match would loop forever under `~`; take it once.
                if pump.get_index() == before {
                    break;
                }
            }
            if !(result || maybe) {
                alternative_correct = false;
                break;
            }
        }
        if alternative_correct {
            node.children.push(current);
            return true;
        }
        pump.update(false, index);
        current.children.clear();
    }
    false
}

fn try_parse(pump: &mut Pump, node: &mut Node, block_type: &str, depth: usize) -> bool {
    let index = pump.get_index();
    let result = parse(pump, node, block_type, depth);
    pump.update(result, index);
    result
}

/// Parse a token stream into the `root` node (`try_parse(_file)`), erroring on
/// leftover tokens like the reference's syntax-error path.
pub fn parse_file(tokens: Vec<String>) -> Result<Node, String> {
    let mut pump = Pump::new(tokens);
    let mut root = Node::new("root");
    try_parse(&mut pump, &mut root, "_file", 0);
    if pump.depth_exceeded {
        return Err(
            "script nesting is too deep (check for unbalanced or runaway parentheses/brackets)"
                .to_string(),
        );
    }
    let leftover = pump.next();
    if !leftover.is_empty() {
        return Err(format!("syntax error near token: {leftover}"));
    }
    Ok(root)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tokenizer::tokenize;

    fn find<'a>(node: &'a Node, ntype: &str) -> Option<&'a Node> {
        if node.ntype == ntype {
            return Some(node);
        }
        node.children.iter().find_map(|c| find(c, ntype))
    }

    #[test]
    fn parses_min_bos_structure() {
        let root = parse_file(tokenize(include_str!("../tests/fixtures/min.bos"))).unwrap();
        // Two function declarations and one static var.
        let file = find(&root, "file").unwrap();
        let func_count = file
            .children
            .iter()
            .filter(|d| d.children.first().map(|c| c.ntype == "funcDec").unwrap_or(false))
            .count();
        assert_eq!(func_count, 2, "{root:#?}");
        assert!(find(&root, "staticVarDec").is_some());
        assert!(find(&root, "ifStatement").is_some());
        assert!(find(&root, "explodeStatement").is_some());
    }

    #[test]
    fn reassembles_multi_char_operator_text() {
        // `a == b` -> an `op` node whose get_text concatenates the two `=` tokens.
        let root = parse_file(tokenize("F(){ x = a == b; }")).unwrap();
        let op = find(&root, "op").expect("op node");
        assert_eq!(op.get_text(), "==");
    }

    #[test]
    fn rejects_leftover_tokens() {
        let err = parse_file(tokenize("piece p; zzz")).unwrap_err();
        assert!(err.contains("syntax error"), "{err}");
    }
}
