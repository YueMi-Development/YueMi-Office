use super::diff::{DiffChange, DiffLineKind, apply_changes, diff_hunks, split_lines};

/// The lines of a hunk, so a test can look at them one by one.
fn kinds(hunk: &super::diff::DiffHunk) -> Vec<DiffLineKind> {
    hunk.lines.iter().map(|line| line.kind).collect()
}

#[test]
fn an_empty_text_has_no_lines() {
    assert_eq!(split_lines(""), Vec::<String>::new());
}

#[test]
fn lines_keep_the_newline_that_ends_them() {
    assert_eq!(split_lines("one\ntwo\n"), vec!["one\n", "two\n"]);
}

#[test]
fn a_file_without_a_final_newline_has_a_last_line_without_one() {
    assert_eq!(split_lines("one\ntwo"), vec!["one\n", "two"]);
}

#[test]
fn joining_the_lines_back_gives_the_text_unchanged() {
    let text = "one\ntwo\nthree";
    assert_eq!(split_lines(text).concat(), text);
}

#[test]
fn reports_no_difference_for_equal_texts() {
    assert!(diff_hunks("same\n", "same\n", 3).is_empty());
}

#[test]
fn marks_the_added_and_removed_lines() {
    let hunks = diff_hunks("one\ntwo\n", "one\nthree\n", 3);

    assert_eq!(hunks.len(), 1);
    let kinds = kinds(&hunks[0]);
    assert!(kinds.contains(&DiffLineKind::Removed));
    assert!(kinds.contains(&DiffLineKind::Added));
}

#[test]
fn keeps_the_lines_around_the_change() {
    let hunks = diff_hunks("a\nb\nc\nd\ne\n", "a\nb\nc\nD\ne\n", 3);

    assert_eq!(hunks.len(), 1);
    assert!(
        hunks[0]
            .lines
            .iter()
            .any(|line| line.kind == DiffLineKind::Context && line.text == "a")
    );
}

#[test]
fn two_changes_far_apart_are_two_hunks() {
    let old = (0..40)
        .map(|index| format!("line {index}"))
        .collect::<Vec<_>>()
        .join("\n");
    let new = old
        .replace("line 2", "changed 2")
        .replace("line 35", "changed 35");

    let hunks = diff_hunks(&old, &new, 3);

    assert_eq!(hunks.len(), 2);
}

#[test]
fn two_changes_close_together_are_one_hunk() {
    let old = (0..20)
        .map(|index| format!("line {index}"))
        .collect::<Vec<_>>()
        .join("\n");
    let new = old
        .replace("line 5", "changed 5")
        .replace("line 8", "changed 8");

    let hunks = diff_hunks(&old, &new, 3);

    assert_eq!(hunks.len(), 1);
}

#[test]
fn a_change_reproduces_the_new_text() {
    let hunks = diff_hunks("one\ntwo\nthree\nfour\n", "one\nTWO\nthree\nFOUR\n", 3);
    let changes: Vec<DiffChange> = hunks.iter().flat_map(|hunk| hunk.changes.clone()).collect();

    assert_eq!(
        apply_changes("one\ntwo\nthree\nfour\n", &changes),
        "one\nTWO\nthree\nFOUR\n"
    );
}

#[test]
fn applies_a_change_to_the_file() {
    let new = apply_changes(
        "one\ntwo\nthree\n",
        &[DiffChange {
            old_start: 2,
            old_count: 1,
            new_lines: vec!["TWO\n".to_string()],
        }],
    );

    assert_eq!(new, "one\nTWO\nthree\n");
}

#[test]
fn applies_several_changes() {
    let new = apply_changes(
        "one\ntwo\nthree\n",
        &[
            DiffChange {
                old_start: 1,
                old_count: 1,
                new_lines: vec!["ONE\n".to_string()],
            },
            DiffChange {
                old_start: 3,
                old_count: 1,
                new_lines: vec!["THREE\n".to_string()],
            },
        ],
    );

    assert_eq!(new, "ONE\ntwo\nTHREE\n");
}

#[test]
fn adding_lines_keeps_the_rest_of_the_file() {
    let new = apply_changes(
        "one\ntwo\n",
        &[DiffChange {
            old_start: 2,
            old_count: 0,
            new_lines: vec!["new\n".to_string()],
        }],
    );

    assert_eq!(new, "one\nnew\ntwo\n");
}

#[test]
fn removing_lines_keeps_the_rest_of_the_file() {
    let new = apply_changes(
        "one\ntwo\nthree\n",
        &[DiffChange {
            old_start: 2,
            old_count: 1,
            new_lines: Vec::new(),
        }],
    );

    assert_eq!(new, "one\nthree\n");
}

#[test]
fn overlapping_changes_are_applied_once() {
    let new = apply_changes(
        "one\ntwo\nthree\n",
        &[
            DiffChange {
                old_start: 1,
                old_count: 2,
                new_lines: vec!["ONE\n".to_string()],
            },
            DiffChange {
                old_start: 1,
                old_count: 2,
                new_lines: vec!["ONE\n".to_string()],
            },
        ],
    );

    assert_eq!(new, "ONE\nthree\n");
}

#[test]
fn a_file_without_a_final_newline_keeps_it_that_way() {
    let new = apply_changes(
        "one\ntwo",
        &[DiffChange {
            old_start: 2,
            old_count: 1,
            new_lines: vec!["TWO".to_string()],
        }],
    );

    assert_eq!(new, "one\nTWO");
}

#[test]
fn a_new_file_is_all_added_lines() {
    let hunks = diff_hunks("", "# A new file\n\nWith a paragraph.\n", 3);

    assert_eq!(hunks.len(), 1);
    assert_eq!(hunks[0].old_start, 1);
    assert_eq!(hunks[0].old_count, 0);
    assert_eq!(hunks[0].new_count, 3);
    assert!(
        kinds(&hunks[0])
            .iter()
            .all(|kind| *kind == DiffLineKind::Added)
    );
}
