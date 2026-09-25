//! Finding the text to change. Parses the file, follows the returned table to
//! the unit, walks the path, and turns the edit into splices over the
//! original text.

use std::collections::HashMap;

use full_moon::ast::punctuated::Pair;
use full_moon::ast::{
    Call, Expression, Field, FunctionArgs, Index, LastStmt, Prefix, Stmt, Suffix, TableConstructor,
    UnOp, Var,
};
use full_moon::node::Node;
use full_moon::tokenizer::{StringLiteralQuoteType, TokenReference, TokenType};
use full_moon::LuaVersion;

use crate::render::{self, Quote};
use crate::{Edit, Location, Op, Refusal, RefusalKind, Segment, Value};

/// Deepest chain of `local A = B:New{...}` the patcher follows before giving
/// up, so a file where two names refer to each other cannot loop forever.
const MAX_CHAIN: usize = 32;

/// The edit as text changes to the original file.
#[derive(Debug)]
pub struct Plan {
    /// `(start, end, replacement)` byte ranges, sorted and not overlapping.
    splices: Vec<(usize, usize, String)>,
    pub location: Location,
}

impl Plan {
    pub fn apply(&self, source: &str) -> String {
        let mut out = String::with_capacity(source.len() + 64);
        let mut cursor = 0;
        for (start, end, text) in &self.splices {
            out.push_str(&source[cursor..*start]);
            out.push_str(text);
            cursor = *end;
        }
        out.push_str(&source[cursor..]);
        out
    }
}

pub fn plan(source: &str, edit: &Edit) -> Result<Plan, Refusal> {
    let ast = full_moon::parse_fallible(source, LuaVersion::lua51())
        .into_result()
        .map_err(|errors| {
            let first = &errors[0];
            let (start, end) = first.range();
            Refusal::new(
                RefusalKind::Syntax,
                format!("The file is not valid Lua: {}", first.error_message()),
            )
            .at(Location::of(
                source,
                start.bytes(),
                end.bytes().max(start.bytes()),
            ))
        })?;
    let block = ast.nodes();
    let scope = Scope::of(block.stmts());
    let here = |node: &dyn Spanned| {
        let (start, end) = node.span();
        Location::of(source, start, end)
    };

    let returned = match block.last_stmt() {
        Some(LastStmt::Return(ret)) => ret.returns().iter().next(),
        _ => None,
    }
    .ok_or_else(|| {
        Refusal::new(
            RefusalKind::ReturnNotLiteral,
            "The file does not end by returning a table of units.",
        )
    })?;
    let units = returned_table(returned, &scope, source)?;

    let entry = find_unit(units, &edit.unit, &scope, source)?;
    let mut chain = Chain::default();
    follow(entry, &scope, source, &mut chain, 0)?;
    if chain.tables.is_empty() {
        return Err(Refusal::new(
            RefusalKind::UnitComputed,
            format!(
                "`{}` is built entirely from a class defined in another file, so there is no table in this file to edit.",
                edit.unit
            ),
        )
        .at(here(entry)));
    }

    // A value set on the unit's variable after the table is built wins over
    // whatever the table says, so editing the table would change nothing.
    for (name, keys, span) in &scope.later_sets {
        if !chain.names.contains(name) {
            continue;
        }
        let overlap = keys
            .iter()
            .zip(&edit.path)
            .all(|(key, segment)| segment_matches(segment, key));
        if overlap {
            return Err(Refusal::new(
                RefusalKind::FieldComputed,
                format!(
                    "Line {} sets this value again after the unit's table is built, so coilbox will not change it.",
                    Location::of(source, span.0, span.1).start.line
                ),
            )
            .at(Location::of(source, span.0, span.1)));
        }
    }

    let mut candidates = chain.tables;
    let last = edit.path.len() - 1;
    for (depth, segment) in edit.path.iter().enumerate() {
        let is_target = depth == last && matches!(edit.op, Op::Set(_));
        let mut next = Vec::new();
        for table in &candidates {
            let Some(value) = find_field(table, segment, source)? else {
                continue;
            };
            if is_target {
                return replace(source, value, edit);
            }
            match value {
                Expression::TableConstructor(inner) => next.push(inner),
                other if literal(other).is_some() => {
                    return Err(Refusal::new(
                        RefusalKind::NotATable,
                        format!("`{segment}` holds a single value, not a table, so it has no fields."),
                    )
                    .at(here(other)))
                }
                other => {
                    return Err(Refusal::new(
                        RefusalKind::FieldComputed,
                        format!("`{segment}` is worked out by code rather than written out as a table, so coilbox will not edit inside it."),
                    )
                    .at(here(other)))
                }
            }
        }
        if let (true, Op::Set(value)) = (is_target, &edit.op) {
            return append_keyed(source, candidates[0], segment, value);
        }
        if next.is_empty() {
            return Err(Refusal::new(
                RefusalKind::ParentMissing,
                format!("`{segment}` is not in this unit's table, so there is nowhere to put the new value."),
            )
            .at(here(candidates[0])));
        }
        candidates = next;
    }

    // Only a push gets here: the path named the list itself.
    let Op::Push(value) = &edit.op else {
        unreachable!("a set returns inside the loop")
    };
    let list = candidates[0];
    let value = render::literal(value, Quote::Double);
    let fields: Vec<&Field> = list.fields().iter().collect();
    // Beyond All Reason writes its lists with the positions spelled out,
    // `[1] = "armsolar",`, so a list is either that or bare values.
    let numbered = !fields.is_empty()
        && fields.iter().enumerate().all(|(at, field)| {
            matches!(field, Field::ExpressionKey { key: Expression::Number(number), .. }
                if number.token().to_string().parse::<usize>().ok() == Some(at + 1))
        });
    if numbered {
        let position = fields.len() + 1;
        let entry = keyed_entry(source, list, |_| format!("[{position}]"), &value);
        return insert(source, list, entry);
    }
    if fields.iter().all(|field| matches!(field, Field::NoKey(_))) {
        return insert(source, list, value);
    }
    Err(Refusal::new(
        RefusalKind::NotAList,
        "This table has named fields, so it is not a list an entry can be added to.",
    )
    .at(here(list)))
}

/// Anything with a byte range in the source.
trait Spanned {
    fn span(&self) -> (usize, usize);
}

impl<T: Node> Spanned for T {
    fn span(&self) -> (usize, usize) {
        let start = self.start_position().map_or(0, |p| p.bytes());
        let end = self.end_position().map_or(start, |p| p.bytes());
        (start, end)
    }
}

/// What the file's top-level statements bind, read without running it.
#[derive(Default)]
struct Scope<'a> {
    /// Every expression assigned to each top-level name, local or global.
    bindings: HashMap<String, Vec<&'a Expression>>,
    /// Top-level assignments into a name's fields, such as
    /// `unitDef.unitname = unitName`: the name, the keys, and the byte range.
    later_sets: Vec<(String, Vec<String>, (usize, usize))>,
}

impl<'a> Scope<'a> {
    fn of(stmts: impl Iterator<Item = &'a Stmt>) -> Self {
        let mut scope = Scope::default();
        for stmt in stmts {
            match stmt {
                Stmt::LocalAssignment(local) => {
                    for (name, value) in local.names().iter().zip(local.expressions().iter()) {
                        scope.bind(identifier(name), value);
                    }
                }
                Stmt::Assignment(assignment) => {
                    for (var, value) in assignment
                        .variables()
                        .iter()
                        .zip(assignment.expressions().iter())
                    {
                        match var {
                            Var::Name(name) => scope.bind(identifier(name), value),
                            Var::Expression(expression) => {
                                let Prefix::Name(name) = expression.prefix() else {
                                    continue;
                                };
                                let keys: Option<Vec<String>> = expression
                                    .suffixes()
                                    .map(|suffix| match suffix {
                                        Suffix::Index(Index::Dot { name, .. }) => {
                                            Some(identifier(name))
                                        }
                                        Suffix::Index(Index::Brackets { expression, .. }) => {
                                            string_value(expression)
                                        }
                                        _ => None,
                                    })
                                    .collect();
                                if let Some(keys) = keys {
                                    scope.later_sets.push((identifier(name), keys, stmt.span()));
                                }
                            }
                            _ => {}
                        }
                    }
                }
                _ => {}
            }
        }
        scope
    }

    fn bind(&mut self, name: String, value: &'a Expression) {
        self.bindings.entry(name).or_default().push(value);
    }

    /// The one expression `name` is set to, or why there is not one.
    fn single(&self, name: &str) -> Result<Option<&'a Expression>, String> {
        match self.bindings.get(name).map(Vec::as_slice) {
            None | Some([]) => Ok(None),
            Some([value]) => Ok(Some(value)),
            Some(_) => Err(format!(
                "`{name}` is set more than once in this file, so coilbox cannot tell which one the game reads."
            )),
        }
    }
}

fn identifier(token: &TokenReference) -> String {
    match token.token_type() {
        TokenType::Identifier { identifier } => identifier.to_string(),
        _ => token.token().to_string(),
    }
}

/// The text of a string literal, as written between its quotes.
fn string_value(expression: &Expression) -> Option<String> {
    match expression {
        Expression::String(token) => match token.token_type() {
            TokenType::StringLiteral { literal, .. } => Some(literal.to_string()),
            _ => None,
        },
        Expression::Parentheses { expression, .. } => string_value(expression),
        _ => None,
    }
}

/// How a literal value was quoted, if it is a literal the patcher may
/// replace: a number, a string, `true`, `false`, `nil`, or a negated number.
fn literal(expression: &Expression) -> Option<Quote> {
    match expression {
        Expression::Number(_) => Some(Quote::Double),
        Expression::String(token) => match token.token_type() {
            TokenType::StringLiteral {
                quote_type,
                multi_line_depth,
                ..
            } => Some(match quote_type {
                StringLiteralQuoteType::Brackets => Quote::Long(*multi_line_depth),
                StringLiteralQuoteType::Single => Quote::Single,
                _ => Quote::Double,
            }),
            _ => None,
        },
        Expression::Symbol(token) => {
            matches!(token.token().to_string().as_str(), "true" | "false" | "nil")
                .then_some(Quote::Double)
        }
        Expression::UnaryOperator {
            unop: UnOp::Minus(_),
            expression,
        } => matches!(**expression, Expression::Number(_)).then_some(Quote::Double),
        _ => None,
    }
}

/// The table constructor a file's `return` hands back, through the
/// `lowerkeys(...)` call and any local it was stored in.
fn returned_table<'a>(
    expression: &'a Expression,
    scope: &Scope<'a>,
    source: &str,
) -> Result<&'a TableConstructor, Refusal> {
    let mut current = expression;
    for _ in 0..MAX_CHAIN {
        current = match current {
            Expression::TableConstructor(table) => return Ok(table),
            Expression::Parentheses { expression, .. } => expression,
            Expression::FunctionCall(_) => match single_argument_call(current) {
                Some(argument) => argument,
                None => break,
            },
            Expression::Var(Var::Name(name)) => match scope.single(&identifier(name)) {
                Ok(Some(value)) => value,
                _ => break,
            },
            _ => break,
        };
    }
    let (start, end) = current.span();
    Err(Refusal::new(
        RefusalKind::ReturnNotLiteral,
        "The file returns a table built by code, not one written out in the file, so there is no text to edit.",
    )
    .at(Location::of(source, start, end)))
}

/// For `f(x)` or `f{...}` with a plain name as `f`, the single argument.
fn single_argument_call(expression: &Expression) -> Option<&Expression> {
    let Expression::FunctionCall(call) = expression else {
        return None;
    };
    if !matches!(call.prefix(), Prefix::Name(_)) {
        return None;
    }
    let mut suffixes = call.suffixes();
    let (Some(Suffix::Call(Call::AnonymousCall(args))), None) = (suffixes.next(), suffixes.next())
    else {
        return None;
    };
    match args {
        FunctionArgs::Parentheses { arguments, .. } if arguments.len() == 1 => {
            arguments.iter().next()
        }
        _ => None,
    }
}

/// The value the returned table holds for `unit`.
fn find_unit<'a>(
    units: &'a TableConstructor,
    unit: &str,
    scope: &Scope<'a>,
    source: &str,
) -> Result<&'a Expression, Refusal> {
    let mut found: Vec<(&Expression, (usize, usize))> = Vec::new();
    for field in units.fields() {
        let (key, value) = match field {
            Field::NameKey { key, value, .. } => (Some(identifier(key)), value),
            Field::ExpressionKey { key, value, .. } => {
                let name = string_value(key).or_else(|| match key {
                    Expression::Var(Var::Name(name)) => scope
                        .single(&identifier(name))
                        .ok()
                        .flatten()
                        .and_then(string_value),
                    _ => None,
                });
                (name, value)
            }
            _ => continue,
        };
        if key.is_some_and(|key| key.eq_ignore_ascii_case(unit)) {
            found.push((value, field.span()));
        }
    }
    match found.as_slice() {
        [(value, _)] => Ok(value),
        [] => Err(Refusal::new(
            RefusalKind::UnitNotFound,
            format!("This file does not define a unit called `{unit}`."),
        )),
        [_, (_, span), ..] => Err(Refusal::new(
            RefusalKind::UnitAmbiguous,
            format!("`{unit}` is defined more than once in this file."),
        )
        .at(Location::of(source, span.0, span.1))),
    }
}

/// The tables a unit's fields come from, most specific first, and the names
/// they were reached through.
#[derive(Default)]
struct Chain<'a> {
    tables: Vec<&'a TableConstructor>,
    names: Vec<String>,
}

/// Follow a unit's value back to the tables written in the file. Handles a
/// table, a local holding one, and `Parent:New{...}` where `Parent` may be
/// another local built the same way. A parent the file does not define ends
/// the chain: it comes from the game's shared class files.
fn follow<'a>(
    expression: &'a Expression,
    scope: &Scope<'a>,
    source: &str,
    chain: &mut Chain<'a>,
    depth: usize,
) -> Result<(), Refusal> {
    let computed = |node: &dyn Spanned, message: String| {
        let (start, end) = node.span();
        Refusal::new(RefusalKind::UnitComputed, message).at(Location::of(source, start, end))
    };
    if depth > MAX_CHAIN {
        return Err(computed(
            expression,
            "The unit's table is built through too many steps to follow.".into(),
        ));
    }
    match expression {
        Expression::TableConstructor(table) => {
            chain.tables.push(table);
            Ok(())
        }
        Expression::Parentheses { expression, .. } => {
            follow(expression, scope, source, chain, depth + 1)
        }
        Expression::Var(Var::Name(token)) => {
            let name = identifier(token);
            match scope.single(&name) {
                Ok(Some(value)) => {
                    chain.names.push(name);
                    follow(value, scope, source, chain, depth + 1)
                }
                Ok(None) => Err(computed(
                    expression,
                    format!(
                        "`{name}` is not set in this file, so its table cannot be edited here."
                    ),
                )),
                Err(message) => Err(computed(expression, message)),
            }
        }
        Expression::FunctionCall(call) => {
            if let Some(argument) = single_argument_call(expression) {
                return follow(argument, scope, source, chain, depth + 1);
            }
            let mut suffixes = call.suffixes();
            let (Some(Suffix::Call(Call::MethodCall(method))), None, Prefix::Name(parent)) =
                (suffixes.next(), suffixes.next(), call.prefix())
            else {
                return Err(computed(
                    expression,
                    "The unit's table is built by a function call coilbox does not follow.".into(),
                ));
            };
            if identifier(method.name()) != "New" {
                return Err(computed(
                    expression,
                    format!(
                        "The unit is built with `:{}`, which coilbox does not follow. Only `:New` is.",
                        identifier(method.name())
                    ),
                ));
            }
            match method.args() {
                FunctionArgs::TableConstructor(table) => chain.tables.push(table),
                FunctionArgs::Parentheses { arguments, .. } => {
                    let mut arguments = arguments.iter();
                    match (arguments.next(), arguments.next()) {
                        (None, _) => {}
                        (Some(Expression::TableConstructor(table)), None) => {
                            chain.tables.push(table)
                        }
                        _ => {
                            return Err(computed(
                                expression,
                                "`:New` is given something other than one table, so coilbox does not follow it.".into(),
                            ))
                        }
                    }
                }
                _ => {
                    return Err(computed(
                        expression,
                        "`:New` is given a string, so there is no table to edit.".into(),
                    ))
                }
            }
            let name = identifier(parent);
            match scope.single(&name) {
                Ok(Some(value)) => {
                    chain.names.push(name);
                    follow(value, scope, source, chain, depth + 1)
                }
                Ok(None) => Ok(()),
                Err(message) => Err(computed(expression, message)),
            }
        }
        other => Err(computed(
            other,
            "The unit's table is built by code, not written out in the file.".into(),
        )),
    }
}

fn segment_matches(segment: &Segment, key: &str) -> bool {
    match segment {
        Segment::Key(name) => name.eq_ignore_ascii_case(key),
        Segment::Index(index) => key.parse::<usize>().ok() == Some(*index),
    }
}

/// The value `table` holds for `segment`, if it writes one out.
fn find_field<'a>(
    table: &'a TableConstructor,
    segment: &Segment,
    source: &str,
) -> Result<Option<&'a Expression>, Refusal> {
    let mut found: Vec<(&Expression, (usize, usize))> = Vec::new();
    let mut position = 0;
    for field in table.fields() {
        let hit = match (field, segment) {
            (Field::NameKey { key, .. }, Segment::Key(name)) => {
                identifier(key).eq_ignore_ascii_case(name)
            }
            (Field::ExpressionKey { key, .. }, Segment::Key(name)) => {
                string_value(key).is_some_and(|key| key.eq_ignore_ascii_case(name))
            }
            (
                Field::ExpressionKey {
                    key: Expression::Number(number),
                    ..
                },
                Segment::Index(index),
            ) => number.token().to_string().trim().parse::<usize>().ok() == Some(*index),
            (Field::NoKey(_), Segment::Index(index)) => {
                position += 1;
                position == *index
            }
            (Field::NoKey(_), _) => {
                position += 1;
                false
            }
            _ => false,
        };
        if hit {
            let value = match field {
                Field::NameKey { value, .. } | Field::ExpressionKey { value, .. } => value,
                Field::NoKey(value) => value,
                _ => continue,
            };
            found.push((value, field.span()));
        }
    }
    match found.as_slice() {
        [] => Ok(None),
        [(value, _)] => Ok(Some(value)),
        [_, (_, span), ..] => Err(Refusal::new(
            RefusalKind::FieldAmbiguous,
            format!("`{segment}` is written more than once in the same table."),
        )
        .at(Location::of(source, span.0, span.1))),
    }
}

/// Replace a literal value in place.
fn replace(source: &str, value: &Expression, edit: &Edit) -> Result<Plan, Refusal> {
    let (start, end) = value.span();
    let location = Location::of(source, start, end);
    let Some(quote) = literal(value) else {
        return Err(Refusal::new(
            RefusalKind::FieldComputed,
            format!(
                "This value is worked out by code (`{}`), not written as a value, so coilbox will not change it.",
                &source[start..end]
            ),
        )
        .at(location));
    };
    let Op::Set(new) = &edit.op else {
        unreachable!("only a set replaces")
    };
    Ok(Plan {
        splices: vec![(start, end, render::literal(new, quote))],
        location,
    })
}

/// Add `key = value` at the end of `table`.
fn append_keyed(
    source: &str,
    table: &TableConstructor,
    segment: &Segment,
    value: &Value,
) -> Result<Plan, Refusal> {
    let Segment::Key(key) = segment else {
        return Err(Refusal::new(
            RefusalKind::ParentMissing,
            format!("The list has no entry {segment} to change. Add entries to the end of the list instead."),
        )
        .at(Location::of(source, table.span().0, table.span().1)));
    };
    let entry = keyed_entry(
        source,
        table,
        |bracketed| render::key(key, bracketed),
        &render::literal(value, Quote::Double),
    );
    insert(source, table, entry)
}

/// `key = value` spaced like the last keyed field in `table`, so a new field
/// lines up with the ones above it. `key` is told whether that field wrote
/// its key as `["name"]`, so the new one can match.
fn keyed_entry(
    source: &str,
    table: &TableConstructor,
    key: impl FnOnce(bool) -> String,
    value: &str,
) -> String {
    let keyed: Vec<_> = table
        .fields()
        .iter()
        .filter_map(|field: &Field| match field {
            Field::NameKey { key, equal, value } => {
                Some((key.span(), false, equal.span(), value.span()))
            }
            Field::ExpressionKey {
                brackets,
                key: field_key,
                equal,
                value,
            } => Some((
                brackets.span(),
                string_value(field_key).is_some(),
                equal.span(),
                value.span(),
            )),
            _ => None,
        })
        .collect();
    let Some(&(key_span, bracketed, equal_span, value_span)) = keyed.last() else {
        return format!("{} = {value}", key(false));
    };
    let written = key(bracketed);
    // A run of spaces before `=` means the table lines its `=` up in a
    // column. The last field may be the longest key and have only one space,
    // so look for the column on any field.
    let aligned_width = keyed.iter().rev().find_map(|(key_span, _, equal_span, _)| {
        let gap = &source[key_span.1..equal_span.0];
        (gap.len() > 1 && gap.chars().all(|c| c == ' '))
            .then(|| source[key_span.0..equal_span.0].chars().count())
    });
    let before_equal = &source[key_span.1..equal_span.0];
    let gap = match aligned_width {
        Some(width) => " ".repeat(width.saturating_sub(written.chars().count()).max(1)),
        None if before_equal.contains(['\n', '\t']) => " ".to_string(),
        None => before_equal.to_string(),
    };
    let after_equal = &source[equal_span.1..value_span.0];
    let after = if after_equal.contains('\n') {
        " "
    } else {
        after_equal
    };
    format!("{written}{gap}={after}{value}")
}

/// Add `entry` as the last field of `table`, in the table's layout: on its
/// own line with the same indentation when fields are one per line, after a
/// separator on the same line otherwise.
fn insert(source: &str, table: &TableConstructor, entry: String) -> Result<Plan, Refusal> {
    let (open, close) = table.braces().tokens();
    let inside_start = open.span().1;
    let inside_end = close.span().0;
    let newline = if source.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let fields = table.fields();

    let Some(last) = fields.last() else {
        let inside = &source[inside_start..inside_end];
        let text = if inside.contains('\n') {
            let outer = indentation(source, inside_end);
            let step = indent_step(source);
            format!("{newline}{outer}{step}{entry},{newline}{outer}")
        } else {
            format!(" {entry} ")
        };
        return Ok(Plan {
            splices: vec![(inside_start, inside_end, text)],
            location: Location::of(source, inside_start, inside_start),
        });
    };

    let separator = fields
        .pairs()
        .find_map(Pair::punctuation)
        .map_or(",".to_string(), |token| token.token().to_string());
    let last_field = last.value();
    let (field_start, field_end) = last_field.span();
    let punctuation = last.punctuation();
    let after_last = punctuation.map_or(field_end, |token| token.span().1);
    let one_per_line = source[after_last..inside_end].contains('\n');

    let mut splices = Vec::new();
    if !one_per_line {
        let (at, text) = match punctuation {
            Some(_) => (after_last, format!(" {entry}{separator}")),
            None => (field_end, format!("{separator} {entry}")),
        };
        splices.push((at, at, text));
        return Ok(Plan {
            splices,
            location: Location::of(source, at, at),
        });
    }

    if punctuation.is_none() {
        splices.push((field_end, field_end, separator.clone()));
    }
    // After the last token's trailing comment, which full-moon keeps with the
    // token up to the end of its line.
    let last_token = match punctuation {
        Some(token) => token,
        // full-moon lists a table's braces before its fields, so the last
        // token listed is not always the last in the text.
        None => last_field
            .tokens()
            .max_by_key(|token| token.span().1)
            .expect("a parsed field has at least one token"),
    };
    let at = last_token
        .trailing_trivia()
        .last()
        .map_or(after_last, |trivia| trivia.end_position().bytes());
    let indent = {
        let own = indentation(source, field_start);
        let line_start = source[..field_start].rfind('\n').map_or(0, |i| i + 1);
        if source[line_start..field_start].trim().is_empty() {
            own
        } else {
            format!("{}{}", indentation(source, inside_end), indent_step(source))
        }
    };
    let trailing = if punctuation.is_some() {
        separator.as_str()
    } else {
        ""
    };
    let text = if source[..at].ends_with('\n') {
        format!("{indent}{entry}{trailing}{newline}")
    } else {
        format!("{newline}{indent}{entry}{trailing}")
    };
    splices.push((at, at, text));
    Ok(Plan {
        splices,
        location: Location::of(source, at, at),
    })
}

/// The whitespace a line starts with, for the line holding byte `at`.
fn indentation(source: &str, at: usize) -> String {
    let line_start = source[..at].rfind('\n').map_or(0, |i| i + 1);
    source[line_start..]
        .chars()
        .take_while(|c| *c == ' ' || *c == '\t')
        .collect()
}

/// One level of indentation as the file writes it, taken from the first
/// indented line. A tab if nothing in the file is indented.
fn indent_step(source: &str) -> String {
    source
        .lines()
        .map(|line| {
            line.chars()
                .take_while(|c| *c == ' ' || *c == '\t')
                .collect::<String>()
        })
        .find(|indent| !indent.is_empty())
        .map_or("\t".to_string(), |indent| {
            if indent.starts_with('\t') {
                "\t".to_string()
            } else {
                indent
            }
        })
}
