//! Highlights, notes and page bookmarks.
//!
//! The front-end files are built in and are not part of the theme, so that a
//! book with its own `theme/` still gets them. Their tags are injected into
//! every rendered chapter page after templating, which also keeps them
//! independent of the book's `index.hbs`.

use anyhow::Result;
use handlebars::Handlebars;
use serde_json::{Map, Value};

pub(super) static JS: &[u8] = include_bytes!("../../front-end/js/highlights.js");
pub(super) static CSS: &[u8] = include_bytes!("../../front-end/css/highlights.css");

pub(super) const JS_NAME: &str = "highlights.js";
pub(super) const CSS_NAME: &str = "css/highlights.css";

const HEAD_TEMPLATE: &str = "highlights_head";
const BODY_TEMPLATE: &str = "highlights_body";

/// Registers the templates for the tags that load the highlights files.
pub(super) fn register_templates(hb: &mut Handlebars<'_>) -> Result<()> {
    hb.register_template_string(
        HEAD_TEMPLATE,
        r#"<link rel="stylesheet" href="{{ resource "css/highlights.css" }}">"#,
    )?;
    hb.register_template_string(
        BODY_TEMPLATE,
        r#"<script src="{{ resource "highlights.js" }}" data-page="{{ highlights_page }}"></script>"#,
    )?;
    Ok(())
}

/// Adds the highlights tags to a rendered page.
///
/// `data` must contain `highlights_page`, the `.html` path of the chapter the
/// page shows. `index.html` is a copy of the first chapter, so both share it.
pub(super) fn inject(
    hb: &Handlebars<'_>,
    data: &Map<String, Value>,
    html: String,
) -> Result<String> {
    let head = hb.render(HEAD_TEMPLATE, data)?;
    let body = hb.render(BODY_TEMPLATE, data)?;
    Ok(inject_tags(&html, &head, &body))
}

/// Inserts `head_tag` before the last `</head>` and `body_tag` before the
/// last `</body>`. A missing closing tag skips that insertion.
pub(super) fn inject_tags(html: &str, head_tag: &str, body_tag: &str) -> String {
    let lower = html.to_ascii_lowercase();
    let mut inserts = Vec::new();
    if let Some(i) = lower.rfind("</head>") {
        inserts.push((i, head_tag));
    }
    if let Some(i) = lower.rfind("</body>") {
        inserts.push((i, body_tag));
    }
    inserts.sort_by_key(|(i, _)| *i);
    let mut out = String::with_capacity(html.len() + head_tag.len() + body_tag.len());
    let mut last = 0;
    for (i, tag) in inserts {
        out.push_str(&html[last..i]);
        out.push_str(tag);
        last = i;
    }
    out.push_str(&html[last..]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inject_tags_inserts_before_closing_tags() {
        let html = "<html><head><title>t</title></head><body><p>x</p></body></html>";
        assert_eq!(
            inject_tags(html, "<H>", "<B>"),
            "<html><head><title>t</title><H></head><body><p>x</p><B></body></html>"
        );
    }

    #[test]
    fn inject_tags_uses_last_marker() {
        let html = "<head></head><body><pre>&lt;/body&gt; </body></pre></body>";
        assert_eq!(
            inject_tags(html, "<H>", "<B>"),
            "<head><H></head><body><pre>&lt;/body&gt; </body></pre><B></body>"
        );
    }

    #[test]
    fn inject_tags_without_markers_is_identity() {
        let html = "This is a modified index.hbs!\n";
        assert_eq!(inject_tags(html, "<H>", "<B>"), html);
    }

    #[test]
    fn inject_tags_is_case_insensitive() {
        let html = "<HEAD></HEAD><BODY></BODY>";
        assert_eq!(
            inject_tags(html, "<H>", "<B>"),
            "<HEAD><H></HEAD><BODY><B></BODY>"
        );
    }
}
