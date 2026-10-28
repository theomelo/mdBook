'use strict';

/* global module, path_to_root */

// Highlights, notes and page bookmarks.
//
// This file is built into mdBook and is not part of the theme, so that it also
// works on books with their own templates. The first part holds pure helpers
// (also loaded by the unit tests in `tests/js`), the second part runs in the
// page.

const mdbookHighlights = (function helpers() {
    const STORAGE_PREFIX = 'mdbook-highlights:';
    const CONTEXT_CHARS = 32;
    const DAY_MS = 24 * 60 * 60 * 1000;

    // Pathname of the book root, always ending with `/`.
    function bookRoot(pathToRoot, href) {
        const base = pathToRoot === null ? './' : pathToRoot || './';
        let root = new URL(base, href).pathname;
        if (!root.endsWith('/')) {
            root += '/';
        }
        return root;
    }

    // Path of a page relative to the book root. The root itself is `index.html`.
    function pagePath(root, pathname) {
        let path = pathname.startsWith(root)
            ? pathname.slice(root.length)
            : pathname.slice(pathname.lastIndexOf('/') + 1);
        if (path === '' || path.endsWith('/')) {
            path += 'index.html';
        }
        try {
            return decodeURIComponent(path);
        } catch {
            return path;
        }
    }

    function emptyData() {
        return { version: 1, entries: [] };
    }

    function loadData(storage, key) {
        try {
            const data = JSON.parse(storage.getItem(key));
            if (data && data.version === 1 && Array.isArray(data.entries)) {
                return data;
            }
        } catch {
            // Missing, unreadable or invalid data: start empty.
        }
        return emptyData();
    }

    function saveData(storage, key, data) {
        try {
            storage.setItem(key, JSON.stringify(data));
            return true;
        } catch {
            return false;
        }
    }

    function newId(existing) {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        for (;;) {
            let id = '';
            for (let i = 0; i < 6; i++) {
                id += chars[Math.floor(Math.random() * chars.length)];
            }
            if (!existing.has(id)) {
                return id;
            }
        }
    }

    function makeQuote(text, start, end) {
        return {
            exact: text.slice(start, end),
            prefix: text.slice(Math.max(0, start - CONTEXT_CHARS), start),
            suffix: text.slice(end, end + CONTEXT_CHARS),
        };
    }

    // Number of characters matching from the end of `a` and `b`.
    function commonSuffix(a, b) {
        let n = 0;
        while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) {
            n++;
        }
        return n;
    }

    // Number of characters matching from the start of `a` and `b`.
    function commonPrefix(a, b) {
        let n = 0;
        while (n < a.length && n < b.length && a[n] === b[n]) {
            n++;
        }
        return n;
    }

    // Finds the occurrence of `quote.exact` whose context best matches the
    // stored prefix and suffix, preferring the one closest to `pos`.
    function findQuote(text, quote, pos) {
        const exact = quote.exact;
        if (!exact) {
            return null;
        }
        let best = null;
        let bestScore = -1;
        let bestDistance = Infinity;
        for (let i = text.indexOf(exact); i !== -1; i = text.indexOf(exact, i + 1)) {
            const before = text.slice(Math.max(0, i - CONTEXT_CHARS), i);
            const after = text.slice(i + exact.length, i + exact.length + CONTEXT_CHARS);
            const score = commonSuffix(before, quote.prefix || '')
                + commonPrefix(after, quote.suffix || '');
            const distance = Math.abs(i - (pos || 0));
            if (score > bestScore || score === bestScore && distance < bestDistance) {
                best = i;
                bestScore = score;
                bestDistance = distance;
            }
        }
        return best === null ? null : { start: best, end: best + exact.length };
    }

    function startOfDay(date) {
        return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    }

    function formatDateLabel(iso, now) {
        const date = new Date(iso);
        const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
        if (days === 0) {
            return 'Today';
        }
        if (days === 1) {
            return 'Yesterday';
        }
        const options = { month: 'short', day: 'numeric' };
        if (date.getFullYear() !== now.getFullYear()) {
            options.year = 'numeric';
        }
        return date.toLocaleDateString(undefined, options);
    }

    function byPosition(a, b) {
        if (a.kind !== b.kind) {
            return a.kind === 'bookmark' ? -1 : 1;
        }
        return (a.pos || 0) - (b.pos || 0);
    }

    function byNewest(a, b) {
        return a.created < b.created ? 1 : a.created > b.created ? -1 : 0;
    }

    // Groups entries for the list: by chapter in book order, or one group
    // with the newest entries first.
    function groupEntries(entries, mode, order) {
        if (mode === 'date') {
            return [{ chapter: null, path: null, entries: entries.slice().sort(byNewest) }];
        }
        const groups = new Map();
        for (const entry of entries) {
            if (!groups.has(entry.path)) {
                groups.set(entry.path, { chapter: entry.chapter, path: entry.path, entries: [] });
            }
            groups.get(entry.path).entries.push(entry);
        }
        const rank = path => order.has(path) ? order.get(path) : Infinity;
        return Array.from(groups.values())
            .sort((a, b) => rank(a.path) - rank(b.path))
            .map(group => {
                group.entries.sort(byPosition);
                return group;
            });
    }

    function encodeFragment(text) {
        return encodeURIComponent(text)
            .replace(/-/g, '%2D')
            .replace(/,/g, '%2C')
            .replace(/&/g, '%26');
    }

    // Text fragments match whole words, so context cut at the
    // CONTEXT_CHARS limit loses its partial word.
    function prefixContext(prefix) {
        if (prefix.length >= CONTEXT_CHARS) {
            prefix = prefix.replace(/^\S*\s+/, '');
        }
        return prefix.trim();
    }

    function suffixContext(suffix) {
        if (suffix.length >= CONTEXT_CHARS) {
            suffix = suffix.replace(/\s+\S*$/, '');
        }
        return suffix.trim();
    }

    // Link to a passage using a browser text fragment (`#:~:text=`).
    function textFragmentUrl(pageUrl, quote) {
        const base = pageUrl.split('#')[0];
        const exact = quote.exact.trim();
        const words = exact.split(/\s+/);
        let text;
        // Text fragments don't match across blocks, so long or multi-line
        // quotes use the `start,end` form, without the two halves overlapping.
        if ((exact.length > 300 || exact.includes('\n')) && words.length > 1) {
            const count = Math.min(5, Math.floor(words.length / 2));
            text = encodeFragment(words.slice(0, count).join(' ')) + ','
                + encodeFragment(words.slice(-count).join(' '));
        } else {
            text = encodeFragment(words.join(' '));
        }
        const prefix = prefixContext(quote.prefix || '');
        const suffix = suffixContext(quote.suffix || '');
        if (prefix) {
            text = encodeFragment(prefix) + '-,' + text;
        }
        if (suffix) {
            text += ',-' + encodeFragment(suffix);
        }
        return base + '#:~:text=' + text;
    }

    function isValidEntry(entry) {
        if (!entry || typeof entry !== 'object') {
            return false;
        }
        if (typeof entry.id !== 'string' || typeof entry.path !== 'string'
            || typeof entry.created !== 'string') {
            return false;
        }
        if (entry.kind === 'bookmark') {
            return true;
        }
        return entry.kind === 'highlight' && !!entry.quote
            && typeof entry.quote.exact === 'string';
    }

    // Returns the entries of an exported file, or null if it is not one.
    function validateImport(json) {
        if (!json || typeof json !== 'object' || json.version !== 1
            || !Array.isArray(json.entries) || !json.entries.every(isValidEntry)) {
            return null;
        }
        return json.entries;
    }

    function mergeEntries(existing, incoming) {
        const ids = new Set(existing.map(entry => entry.id));
        const entries = existing.slice();
        let added = 0;
        let skipped = 0;
        for (const entry of incoming) {
            if (ids.has(entry.id)) {
                skipped++;
            } else {
                ids.add(entry.id);
                entries.push(entry);
                added++;
            }
        }
        return { entries, added, skipped };
    }

    return {
        STORAGE_PREFIX,
        CONTEXT_CHARS,
        bookRoot,
        pagePath,
        loadData,
        saveData,
        newId,
        makeQuote,
        findQuote,
        formatDateLabel,
        groupEntries,
        textFragmentUrl,
        validateImport,
        mergeEntries,
    };
})();

if (typeof module === 'object' && module.exports) {
    module.exports = mdbookHighlights;
}

// Everything below runs in the page.
function mdbookHighlightsInPage(h) {
    // The chapter this page shows, set by mdBook on the script tag.
    const scriptPage = document.currentScript ? document.currentScript.dataset.page : null;

    // Font Awesome Free 6.2.0 by @fontawesome - https://fontawesome.com
    // License - https://fontawesome.com/license/free (Icons: CC BY 4.0)
    const ICON_PATHS = {
        bookmarkRegular: ['0 0 384 512',
            'M336 0h-288C21.49 0 0 21.49 0 48v431.9c0 24.7 26.79 40.08 48.12 27.64L192 423.6l' +
            '143.9 83.93C357.2 519.1 384 504.6 384 479.9V48C384 21.49 362.5 0 336 0zM336 452L' +
            '192 368l-144 84V54C48 50.63 50.63 48 53.1 48h276C333.4 48 336 50.63 336 54V452z'],
        bookmarkSolid: ['0 0 384 512',
            'M0 48V487.7C0 501.1 10.9 512 24.3 512c5 0 9.9-1.5 14-4.4L192 400 345.7 507.6c4.1' +
            ' 2.9 9 4.4 14 4.4c13.4 0 24.3-10.9 24.3-24.3V48c0-26.5-21.5-48-48-48H48C21.5 0 0' +
            ' 21.5 0 48z'],
        ellipsisVertical: ['0 0 128 512',
            'M64 360c30.9 0 56 25.1 56 56s-25.1 56-56 56s-56-25.1-56-56s25.1-56 56-56zm0-160c' +
            '30.9 0 56 25.1 56 56s-25.1 56-56 56s-56-25.1-56-56s25.1-56 56-56zM120 96c0 30.9-' +
            '25.1 56-56 56S8 126.9 8 96S33.1 40 64 40s56 25.1 56 56z'],
        link: ['0 0 640 512',
            'M579.8 267.7c56.5-56.5 56.5-148 0-204.5c-50-50-128.8-56.5-186.3-15.4l-1.6 1.1c-1' +
            '4.4 10.3-17.7 30.3-7.4 44.6s30.3 17.7 44.6 7.4l1.6-1.1c32.1-22.9 76-19.3 103.8 8' +
            '.6c31.5 31.5 31.5 82.5 0 114L422.3 334.8c-31.5 31.5-82.5 31.5-114 0c-27.9-27.9-3' +
            '1.5-71.8-8.6-103.8l1.1-1.6c10.3-14.4 6.9-34.4-7.4-44.6s-34.4-6.9-44.6 7.4l-1.1 1' +
            '.6C206.5 251.2 213 330 263 380c56.5 56.5 148 56.5 204.5 0L579.8 267.7zM60.2 244.' +
            '3c-56.5 56.5-56.5 148 0 204.5c50 50 128.8 56.5 186.3 15.4l1.6-1.1c14.4-10.3 17.7' +
            '-30.3 7.4-44.6s-30.3-17.7-44.6-7.4l-1.6 1.1c-32.1 22.9-76 19.3-103.8-8.6C74 372 ' +
            '74 321 105.5 289.5L217.7 177.2c31.5-31.5 82.5-31.5 114 0c27.9 27.9 31.5 71.8 8.6' +
            ' 103.9l-1.1 1.6c-10.3 14.4-6.9 34.4 7.4 44.6s34.4 6.9 44.6-7.4l1.1-1.6C433.5 260' +
            '.8 427 182 377 132c-56.5-56.5-148-56.5-204.5 0L60.2 244.3z'],
        xmark: ['0 0 320 512',
            'M310.6 150.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L160 210.7 54.6 105.4c-' +
            '12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L114.7 256 9.4 361.4c-12.5 12.5-12.5' +
            ' 32.8 0 45.3s32.8 12.5 45.3 0L160 301.3 265.4 406.6c12.5 12.5 32.8 12.5 45.3 0s1' +
            '2.5-32.8 0-45.3L205.3 256 310.6 150.6z'],
        copy: ['0 0 512 512',
            'M502.6 70.63l-61.25-61.25C435.4 3.371 427.2 0 418.7 0H255.1c-35.35 0-64 28.66-64' +
            ' 64l.0195 256C192 355.4 220.7 384 256 384h192c35.2 0 64-28.8 64-64V93.25C512 84.' +
            '77 508.6 76.63 502.6 70.63zM464 320c0 8.836-7.164 16-16 16H255.1c-8.838 0-16-7.1' +
            '64-16-16L239.1 64.13c0-8.836 7.164-16 16-16h128L384 96c0 17.67 14.33 32 32 32h47' +
            '.1V320zM272 448c0 8.836-7.164 16-16 16H63.1c-8.838 0-16-7.164-16-16L47.98 192.1c' +
            '0-8.836 7.164-16 16-16H160V128H63.99c-35.35 0-64 28.65-64 64l.0098 256C.002 483.' +
            '3 28.66 512 64 512h192c35.2 0 64-28.8 64-64v-32h-47.1L272 448z'],
        trash: ['0 0 448 512',
            'M135.2 17.7L128 32H32C14.3 32 0 46.3 0 64S14.3 96 32 96H416c17.7 0 32-14.3 32-32' +
            's-14.3-32-32-32H320l-7.2-14.3C307.4 6.8 296.3 0 284.2 0H163.8c-12.1 0-23.2 6.8-2' +
            '8.6 17.7zM416 128H32L53.2 467c1.6 25.3 22.6 45 47.9 45H346.9c25.3 0 46.3-19.7 47' +
            '.9-45L416 128z'],
    };

    // Text inside these elements is never part of a highlight.
    const EXCLUDED = '.ace_editor, button, .buttons, .mdbook-highlights-ui, script, style';

    const app = {
        root: null,
        path: null,
        key: null,
        main: null,
        data: null,
        orphans: new Set(),
        onChange: [],
    };
    let current = null;

    function icon(name) {
        const [viewBox, d] = ICON_PATHS[name];
        return '<svg class="mdbook-highlights-icon" viewBox="' + viewBox
            + '" aria-hidden="true"><path d="' + d + '"/></svg>';
    }

    function storage() {
        try {
            return window.localStorage;
        } catch {
            return null;
        }
    }

    function findMain() {
        return document.querySelector('#mdbook-content main')
            || document.querySelector('#content main')
            || document.querySelector('main');
    }

    // The text of the chapter, and where each of its text nodes starts in it.
    function textIndex() {
        const walker = document.createTreeWalker(app.main, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                const parent = node.parentElement;
                return parent && parent.closest(EXCLUDED)
                    ? NodeFilter.FILTER_REJECT
                    : NodeFilter.FILTER_ACCEPT;
            },
        });
        const nodes = [];
        let text = '';
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            nodes.push({ node, start: text.length });
            text += node.data;
        }
        return { text, nodes };
    }

    // Offset in the chapter text of a range boundary point.
    function pointOffset(index, container, offset) {
        if (container.nodeType === Node.TEXT_NODE) {
            const item = index.nodes.find(n => n.node === container);
            if (item) {
                return item.start + offset;
            }
        }
        const point = document.createRange();
        point.setStart(container, offset);
        const next = index.nodes.find(n => point.comparePoint(n.node, 0) >= 0);
        return next ? next.start : index.text.length;
    }

    function rangeOffsets(index, range) {
        return {
            start: pointOffset(index, range.startContainer, range.startOffset),
            end: pointOffset(index, range.endContainer, range.endOffset),
        };
    }

    // Wraps the chapter text between two offsets, one span per text node.
    function wrapOffsets(start, end, className, id) {
        const spans = [];
        for (const item of textIndex().nodes) {
            const length = item.node.data.length;
            if (item.start + length <= start || item.start >= end) {
                continue;
            }
            const from = Math.max(start - item.start, 0);
            const to = Math.min(end - item.start, length);
            if (!item.node.data.slice(from, to).trim()) {
                continue;
            }
            let target = item.node;
            if (to < length) {
                target.splitText(to);
            }
            if (from > 0) {
                target = target.splitText(from);
            }
            const span = document.createElement('span');
            span.className = className;
            if (id) {
                span.dataset.highlightId = id;
            }
            target.parentNode.replaceChild(span, target);
            span.appendChild(target);
            spans.push(span);
        }
        return spans;
    }

    function unwrapSpans(spans) {
        for (const span of spans) {
            const parent = span.parentNode;
            while (span.firstChild) {
                parent.insertBefore(span.firstChild, span);
            }
            parent.removeChild(span);
            parent.normalize();
        }
    }

    function spansFor(id) {
        return Array.from(app.main.querySelectorAll('.mdbook-highlight'))
            .filter(span => span.dataset.highlightId === id);
    }

    app.wrapEntry = function(entry) {
        const index = textIndex();
        const found = h.findQuote(index.text, entry.quote, entry.pos);
        if (!found) {
            app.orphans.add(entry.id);
            return [];
        }
        app.orphans.delete(entry.id);
        return wrapOffsets(found.start, found.end, 'mdbook-highlight', entry.id);
    };

    app.unwrapEntry = function(id) {
        unwrapSpans(spansFor(id));
    };

    app.wrapAll = function() {
        unwrapSpans(Array.from(app.main.querySelectorAll('.mdbook-highlight')));
        app.data.entries
            .filter(entry => entry.kind === 'highlight' && entry.path === app.path)
            .forEach(app.wrapEntry);
    };

    app.save = function() {
        const store = storage();
        if (!store || !h.saveData(store, app.key, app.data)) {
            console.warn('mdBook highlights: could not save to localStorage');
        }
        app.onChange.forEach(listener => listener());
    };

    // Sidebar label of the current chapter, e.g. "1.2. Hello, World!".
    app.currentChapter = function() {
        const active = document.querySelector('ol.chapter a.active');
        if (active) {
            return active.textContent.replace(/\s+/g, ' ').trim();
        }
        const title = document.title.split(' - ')[0].trim();
        if (title) {
            return title;
        }
        const h1 = app.main.querySelector('h1');
        return h1 ? h1.textContent.trim() : app.path;
    };

    app.createHighlight = function(range, note) {
        const { start, end } = rangeOffsets(textIndex(), range);
        return app.createHighlightAt(start, end, note);
    };

    app.createHighlightAt = function(start, end, note) {
        const index = textIndex();
        const entry = {
            id: h.newId(new Set(app.data.entries.map(e => e.id))),
            kind: 'highlight',
            path: app.path,
            chapter: app.currentChapter(),
            created: new Date().toISOString(),
            note: note || null,
            quote: h.makeQuote(index.text, start, end),
            pos: start,
        };
        app.data.entries.push(entry);
        app.wrapEntry(entry);
        app.save();
        return entry;
    };

    app.deleteEntry = function(id) {
        app.unwrapEntry(id);
        app.orphans.delete(id);
        app.data.entries = app.data.entries.filter(entry => entry.id !== id);
        app.save();
    };

    // Copies with execCommand, for pages where the Clipboard API is not
    // available or not allowed.
    function copyWithTextarea(text) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.className = 'mdbook-highlights-ui';
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
        } finally {
            document.body.removeChild(textarea);
        }
    }

    app.copyText = function(text) {
        if (navigator.clipboard && window.isSecureContext) {
            return navigator.clipboard.writeText(text).catch(() => copyWithTextarea(text));
        }
        copyWithTextarea(text);
        return Promise.resolve();
    };

    app.pageUrl = function(path) {
        return new URL(app.root + path, location.href).href;
    };

    app.linkFor = function(entry) {
        const url = app.pageUrl(entry.path);
        return entry.kind === 'highlight' ? h.textFragmentUrl(url, entry.quote) : url;
    };

    // A row of buttons: [{action, label, icon, title, run}].
    app.buttonBar = function(buttons) {
        const bar = document.createElement('div');
        bar.className = 'mdbook-highlights-bar';
        for (const button of buttons) {
            const el = document.createElement('button');
            el.type = 'button';
            el.dataset.action = button.action;
            el.title = button.title || button.label;
            el.setAttribute('aria-label', button.title || button.label);
            el.innerHTML = button.icon ? icon(button.icon) : '';
            if (button.label) {
                el.appendChild(document.createTextNode(button.label));
            }
            el.addEventListener('click', e => {
                e.stopPropagation();
                button.run();
            });
            bar.appendChild(el);
        }
        return bar;
    };

    // Shows `content` in a popup below `anchorRect` (above it if there is no
    // room below). Only one popup is open at a time.
    app.popover = function(anchorRect, content, options = {}) {
        app.closePopovers();
        const el = document.createElement('div');
        el.className = 'mdbook-highlights-ui mdbook-highlights-popover '
            + (options.className || '');
        el.setAttribute('role', options.role || 'dialog');
        el.appendChild(content);
        document.body.appendChild(el);

        const gap = 8;
        const width = el.offsetWidth;
        const height = el.offsetHeight;
        const maxLeft = document.documentElement.clientWidth - width - gap;
        let left = anchorRect.left + anchorRect.width / 2 - width / 2;
        left = Math.max(gap, Math.min(left, maxLeft));
        let top = anchorRect.bottom + gap;
        if (top + height > window.innerHeight && anchorRect.top - height - gap > 0) {
            top = anchorRect.top - height - gap;
        }
        el.style.left = left + window.scrollX + 'px';
        el.style.top = top + window.scrollY + 'px';

        current = { el, onClose: options.onClose, trigger: options.trigger };
        return el;
    };

    app.closePopovers = function() {
        if (!current) {
            return;
        }
        const closing = current;
        current = null;
        closing.el.remove();
        if (closing.onClose) {
            closing.onClose();
        }
        if (closing.trigger) {
            closing.trigger.focus();
        }
    };

    app.isOpen = function(className) {
        return !!current && current.el.classList.contains(className);
    };

    app.flash = function(id) {
        const spans = spansFor(id);
        if (spans.length === 0) {
            return;
        }
        spans[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
        spans.forEach(span => span.classList.add('mdbook-highlight-flash'));
        setTimeout(() => {
            spans.forEach(span => span.classList.remove('mdbook-highlight-flash'));
        }, 1500);
    };

    // A non-empty selection inside the chapter text, or null.
    function selectedRange() {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
            return null;
        }
        const range = selection.getRangeAt(0);
        const inside = node => {
            const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
            return app.main.contains(node) && !(el && el.closest(EXCLUDED));
        };
        if (!inside(range.startContainer) || !inside(range.endContainer)) {
            return null;
        }
        const index = textIndex();
        const { start, end } = rangeOffsets(index, range);
        if (start >= end || !index.text.slice(start, end).trim()) {
            return null;
        }
        return range;
    }

    function showSelectionToolbar(range) {
        const index = textIndex();
        const { start, end } = rangeOffsets(index, range);
        const buttons = [
            { action: 'highlight', label: 'Highlight', run() {
                app.closePopovers();
                app.createHighlight(range, null);
                window.getSelection().removeAllRanges();
            } },
        ];
        if (app.openDraftNote) {
            buttons.push({ action: 'note', label: 'Add Note', run() {
                app.closePopovers();
                app.openDraftNote(range);
            } });
        }
        buttons.push(
            { action: 'copy', label: 'Copy', run() {
                app.closePopovers();
                app.copyText(index.text.slice(start, end));
            } },
            { action: 'link', icon: 'link', title: 'Copy link', run() {
                app.closePopovers();
                const quote = h.makeQuote(index.text, start, end);
                app.copyText(h.textFragmentUrl(app.pageUrl(app.path), quote));
            } },
        );
        const bar = app.buttonBar(buttons);
        // Keep the selection when the toolbar is clicked.
        bar.addEventListener('mousedown', e => e.preventDefault());
        app.popover(range.getBoundingClientRect(), bar, {
            className: 'mdbook-highlights-selection',
            role: 'toolbar',
        });
    }

    let pointerDown = false;
    let pointerStart = null;
    let selectionTimer = null;

    function checkSelection() {
        clearTimeout(selectionTimer);
        selectionTimer = setTimeout(() => {
            if (pointerDown) {
                return;
            }
            const range = selectedRange();
            if (range) {
                showSelectionToolbar(range);
            } else if (app.isOpen('mdbook-highlights-selection')) {
                app.closePopovers();
            }
        }, 200);
    }

    // Clicking a saved highlight in the page.
    function onHighlightClick(e) {
        const span = e.target.closest('.mdbook-highlight');
        // A drag that ends on a highlight is a text selection, not a click.
        const moved = pointerStart
            && Math.hypot(e.clientX - pointerStart.x, e.clientY - pointerStart.y) > 4;
        if (!span || moved) {
            return;
        }
        const entry = app.data.entries.find(x => x.id === span.dataset.highlightId);
        if (!entry) {
            return;
        }
        const menu = app.buttonBar([
            { action: 'copy-link', label: 'Copy link', run() {
                app.closePopovers();
                app.copyText(app.linkFor(entry));
            } },
            { action: 'delete', label: 'Delete', run() {
                app.closePopovers();
                app.deleteEntry(entry.id);
            } },
        ]);
        for (const item of menu.children) {
            item.setAttribute('role', 'menuitem');
        }
        app.popover(span.getBoundingClientRect(), menu, {
            className: 'mdbook-highlights-highlight-menu',
            role: 'menu',
        });
    }

    function listen() {
        document.addEventListener('selectionchange', checkSelection);
        app.main.addEventListener('click', onHighlightClick);
        document.addEventListener('pointerdown', e => {
            if (current && !current.el.contains(e.target)) {
                app.closePopovers();
            }
            // Touch selections end without a pointerup, so only mouse drags
            // hold the toolbar back.
            pointerDown = e.pointerType === 'mouse'
                && !(current && current.el.contains(e.target));
            pointerStart = { x: e.clientX, y: e.clientY };
        });
        document.addEventListener('pointerup', e => {
            pointerDown = false;
            // Clicks in a popup act on it; they don't change the selection.
            if (!(current && current.el.contains(e.target))) {
                checkSelection();
            }
        });
        document.addEventListener('pointercancel', () => {
            pointerDown = false;
        });
        // Capture, so that Escape closes a popup before anything else sees it.
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && current) {
                e.stopPropagation();
                e.preventDefault();
                app.closePopovers();
            }
        }, true);
        window.addEventListener('storage', e => {
            if (e.key !== app.key) {
                return;
            }
            app.data = h.loadData(storage(), app.key);
            app.wrapAll();
            app.onChange.forEach(listener => listener());
        });
    }

    const EMPTY_TEXT = 'To create highlights, select a phrase from the book, '
        + 'then click "Highlight."';
    const SORT_LABELS = { chapter: 'Chapter', date: 'Date' };

    function getSetting(name, fallback) {
        try {
            return localStorage.getItem(name) || fallback;
        } catch {
            return fallback;
        }
    }

    function setSetting(name, value) {
        try {
            localStorage.setItem(name, value);
        } catch {
            // Settings are a convenience; ignore storage failures.
        }
    }

    function element(tag, className, text) {
        const el = document.createElement(tag);
        if (className) {
            el.className = className;
        }
        if (text) {
            el.textContent = text;
        }
        return el;
    }

    // Waits for the sidebar's chapter list, which the sidebar fills in itself.
    function whenChapterList(scrollbox, callback) {
        const find = () => scrollbox.querySelector('ol.chapter');
        if (find()) {
            callback(find());
            return;
        }
        const observer = new MutationObserver(() => {
            if (find()) {
                observer.disconnect();
                clearTimeout(timer);
                callback(find());
            }
        });
        const timer = setTimeout(() => {
            observer.disconnect();
            console.warn('mdBook highlights: no chapter list in the sidebar');
        }, 5000);
        observer.observe(scrollbox, { childList: true, subtree: true });
    }

    function sidebarToggle() {
        return document.getElementById('mdbook-sidebar-toggle-anchor')
            || document.getElementById('sidebar-toggle-anchor');
    }

    app.closeSidebarIfNarrow = function() {
        const toggle = sidebarToggle();
        if (toggle && toggle.checked && document.body.clientWidth < 1080) {
            toggle.checked = false;
            toggle.dispatchEvent(new Event('change'));
        }
    };

    // Position of each page in the book, from the order of the chapter list.
    app.chapterOrder = function() {
        const order = new Map();
        for (const link of app.sidebar.chapterList.querySelectorAll('a[href]')) {
            const path = h.pagePath(app.root, new URL(link.href).pathname);
            if (!order.has(path)) {
                order.set(path, order.size);
            }
        }
        return order;
    };

    app.showTab = function(name, initial = false) {
        const { scrollbox, tabs, panel } = app.sidebar;
        const highlights = name === 'highlights';
        scrollbox.classList.toggle('mdbook-highlights-tab-active', highlights);
        panel.hidden = !highlights;
        for (const tab of tabs) {
            const selected = tab.dataset.tab === name;
            tab.setAttribute('aria-selected', selected);
            tab.tabIndex = selected ? 0 : -1;
        }
        setSetting('mdbook-sidebar-tab', name);
        if (!highlights && !initial) {
            const active = app.sidebar.chapterList.querySelector('.active');
            if (active) {
                active.scrollIntoView({ block: 'center' });
            }
        }
    };

    app.goTo = function(entry) {
        if (entry.path !== app.path) {
            const hash = entry.kind === 'highlight' ? '#mdbook-hl-' + entry.id : '';
            location.href = app.pageUrl(entry.path) + hash;
            return;
        }
        app.closeSidebarIfNarrow();
        if (entry.kind === 'highlight') {
            app.flash(entry.id);
        } else {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };

    // The note editor: a textarea with Save Note and Cancel.
    function noteEditor({ initial, onSave, onCancel }) {
        const editor = element('div', 'mdbook-highlights-editor mdbook-highlights-ui');
        const header = element('div', 'mdbook-highlights-editor-header');
        header.appendChild(element('span', 'mdbook-highlights-editor-title', 'Note'));
        const close = element('button', 'mdbook-highlights-editor-close');
        close.type = 'button';
        close.dataset.action = 'close';
        close.title = 'Close';
        close.setAttribute('aria-label', 'Close');
        close.innerHTML = icon('xmark');
        header.appendChild(close);
        editor.appendChild(header);

        const textarea = element('textarea');
        textarea.value = initial;
        textarea.rows = 4;
        textarea.setAttribute('aria-label', 'Note');
        editor.appendChild(textarea);

        const footer = element('div', 'mdbook-highlights-editor-footer');
        const save = element('button', null, 'Save Note');
        save.type = 'button';
        save.dataset.action = 'save';
        const cancel = element('button', null, 'Cancel');
        cancel.type = 'button';
        cancel.dataset.action = 'cancel';
        footer.append(save, cancel);
        editor.appendChild(footer);

        const doSave = () => onSave(textarea.value.trim());
        save.addEventListener('click', doSave);
        cancel.addEventListener('click', onCancel);
        close.addEventListener('click', onCancel);
        editor.addEventListener('click', e => e.stopPropagation());
        editor.addEventListener('keydown', e => {
            // Keep the book's keyboard shortcuts out of the note.
            e.stopPropagation();
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                doSave();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                onCancel();
            }
        });
        return { editor, textarea };
    }

    // "Add Note" on a selection: nothing is saved until "Save Note".
    app.openDraftNote = function(range) {
        const { start, end } = rangeOffsets(textIndex(), range);
        const rect = range.getBoundingClientRect();
        window.getSelection().removeAllRanges();
        const draft = wrapOffsets(start, end, 'mdbook-highlight-draft');
        const { editor, textarea } = noteEditor({
            initial: '',
            onSave(text) {
                app.closePopovers();
                app.createHighlightAt(start, end, text);
            },
            onCancel() {
                app.closePopovers();
            },
        });
        app.popover(rect, editor, {
            className: 'mdbook-highlights-note-popover',
            onClose() {
                unwrapSpans(draft);
            },
        });
        textarea.focus();
    };

    // Edits the note of a saved entry, below it in the list.
    app.openNoteEditor = function(entry, li) {
        for (const open of app.sidebar.list.querySelectorAll('.mdbook-highlights-editor')) {
            open.remove();
        }
        const { editor, textarea } = noteEditor({
            initial: entry.note || '',
            onSave(text) {
                entry.note = text || null;
                app.save();
            },
            onCancel() {
                editor.remove();
                li.focus();
            },
        });
        li.appendChild(editor);
        textarea.focus();
    };

    app.entryMenuItems = function(entry) {
        return [
            { action: 'note', label: entry.note ? 'Edit Note' : 'Add Note', run() {
                app.closePopovers();
                const li = app.sidebar.list.querySelector('[data-id="' + entry.id + '"]');
                app.openNoteEditor(entry, li);
            } },
            { action: 'copy-link', label: 'Copy Link', run() {
                app.closePopovers();
                app.copyText(app.linkFor(entry));
            } },
            { action: 'delete', label: 'Delete', run() {
                app.closePopovers();
                app.deleteEntry(entry.id);
            } },
        ];
    };

    // A vertical menu in a popup, opened from `trigger`.
    app.menu = function(trigger, items, className) {
        const menu = app.buttonBar(items);
        menu.classList.add('mdbook-highlights-menu');
        for (const item of menu.children) {
            item.setAttribute('role', 'menuitem');
        }
        app.popover(trigger.getBoundingClientRect(), menu, {
            className,
            role: 'menu',
            trigger,
        });
        menu.firstChild.focus();
    };

    function renderEntry(entry, showChapter) {
        const li = element('li', 'mdbook-highlights-entry');
        li.dataset.id = entry.id;
        if (showChapter) {
            li.appendChild(element('div', 'mdbook-highlights-entry-chapter', entry.chapter));
        }
        if (entry.kind === 'highlight') {
            li.appendChild(element('div', 'mdbook-highlights-quote', entry.quote.exact.trim()));
            if (entry.path === app.path && app.orphans.has(entry.id)) {
                li.appendChild(element('div', 'mdbook-highlights-orphan', 'passage not found'));
            }
        } else {
            const bookmark = element('div', 'mdbook-highlights-bookmark');
            bookmark.innerHTML = icon('bookmarkSolid');
            bookmark.appendChild(document.createTextNode('Page bookmarked'));
            li.appendChild(bookmark);
        }
        if (entry.note) {
            li.appendChild(element('div', 'mdbook-highlights-note', entry.note));
        }
        const footer = element('div', 'mdbook-highlights-footer');
        footer.appendChild(element('span', 'mdbook-highlights-date',
            h.formatDateLabel(entry.created, new Date())));
        const menuButton = element('button', 'mdbook-highlights-menu-button');
        menuButton.type = 'button';
        menuButton.title = 'Highlight options';
        menuButton.setAttribute('aria-label', 'Highlight options');
        menuButton.setAttribute('aria-haspopup', 'menu');
        menuButton.innerHTML = icon('ellipsisVertical');
        menuButton.addEventListener('click', e => {
            e.stopPropagation();
            app.menu(menuButton, app.entryMenuItems(entry), 'mdbook-highlights-entry-menu');
        });
        footer.appendChild(menuButton);
        li.appendChild(footer);
        li.tabIndex = 0;
        li.addEventListener('click', e => {
            if (!e.target.closest('.mdbook-highlights-editor')) {
                app.goTo(entry);
            }
        });
        li.addEventListener('keydown', e => {
            if (e.key === 'Enter' && e.target === li) {
                app.goTo(entry);
            }
        });
        return li;
    }

    app.renderList = function() {
        const { list, empty, sortButton } = app.sidebar;
        const mode = getSetting('mdbook-highlights-sort', 'chapter');
        sortButton.textContent = SORT_LABELS[mode] || SORT_LABELS.chapter;
        list.textContent = '';
        app.sidebar.message.hidden = true;
        empty.hidden = app.data.entries.length > 0;
        sortButton.parentElement.hidden = app.data.entries.length === 0;
        for (const group of h.groupEntries(app.data.entries, mode, app.chapterOrder())) {
            const li = element('li', 'mdbook-highlights-group');
            if (group.chapter !== null) {
                li.appendChild(element('div', 'mdbook-highlights-group-title', group.chapter));
            }
            const entries = element('ol', 'mdbook-highlights-entries');
            for (const entry of group.entries) {
                entries.appendChild(renderEntry(entry, group.chapter === null));
            }
            li.appendChild(entries);
            list.appendChild(li);
        }
    };

    function buildTabs() {
        const nav = element('ul', 'mdbook-navigation mdbook-highlights-ui');
        nav.setAttribute('role', 'tablist');
        const names = [['contents', 'Contents'], ['highlights', 'Highlights']];
        const tabs = names.map(([name, label]) => {
            const li = element('li');
            li.setAttribute('role', 'none');
            const tab = element('button', null, label);
            tab.type = 'button';
            tab.dataset.tab = name;
            tab.setAttribute('role', 'tab');
            tab.addEventListener('click', () => app.showTab(name));
            li.appendChild(tab);
            nav.appendChild(li);
            return tab;
        });
        nav.addEventListener('keydown', e => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            const index = tabs.indexOf(document.activeElement);
            const next = tabs[(index + 1) % tabs.length];
            app.showTab(next.dataset.tab);
            next.focus();
        });
        return { nav, tabs };
    }

    function showMessage(text) {
        const { message } = app.sidebar;
        message.textContent = text;
        message.hidden = false;
    }

    // File name part for exports, from the book title.
    function exportSlug() {
        const title = document.title.split(' - ').pop().trim()
            || app.root.split('/').filter(Boolean).pop() || '';
        return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'book';
    }

    app.exportData = function() {
        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        const date = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
        const payload = {
            version: 1,
            book: app.root,
            exported: now.toISOString(),
            entries: app.data.entries,
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = element('a');
        link.href = url;
        link.download = exportSlug() + '-highlights-' + date + '.json';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    // Adds the entries of an exported file; existing entries are kept as they are.
    app.importText = function(text) {
        let entries = null;
        try {
            entries = h.validateImport(JSON.parse(text));
        } catch {
            entries = null;
        }
        if (!entries) {
            showMessage('Not a valid highlights file');
            return;
        }
        const result = h.mergeEntries(app.data.entries, entries);
        app.data.entries = result.entries;
        app.wrapAll();
        app.save();
        showMessage('Imported ' + result.added + ' entries, '
            + result.skipped + ' already present');
    };

    function buildTransfer() {
        const transfer = element('div', 'mdbook-highlights-transfer');
        const exportButton = element('button', null, 'Export');
        exportButton.type = 'button';
        exportButton.dataset.action = 'export';
        exportButton.title = 'Download these highlights as a file';
        exportButton.addEventListener('click', app.exportData);
        const importButton = element('button', null, 'Import');
        importButton.type = 'button';
        importButton.dataset.action = 'import';
        importButton.title = 'Add highlights from an exported file';
        const file = element('input', 'mdbook-highlights-import-file');
        file.type = 'file';
        file.accept = '.json,application/json';
        file.hidden = true;
        importButton.addEventListener('click', () => file.click());
        file.addEventListener('change', () => {
            const chosen = file.files[0];
            file.value = '';
            if (chosen) {
                chosen.text().then(app.importText);
            }
        });
        transfer.append(exportButton, importButton, file);
        return transfer;
    }

    function buildPanel() {
        const panel = element('div', 'mdbook-highlights-panel mdbook-highlights-ui');
        const toolbar = element('div', 'mdbook-highlights-toolbar');
        const sort = element('div', 'mdbook-highlights-sort-control');
        sort.appendChild(element('span', null, 'Sort by '));
        const sortButton = element('button', 'mdbook-highlights-sort');
        sortButton.type = 'button';
        sortButton.setAttribute('aria-haspopup', 'menu');
        sortButton.addEventListener('click', () => {
            const items = Object.keys(SORT_LABELS).map(mode => ({
                action: mode,
                label: SORT_LABELS[mode],
                run() {
                    app.closePopovers();
                    setSetting('mdbook-highlights-sort', mode);
                    app.renderList();
                },
            }));
            app.menu(sortButton, items, 'mdbook-highlights-sort-menu');
        });
        sort.appendChild(sortButton);
        toolbar.appendChild(sort);
        toolbar.appendChild(buildTransfer());
        panel.appendChild(toolbar);
        const message = element('p', 'mdbook-highlights-message');
        message.setAttribute('role', 'status');
        message.hidden = true;
        panel.appendChild(message);
        const list = element('ol', 'bookmarks');
        panel.appendChild(list);
        const empty = element('p', 'mdbook-highlights-empty', EMPTY_TEXT);
        panel.appendChild(empty);
        return { panel, toolbar, list, empty, sortButton, message };
    }

    function initSidebar() {
        const scrollbox = document.querySelector('mdbook-sidebar-scrollbox')
            || document.querySelector('.sidebar-scrollbox');
        if (!scrollbox) {
            console.warn('mdBook highlights: no sidebar found, the list is unavailable');
            return;
        }
        whenChapterList(scrollbox, chapterList => {
            const { nav, tabs } = buildTabs();
            const parts = buildPanel();
            const logo = scrollbox.querySelector('.sidebar-book-logo');
            scrollbox.insertBefore(nav, logo ? logo.nextSibling : scrollbox.firstChild);
            // The sidebar has already restored its scroll position; keep the
            // chapter list where it was now that the tabs are above it.
            chapterList.after(parts.panel);
            app.sidebar = { scrollbox, chapterList, tabs, ...parts };
            app.onChange.push(app.renderList);
            app.renderList();
            app.showTab(getSetting('mdbook-sidebar-tab', 'contents'), true);
        });
    }

    app.pageBookmark = function() {
        return app.data.entries.find(e => e.kind === 'bookmark' && e.path === app.path);
    };

    function updateBookmarkButton() {
        const button = app.bookmarkButton;
        const bookmarked = !!app.pageBookmark();
        const label = bookmarked ? 'Remove bookmark' : 'Bookmark this page';
        button.classList.toggle('is-bookmarked', bookmarked);
        button.title = label;
        button.setAttribute('aria-label', label);
        button.setAttribute('aria-pressed', bookmarked);
    }

    app.toggleBookmark = function() {
        const bookmark = app.pageBookmark();
        if (bookmark) {
            app.deleteEntry(bookmark.id);
            return;
        }
        app.data.entries.push({
            id: h.newId(new Set(app.data.entries.map(e => e.id))),
            kind: 'bookmark',
            path: app.path,
            chapter: app.currentChapter(),
            created: new Date().toISOString(),
            note: null,
        });
        app.save();
    };

    function confirmBookmark() {
        const bookmarked = !!app.pageBookmark();
        const content = element('div', 'mdbook-highlights-confirm');
        content.appendChild(element('p', 'mdbook-highlights-confirm-text',
            bookmarked ? 'Remove bookmark?' : 'Bookmark this page?'));
        const bar = app.buttonBar([
            { action: 'confirm', label: bookmarked ? 'Remove' : 'Bookmark', run() {
                app.closePopovers();
                app.toggleBookmark();
            } },
            { action: 'cancel', label: 'Cancel', run() {
                app.closePopovers();
            } },
        ]);
        content.appendChild(bar);
        app.popover(app.bookmarkButton.getBoundingClientRect(), content, {
            className: 'mdbook-highlights-bookmark-confirm',
            trigger: app.bookmarkButton,
        });
        bar.firstChild.focus();
    }

    function initBookmarkButton() {
        const buttons = document.querySelector('.right-buttons');
        if (!buttons) {
            console.warn('mdBook highlights: no menu bar buttons, page bookmarks unavailable');
            return;
        }
        const button = element('button', 'icon-button mdbook-highlights-bookmark-button');
        button.type = 'button';
        button.innerHTML = '<span class="fa-svg mdbook-highlights-bookmark-off">'
            + icon('bookmarkRegular') + '</span>'
            + '<span class="fa-svg mdbook-highlights-bookmark-on">'
            + icon('bookmarkSolid') + '</span>';
        button.addEventListener('click', e => {
            e.stopPropagation();
            confirmBookmark();
        });
        buttons.insertBefore(button, buttons.firstChild);
        app.bookmarkButton = button;
        app.onChange.push(updateBookmarkButton);
        updateBookmarkButton();
    }

    // Links from the list point at `#mdbook-hl-<id>`.
    function followHash() {
        const match = /^#mdbook-hl-([a-z0-9]+)$/.exec(location.hash);
        if (!match) {
            return;
        }
        history.replaceState(null, '', location.pathname + location.search);
        app.flash(match[1]);
    }

    function init() {
        if (/\/print\.html$/.test(location.pathname)) {
            return;
        }
        app.main = findMain();
        if (!app.main) {
            console.warn('mdBook highlights: no chapter content found, disabled');
            return;
        }
        const pathToRoot = typeof path_to_root !== 'undefined' ? path_to_root : null;
        app.root = h.bookRoot(pathToRoot, location.href);
        app.path = scriptPage || h.pagePath(app.root, location.pathname);
        app.key = h.STORAGE_PREFIX + app.root;
        app.data = h.loadData(storage(), app.key);
        app.wrapAll();
        listen();
        initBookmarkButton();
        initSidebar();
        followHash();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}

if (typeof document !== 'undefined') {
    mdbookHighlightsInPage(mdbookHighlights);
}
