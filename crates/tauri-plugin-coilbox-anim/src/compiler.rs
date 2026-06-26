//! Codegen — a port of `Compiler` (bos2cob_py3.py L699-1097). Walks the (folded)
//! parse tree and emits the COB instruction stream, then hands it to the COB
//! container writer (`cob::encode`).
//!
//! Byte-exactness landmines handled here (see PORTING.md §7):
//! - plain constants use Python `round()` (ties-to-even), bracket constants use
//!   `int()` truncation;
//! - a function gets a trailing `RETURN` only if it doesn't already end in one;
//! - `keywordStatement` reverses its children (except `set`/`attach-unit`) and
//!   then reverses the collected int operands again — net declared order;
//! - if/while jump targets are absolute word offsets into the whole script-code
//!   stream, back-patched by overwriting a 4-byte placeholder.

use crate::cob;
use crate::opcodes::opcode;
use crate::parser::Node;
use std::collections::HashMap;

const AXES: [&str; 3] = ["x", "y", "z"];
const IGNORED_SYMBOLS: [&str; 6] = [";", "(", ")", "{", "}", ","];
const IGNORED_KEYWORDS: [&str; 2] = ["accelerate", "decelerate"];

/// Case-insensitive `list.index(s)` returning `None` when absent.
fn index_of(haystack: &[String], needle: &str) -> Option<usize> {
    let n = needle.to_lowercase();
    haystack.iter().position(|v| v.to_lowercase() == n)
}

fn op_bytes(name: &str) -> [u8; 4] {
    opcode(name)
        .unwrap_or_else(|| panic!("unknown opcode {name}"))
        .to_le_bytes()
}

fn get_num(n: i64) -> [u8; 4] {
    (n as u32).to_le_bytes()
}

fn get_signed_num(n: i64) -> [u8; 4] {
    (n as i32).to_le_bytes()
}

pub struct Compiler {
    static_vars: Vec<String>,
    local_vars: Vec<String>,
    pieces: Vec<String>,
    functions: Vec<String>,
    code: Vec<u8>,
    total_offset: u32,
    functions_code: HashMap<String, Vec<u8>>,
    cob_version: u32,
}

impl Compiler {
    /// Compile a parsed (and folded) `root` node to COB bytes.
    pub fn compile(root: &Node, cob_version: u32) -> Result<Vec<u8>, String> {
        let mut c = Compiler {
            static_vars: Vec::new(),
            local_vars: Vec::new(),
            pieces: Vec::new(),
            functions: Vec::new(),
            code: Vec::new(),
            total_offset: 0,
            functions_code: HashMap::new(),
            cob_version,
        };
        c.parse(root)?;
        Ok(cob::encode(
            &c.functions,
            &c.functions_code,
            &c.pieces,
            &c.static_vars,
            c.cob_version,
        ))
    }

    fn current_offset(&self) -> u32 {
        self.total_offset + self.code.len() as u32 / 4
    }

    fn emit(&mut self, bytes: &[u8]) {
        self.code.extend_from_slice(bytes);
    }

    fn parse(&mut self, node: &Node) -> Result<(), String> {
        match node.ntype.as_str() {
            "file" => self.parse_file(node),
            "staticVarDec" => self.parse_static_var_dec(node),
            "pieceDec" => self.parse_piece_dec(node),
            "funcDec" => self.parse_func_dec(node),
            "arguments" => self.parse_arguments(node),
            "assignStatement" => self.parse_assign_statement(node),
            "incStatement" => self.parse_inc_dec_statement(node, "ADD"),
            "decStatement" => self.parse_inc_dec_statement(node, "SUB"),
            "keywordStatement" => self.parse_keyword_statement(node),
            "varStatement" => self.parse(&node.children[1]),
            "rand" => self.parse_rand(node),
            "get" => self.parse_get(node),
            "ifStatement" => self.parse_if_statement(node),
            "whileStatement" => self.parse_while_statement(node),
            "term" => self.parse_term(node),
            "unaryOp" => self.parse_unary_op(node),
            "constant" => self.parse_constant(node),
            "expression" => self.parse_expression(node),
            "symbol" => self.parse_symbol(node),
            "keyword" => self.parse_keyword(node),
            _ => self.parse_children(node),
        }
    }

    fn parse_children(&mut self, node: &Node) -> Result<(), String> {
        if node.children.is_empty() {
            return Err(format!(
                "node not handled {}: {}",
                node.ntype,
                node.get_text()
            ));
        }
        for child in &node.children {
            self.parse(child)?;
        }
        Ok(())
    }

    fn parse_file(&mut self, node: &Node) -> Result<(), String> {
        for decl in &node.children {
            if let Some(first) = decl.children.first() {
                if first.ntype == "funcDec" {
                    let name = first.children[0].get_text();
                    if self.functions.contains(&name) {
                        return Err(format!(
                            "Function {name} already defined. Multiple definitions are not allowed!"
                        ));
                    }
                    self.functions.push(name);
                }
            }
        }
        self.parse_children(node)
    }

    fn parse_static_var_dec(&mut self, node: &Node) -> Result<(), String> {
        let name = node.children[3].get_text();
        self.push_static(name)?;
        for comma_var in &node.children[4..] {
            if comma_var.ntype == "commaVar" {
                self.push_static(comma_var.children[1].get_text())?;
            }
        }
        Ok(())
    }

    fn push_static(&mut self, name: String) -> Result<(), String> {
        if self.static_vars.contains(&name) {
            return Err(format!(
                "Static-var {name} already exists. Multiple definitions are not allowed!"
            ));
        }
        self.static_vars.push(name);
        Ok(())
    }

    fn parse_piece_dec(&mut self, node: &Node) -> Result<(), String> {
        let name = node.children[1].get_text();
        self.push_piece(name)?;
        for comma_piece in &node.children[2..] {
            if comma_piece.ntype == "commaPiece" {
                self.push_piece(comma_piece.children[1].get_text())?;
            }
        }
        Ok(())
    }

    fn push_piece(&mut self, name: String) -> Result<(), String> {
        if self.pieces.contains(&name) {
            return Err(format!(
                "Piece name {name} already exists. Multiple definitions are not allowed!"
            ));
        }
        self.pieces.push(name);
        Ok(())
    }

    fn parse_func_dec(&mut self, node: &Node) -> Result<(), String> {
        self.local_vars.clear();
        self.code = Vec::new();
        if !node.children[2].children.is_empty() {
            self.parse(&node.children[2])?; // argumentList
        }
        let code_len = self.code.len();
        self.parse(&node.children[4])?; // statementBlock

        // Empty body: discard any args-only code (matches the reference quirk).
        if self.code.len() == code_len {
            self.code = Vec::new();
        }

        // Append RETURN unless the body already ends in one.
        let ret = op_bytes("RETURN");
        let ends_with_return = self.code.len() >= 4 && self.code[self.code.len() - 4..] == ret;
        if !ends_with_return {
            self.emit(&op_bytes("PUSH_CONSTANT"));
            self.emit(&get_num(0));
            self.emit(&ret);
        }

        self.total_offset += self.code.len() as u32 / 4;
        let name = node.children[0].get_text();
        self.functions_code
            .insert(name, std::mem::take(&mut self.code));
        Ok(())
    }

    fn parse_arguments(&mut self, node: &Node) -> Result<(), String> {
        if node.children.is_empty() {
            return Ok(());
        }
        self.push_local(node.children[0].get_text())?;
        self.emit(&op_bytes("CREATE_LOCAL_VAR"));
        for comma_var in &node.children[1..] {
            if comma_var.ntype == "commaVar" {
                self.push_local(comma_var.children[1].get_text())?;
                self.emit(&op_bytes("CREATE_LOCAL_VAR"));
            }
        }
        Ok(())
    }

    fn push_local(&mut self, name: String) -> Result<(), String> {
        if self.static_vars.contains(&name) {
            return Err(format!(
                "Static-var named \"{name}\" already exists. You cannot reuse the same name as local variable or function argument!"
            ));
        }
        if self.local_vars.contains(&name) {
            return Err(format!(
                "Local-var named \"{name}\" already exists. Multiple definitions are not allowed!"
            ));
        }
        self.local_vars.push(name);
        Ok(())
    }

    fn parse_assign_statement(&mut self, node: &Node) -> Result<(), String> {
        if node.children.len() < 3 {
            return self.parse_children(node);
        }
        self.parse(&node.children[2])?; // RHS expression
        let pop = self.get_variable(&node.children[0].get_text(), false)?;
        self.emit(&pop);
        Ok(())
    }

    fn parse_inc_dec_statement(&mut self, node: &Node, op: &str) -> Result<(), String> {
        let name = node.children[2].get_text();
        let push = self.get_variable(&name, true)?;
        self.emit(&push);
        self.emit(&op_bytes("PUSH_CONSTANT"));
        self.emit(&get_num(1));
        self.emit(&op_bytes(op));
        let pop = self.get_variable(&name, false)?;
        self.emit(&pop);
        Ok(())
    }

    fn parse_keyword_statement(&mut self, node: &Node) -> Result<(), String> {
        let node = &node.children[0]; // unwrap inner statement (hideStatement, …)

        // get-as-statement: evaluate then discard the result.
        if !node.children[0].children.is_empty() && node.children[0].children[0].get_text() == "get"
        {
            self.parse(node)?;
            self.emit(&op_bytes("POP_STACK"));
            return Ok(());
        }

        // Rebuild a hyphenated keyword from `-` joiners (e.g. set-signal-mask).
        let mut keyword = node.children[0].get_text();
        let mut i = 0usize;
        while node
            .children
            .get(i + 1)
            .map(|c| c.get_text() == "-")
            .unwrap_or(false)
        {
            keyword += &format!("-{}", node.children[i + 2].get_text());
            i += 2;
        }

        // Declared order for set/attach-unit; reversed otherwise.
        let children: Vec<&Node> = if keyword == "set" || keyword == "attach-unit" {
            node.children.iter().collect()
        } else {
            node.children.iter().rev().collect()
        };

        let mut arguments: Vec<i64> = Vec::new();
        for child in children {
            match child.ntype.as_str() {
                "pieceName" => {
                    let name = child.get_text();
                    let idx = index_of(&self.pieces, &name)
                        .ok_or_else(|| format!("Piece not found: {name}"))?;
                    arguments.push(idx as i64);
                }
                "funcName" => {
                    let name = child.get_text();
                    let idx = index_of(&self.functions, &name)
                        .ok_or_else(|| format!("Function not found: {name}"))?;
                    arguments.push(idx as i64);
                }
                "axis" => {
                    let letter = child.children[0].get_text();
                    let idx = AXES
                        .iter()
                        .position(|a| *a == letter)
                        .ok_or_else(|| format!("Unknown axis: {letter}"))?;
                    arguments.push(idx as i64);
                }
                "expression" => self.parse(child)?,
                "expressionList" => {
                    if !child.children.is_empty() {
                        self.parse(&child.children[0])?;
                        arguments.push(child.children[0].children.len() as i64);
                    } else {
                        arguments.push(0);
                    }
                }
                "speedNow" => {
                    if child.children[0].get_text() == "now" {
                        keyword += "-now";
                    } else {
                        self.parse(&child.children[1])?;
                    }
                }
                t if t.starts_with("optional") => {
                    if child.children.is_empty() {
                        self.emit(&op_bytes("PUSH_CONSTANT"));
                        self.emit(&get_num(0));
                    } else {
                        self.parse_children(child)?;
                    }
                }
                _ => {}
            }
        }

        if keyword == "attach-unit" {
            self.emit(&op_bytes("PUSH_CONSTANT"));
            self.emit(&get_num(0));
        }

        let opcode_name = keyword.to_uppercase().replace('-', "_");
        let opcode = opcode(&opcode_name)
            .ok_or_else(|| format!("Unhandled keyword {keyword} {opcode_name}"))?;
        self.emit(&opcode.to_le_bytes());
        // int operands reversed again -> net declared order
        for arg in arguments.iter().rev() {
            self.emit(&get_num(*arg));
        }
        Ok(())
    }

    fn parse_rand(&mut self, node: &Node) -> Result<(), String> {
        self.parse(&node.children[2])?;
        self.parse(&node.children[4])?;
        self.emit(&op_bytes("RAND"));
        Ok(())
    }

    fn parse_get(&mut self, node: &Node) -> Result<(), String> {
        let mut num_expressions = 0;
        for child in &node.children[1..] {
            match child.ntype.as_str() {
                "expression" | "term" => {
                    self.parse(child)?;
                    num_expressions += 1;
                }
                t if t.starts_with("optional") => {
                    num_expressions += 1;
                    if child.children.is_empty() {
                        self.emit(&op_bytes("PUSH_CONSTANT"));
                        self.emit(&get_num(0));
                    } else {
                        self.parse_children(child)?;
                    }
                }
                _ => {}
            }
        }
        if num_expressions == 1 {
            self.emit(&op_bytes("GET_UNIT_VALUE"));
        } else {
            self.emit(&op_bytes("GET"));
        }
        Ok(())
    }

    fn parse_if_statement(&mut self, node: &Node) -> Result<(), String> {
        let has_else = node.children.len() > 5;
        self.parse(&node.children[2])?; // condition
        self.emit(&op_bytes("JUMP_NOT_EQUAL"));
        let condition_jump = self.code.len();
        self.emit(&get_num(0)); // placeholder
        self.parse(&node.children[4])?; // then-block

        let mut else_jump = 0usize;
        if has_else {
            self.emit(&op_bytes("JUMP"));
            else_jump = self.code.len();
            self.emit(&get_num(0)); // placeholder
        }

        let target = self.current_offset();
        self.code[condition_jump..condition_jump + 4].copy_from_slice(&get_num(target as i64));

        if has_else {
            self.parse(&node.children[5].children[1])?; // else-block
            let target = self.current_offset();
            self.code[else_jump..else_jump + 4].copy_from_slice(&get_num(target as i64));
        }
        Ok(())
    }

    fn parse_while_statement(&mut self, node: &Node) -> Result<(), String> {
        let start = self.current_offset();
        self.parse(&node.children[2])?; // condition
        self.emit(&op_bytes("JUMP_NOT_EQUAL"));
        let condition_jump = self.code.len();
        self.emit(&get_num(0)); // placeholder
        self.parse(&node.children[4])?; // body
        self.emit(&op_bytes("JUMP"));
        self.emit(&get_num(start as i64));
        let target = self.current_offset();
        self.code[condition_jump..condition_jump + 4].copy_from_slice(&get_num(target as i64));
        Ok(())
    }

    fn parse_expression(&mut self, node: &Node) -> Result<(), String> {
        self.parse(&node.children[0])?;
        if node.children.len() == 1 {
            return Ok(());
        }
        let mut op_stack: Vec<String> = Vec::new();
        for op_term in &node.children[1..] {
            let op = op_term.children[0].get_text();
            while let Some(top) = op_stack.last() {
                if precedence(top) <= precedence(&op) {
                    let popped = op_stack.pop().unwrap();
                    self.emit(&ops_opcode(&popped));
                } else {
                    break;
                }
            }
            self.parse(&op_term.children[1])?;
            op_stack.push(op);
        }
        while let Some(popped) = op_stack.pop() {
            self.emit(&ops_opcode(&popped));
        }
        Ok(())
    }

    fn parse_term(&mut self, node: &Node) -> Result<(), String> {
        match node.children[0].ntype.as_str() {
            "unaryOp" => {
                self.parse(&node.children[1])?;
                self.parse(&node.children[0])?;
                Ok(())
            }
            "varName" => {
                let push = self.get_variable(&node.children[0].get_text(), true)?;
                self.emit(&push);
                Ok(())
            }
            _ => self.parse_children(node),
        }
    }

    fn parse_constant(&mut self, node: &Node) -> Result<(), String> {
        self.emit(&op_bytes("PUSH_CONSTANT"));
        let value: i64 = if node.children.len() == 1 {
            let text = node.get_text();
            let f: f64 = text.parse().map_err(|_| format!("bad constant: {text}"))?;
            f.round_ties_even() as i64
        } else {
            let inner: f64 = node.children[1]
                .get_text()
                .parse()
                .map_err(|_| format!("bad constant: {}", node.get_text()))?;
            match node.children[0].get_text().as_str() {
                "[" => (crate::fold::LINEAR_SCALE as f64 * inner) as i64,
                "<" => (crate::fold::ANGULAR_SCALE as f64 * inner) as i64,
                other => return Err(format!("Unhandled fancy number: {other}")),
            }
        };
        if value < 0 {
            self.emit(&get_signed_num(value));
        } else {
            self.emit(&get_num(value));
        }
        Ok(())
    }

    fn parse_unary_op(&mut self, node: &Node) -> Result<(), String> {
        let text = node.get_text();
        let opcode_name = match text.as_str() {
            "NOT" | "!" => "LOGICAL_NOT",
            other => return Err(format!("Unhandled unary op: {other}")),
        };
        self.emit(&op_bytes(opcode_name));
        Ok(())
    }

    fn parse_symbol(&mut self, node: &Node) -> Result<(), String> {
        let symbol = node.get_text();
        if !IGNORED_SYMBOLS.contains(&symbol.as_str()) {
            return Err(format!("Unhandled symbol {symbol}"));
        }
        Ok(())
    }

    fn parse_keyword(&mut self, node: &Node) -> Result<(), String> {
        let keyword = node.get_text();
        if !IGNORED_KEYWORDS.contains(&keyword.as_str()) {
            return Err(format!("Unhandled keyword {keyword}"));
        }
        Ok(())
    }

    fn get_variable(&self, name: &str, push: bool) -> Result<Vec<u8>, String> {
        let table: &[(&[String], &str)] = if push {
            &[
                (&self.local_vars, "PUSH_LOCAL_VAR"),
                (&self.static_vars, "PUSH_STATIC"),
                (&self.pieces, "PUSH_CONSTANT"),
            ]
        } else {
            &[
                (&self.local_vars, "POP_LOCAL_VAR"),
                (&self.static_vars, "POP_STATIC"),
            ]
        };
        for (vars, op) in table {
            if let Some(i) = index_of(vars, name) {
                let mut bytes = op_bytes(op).to_vec();
                bytes.extend_from_slice(&get_num(i as i64));
                return Ok(bytes);
            }
        }
        Err(format!("Var not found: {name}"))
    }
}

/// `OPS_PRECEDENCE` (bos2cob_py3.py L256-281). Lower = higher precedence.
fn precedence(op: &str) -> u8 {
    match op {
        "*" | "/" | "%" => 1,
        "+" | "-" => 2,
        "<" | ">" | "<=" | ">=" => 3,
        "==" | "!=" => 4,
        "&" => 5,
        "^" => 6,
        "|" => 7,
        "&&" | "AND" | "and" => 8,
        "||" | "OR" | "or" => 9,
        "^^" | "XOR" | "xor" => 10,
        _ => panic!("unknown operator precedence: {op}"),
    }
}

/// `OPS` (bos2cob_py3.py L217-241) — operator text to opcode bytes.
fn ops_opcode(op: &str) -> [u8; 4] {
    let name = match op {
        "+" => "ADD",
        "-" => "SUB",
        "*" => "MUL",
        "/" => "DIV",
        "%" => "MOD",
        "&" => "BITWISE_AND",
        "|" => "BITWISE_OR",
        "^" => "BITWISE_XOR",
        "<" => "SET_LESS",
        ">" => "SET_GREATER",
        "==" => "SET_EQUAL",
        "<=" => "SET_LESS_OR_EQUAL",
        ">=" => "SET_GREATER_OR_EQUAL",
        "!=" => "SET_NOT_EQUAL",
        "&&" | "AND" | "and" => "LOGICAL_AND",
        "||" | "OR" | "or" => "LOGICAL_OR",
        "^^" | "XOR" | "xor" => "LOGICAL_XOR",
        other => panic!("unknown operator: {other}"),
    };
    op_bytes(name)
}
