//! Tests for the highlights feature assets.

use crate::prelude::*;

const CSS_TAG: &str = r#"<link rel="stylesheet" href="css/highlights-"#;
const JS_TAG: &str = r#"<script src="highlights-"#;

// The highlights assets are added to every chapter page and the index.
#[test]
fn injects_into_chapters() {
    BookTest::from_dir("highlights/inject")
        .check_file_contains("book/chapter_1.html", CSS_TAG)
        .check_file_contains("book/chapter_1.html", JS_TAG)
        .check_file_contains("book/index.html", CSS_TAG)
        .check_file_contains("book/index.html", JS_TAG)
        .check_file_contains(
            "book/sub/nested.html",
            r#"<link rel="stylesheet" href="../css/highlights-"#,
        )
        .check_file_contains("book/sub/nested.html", r#"<script src="../highlights-"#)
        .check_file_contains("book/chapter_1.html", r#"data-page="chapter_1.html""#)
        .check_file_contains("book/index.html", r#"data-page="chapter_1.html""#)
        .check_file_contains("book/sub/nested.html", r#"data-page="sub/nested.html""#)
        .check_file_doesnt_contain("book/print.html", "highlights-")
        .check_file_doesnt_contain("book/toc.html", "highlights-");
}

// A book with its own `index.hbs` still gets the highlights assets.
#[test]
fn injects_with_custom_index() {
    BookTest::from_dir("highlights/custom_index")
        .check_file_contains("book/chapter_1.html", CSS_TAG)
        .check_file_contains("book/chapter_1.html", JS_TAG);
}
