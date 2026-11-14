//! Line differences between two versions of a file.
//!
//! The assistant proposes changes as a new version of a file. The user sees
//! the difference between the old and the new version and can accept or
//! reject it piece by piece, so the difference has to be described in a way
//! that can be turned back into a file.
//!
//! A change is therefore recorded as the lines it removes and the lines it
//! puts in their place, counted from the start of the file. Applying the
//! changes to the old text gives the new text, which is what makes accepting
//! one hunk of a change possible without accepting the rest of it.
//!
//! Lines keep their line endings, so a file can be put back together exactly
//! as it was. That matters for a document: a missing final newline is a
//! difference between two platforms' editors and should not show up as a
//! change.

use serde::{Deserialize, Serialize};
use similar::{Algorithm, DiffOp};

/// How many lines are shown around a change, unless the caller says
/// otherwise.
pub const DEFAULT_CONTEXT: usize = 3;

/// What a line of a hunk is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DiffLineKind {
    /// A line that did not change.
    Context,
    /// A line the change puts in.
    Added,
    /// A line the change takes out.
    Removed,
}

/// One line of a difference.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    /// Whether the line was kept, added or removed.
    pub kind: DiffLineKind,
    /// The text of the line, without the newline that ends it.
    pub text: String,
    /// The line's number in the file before the change, counting from 1.
    #[serde(default)]
    pub old_line: Option<usize>,
    /// The line's number in the file after the change, counting from 1.
    #[serde(default)]
    pub new_line: Option<usize>,
}

/// One replacement within a file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffChange {
    /// The first line the change touches, counting from 1.
    pub old_start: usize,
    /// How many lines the change removes.
    pub old_count: usize,
    /// The lines the change puts in their place.
    #[serde(default)]
    pub new_lines: Vec<String>,
}

/// A run of changes shown together, with the lines around them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    /// The first line of the hunk in the file before the change.
    pub old_start: usize,
    /// How many lines of the original file the hunk covers.
    pub old_count: usize,
    /// The first line of the hunk in the file after the change.
    pub new_start: usize,
    /// How many lines of the changed file the hunk covers.
    pub new_count: usize,
    /// The lines of the hunk, each marked as context, added or removed.
    #[serde(default)]
    pub lines: Vec<DiffLine>,
    /// The changes the hunk holds, which are what accepting it applies.
    #[serde(default)]
    pub changes: Vec<DiffChange>,
}

/// Splits text into the lines a difference is counted in.
///
/// Each line keeps the newline that ends it, so joining the lines back
/// together gives the text unchanged. A file that does not end with a
/// newline simply has a last line without one, and an empty file has no
/// lines at all.
///
/// Only a line feed ends a line, so the count of lines is the same in the
/// app, in the service and in the shared protocol.
pub fn split_lines(text: &str) -> Vec<String> {
    if text.is_empty() {
        return Vec::new();
    }

    let mut lines: Vec<String> = Vec::new();
    let mut current = String::new();
    for character in text.chars() {
        current.push(character);
        if character == '\n' {
            lines.push(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() {
        lines.push(current);
    }

    lines
}

/// The text of a line as it is shown to the user.
///
/// The newline that ends the line is left out, because the difference is
/// shown one line per row.
fn display(line: &str) -> String {
    line.trim_end_matches(['\r', '\n']).to_string()
}

/// One step of the difference between two files.
///
/// The steps are the same shape the shared protocol uses: the old range and
/// the new range they cover, and what happened to them.
#[derive(Debug, Clone, Copy)]
struct Opcode {
    kind: OpcodeKind,
    /// The first old line the step covers.
    old_start: usize,
    /// How many old lines the step covers.
    old_len: usize,
    /// The first new line the step covers.
    new_start: usize,
    /// How many new lines the step covers.
    new_len: usize,
}

/// What happened to a range of lines.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OpcodeKind {
    Equal,
    Delete,
    Insert,
    Replace,
}

/// Finds the steps that turn the old lines into the new ones.
///
/// The steps are the same shape the shared protocol uses: the old range and
/// the new range they cover, and what happened to them. A removal that is
/// followed by an addition is one replacement, not two steps, so the user
/// sees the lines that changed together.
fn opcodes(old_lines: &[String], new_lines: &[String]) -> Vec<Opcode> {
    let old: Vec<&str> = old_lines.iter().map(String::as_str).collect();
    let new: Vec<&str> = new_lines.iter().map(String::as_str).collect();

    let raw = similar::capture_diff_slices(Algorithm::Myers, &old, &new);

    let mut steps: Vec<Opcode> = Vec::new();
    let mut pending: Option<Opcode> = None;

    for op in raw {
        let step = match op {
            DiffOp::Equal {
                old_index,
                new_index,
                len,
            } => Opcode {
                kind: OpcodeKind::Equal,
                old_start: old_index,
                old_len: len,
                new_start: new_index,
                new_len: len,
            },
            DiffOp::Delete {
                old_index,
                old_len,
                new_index,
            } => Opcode {
                kind: OpcodeKind::Delete,
                old_start: old_index,
                old_len,
                new_start: new_index,
                new_len: 0,
            },
            DiffOp::Insert {
                old_index,
                new_index,
                new_len,
            } => Opcode {
                kind: OpcodeKind::Insert,
                old_start: old_index,
                old_len: 0,
                new_start: new_index,
                new_len,
            },
            DiffOp::Replace {
                old_index,
                old_len,
                new_index,
                new_len,
            } => Opcode {
                kind: OpcodeKind::Replace,
                old_start: old_index,
                old_len,
                new_start: new_index,
                new_len,
            },
        };

        if step.kind == OpcodeKind::Equal {
            if let Some(pending) = pending.take() {
                steps.push(pending);
            }
            steps.push(step);
            continue;
        }

        pending = Some(match pending {
            None => step,
            Some(previous) => Opcode {
                kind: OpcodeKind::Replace,
                old_start: previous.old_start,
                old_len: previous.old_len + step.old_len,
                new_start: previous.new_start,
                new_len: previous.new_len + step.new_len,
            },
        });
    }

    if let Some(pending) = pending {
        steps.push(pending);
    }

    steps
}

/// Builds the hunk that covers the given steps.
fn build_hunk(
    opcodes: &[Opcode],
    first_op: usize,
    last_op: usize,
    old_lines: &[String],
    new_lines: &[String],
    context: usize,
) -> DiffHunk {
    let mut lines: Vec<DiffLine> = Vec::new();
    let mut changes: Vec<DiffChange> = Vec::new();

    let lead_op = if first_op > 0 {
        opcodes.get(first_op - 1).copied()
    } else {
        None
    };
    let trail_op = opcodes.get(last_op + 1).copied();

    // The lines before the change and after it, so the user can see where in
    // the file the change sits.
    if let Some(lead) = lead_op
        && lead.kind == OpcodeKind::Equal
    {
        let start = lead
            .old_start
            .max(lead.old_start + lead.old_len.saturating_sub(context));
        for (offset, text) in old_lines[start..lead.old_start + lead.old_len]
            .iter()
            .enumerate()
        {
            let index = start + offset;
            lines.push(DiffLine {
                kind: DiffLineKind::Context,
                text: display(text),
                old_line: Some(index + 1),
                new_line: Some(lead.new_start + (index - lead.old_start) + 1),
            });
        }
    }

    for op in &opcodes[first_op..=last_op] {
        let old_end = op.old_start + op.old_len;
        let new_end = op.new_start + op.new_len;

        match op.kind {
            OpcodeKind::Equal => {
                for (offset, text) in old_lines[op.old_start..old_end].iter().enumerate() {
                    let index = op.old_start + offset;
                    lines.push(DiffLine {
                        kind: DiffLineKind::Context,
                        text: display(text),
                        old_line: Some(index + 1),
                        new_line: Some(op.new_start + (index - op.old_start) + 1),
                    });
                }
            }
            OpcodeKind::Delete => {
                for (offset, text) in old_lines[op.old_start..old_end].iter().enumerate() {
                    lines.push(DiffLine {
                        kind: DiffLineKind::Removed,
                        text: display(text),
                        old_line: Some(op.old_start + offset + 1),
                        new_line: None,
                    });
                }
                changes.push(DiffChange {
                    old_start: op.old_start + 1,
                    old_count: op.old_len,
                    new_lines: Vec::new(),
                });
            }
            OpcodeKind::Insert => {
                for (offset, text) in new_lines[op.new_start..new_end].iter().enumerate() {
                    lines.push(DiffLine {
                        kind: DiffLineKind::Added,
                        text: display(text),
                        old_line: None,
                        new_line: Some(op.new_start + offset + 1),
                    });
                }
                changes.push(DiffChange {
                    old_start: op.old_start + 1,
                    old_count: 0,
                    new_lines: new_lines[op.new_start..new_end].to_vec(),
                });
            }
            OpcodeKind::Replace => {
                for (offset, text) in old_lines[op.old_start..old_end].iter().enumerate() {
                    lines.push(DiffLine {
                        kind: DiffLineKind::Removed,
                        text: display(text),
                        old_line: Some(op.old_start + offset + 1),
                        new_line: None,
                    });
                }
                for (offset, text) in new_lines[op.new_start..new_end].iter().enumerate() {
                    lines.push(DiffLine {
                        kind: DiffLineKind::Added,
                        text: display(text),
                        old_line: None,
                        new_line: Some(op.new_start + offset + 1),
                    });
                }
                changes.push(DiffChange {
                    old_start: op.old_start + 1,
                    old_count: op.old_len,
                    new_lines: new_lines[op.new_start..new_end].to_vec(),
                });
            }
        }
    }

    if let Some(trail) = trail_op
        && trail.kind == OpcodeKind::Equal
    {
        let end = (trail.old_start + trail.old_len).min(trail.old_start + context);
        for (offset, text) in old_lines[trail.old_start..end].iter().enumerate() {
            let index = trail.old_start + offset;
            lines.push(DiffLine {
                kind: DiffLineKind::Context,
                text: display(text),
                old_line: Some(index + 1),
                new_line: Some(trail.new_start + (index - trail.old_start) + 1),
            });
        }
    }

    let (old_start, new_start) = match lead_op {
        Some(lead) => (lead.old_start + 1, lead.new_start + 1),
        None => (
            opcodes[first_op].old_start + 1,
            opcodes[first_op].new_start + 1,
        ),
    };

    let old_count = lines
        .iter()
        .filter(|line| matches!(line.kind, DiffLineKind::Context | DiffLineKind::Removed))
        .count();
    let new_count = lines
        .iter()
        .filter(|line| matches!(line.kind, DiffLineKind::Context | DiffLineKind::Added))
        .count();

    DiffHunk {
        old_start,
        old_count,
        new_start,
        new_count,
        lines,
        changes,
    }
}

/// Finds the differences between two versions of a file.
///
/// Changes that are close together are shown in one hunk, so a paragraph
/// that was edited in two places does not produce two separate blocks.
///
/// * `old_text` is the file's contents before the change.
/// * `new_text` is the file's contents after the change.
/// * `context` is how many lines to show around each change.
pub fn diff_hunks(old_text: &str, new_text: &str, context: usize) -> Vec<DiffHunk> {
    let old_lines = split_lines(old_text);
    let new_lines = split_lines(new_text);

    let opcodes = opcodes(&old_lines, &new_lines);

    let change_positions: Vec<usize> = opcodes
        .iter()
        .enumerate()
        .filter(|(_, op)| op.kind != OpcodeKind::Equal)
        .map(|(index, _)| index)
        .collect();

    if change_positions.is_empty() {
        return Vec::new();
    }

    let mut groups: Vec<Vec<usize>> = Vec::new();
    let mut current = vec![change_positions[0]];
    for position in change_positions.iter().skip(1) {
        // The steps alternate, so the one between two changes is the run of
        // lines that stayed the same.
        let gap = opcodes[position - 1];
        if gap.old_len <= 2 * context {
            current.push(*position);
        } else {
            groups.push(std::mem::take(&mut current));
            current = vec![*position];
        }
    }
    groups.push(current);

    groups
        .iter()
        .map(|group| {
            build_hunk(
                &opcodes,
                group[0],
                group[group.len() - 1],
                &old_lines,
                &new_lines,
                context,
            )
        })
        .collect()
}

/// Puts the given changes into a file and returns the result.
///
/// Changes that overlap are skipped rather than applied twice, so passing
/// the changes of a hunk twice does not corrupt the file.
pub fn apply_changes(old_text: &str, changes: &[DiffChange]) -> String {
    let lines = split_lines(old_text);
    let mut result: Vec<String> = Vec::new();
    let mut cursor = 0usize;

    let mut ordered: Vec<&DiffChange> = changes.iter().collect();
    ordered.sort_by_key(|change| change.old_start);

    for change in ordered {
        let start = change.old_start.saturating_sub(1).min(lines.len());
        if start < cursor {
            continue;
        }
        result.extend_from_slice(&lines[cursor..start]);
        result.extend(change.new_lines.iter().cloned());
        cursor = start + change.old_count;
    }

    result.extend_from_slice(&lines[cursor..]);
    result.concat()
}
