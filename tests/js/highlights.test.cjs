// Unit tests for the pure helpers in highlights.js.
//
// Run with `node --test tests/js/`.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const h = require('../../crates/mdbook-html/front-end/js/highlights.js');

function fakeStorage(value) {
    return {
        getItem() {
            if (value instanceof Error) {
                throw value;
            }
            return value;
        },
        setItem() {},
    };
}

test('bookRoot resolves path_to_root against the page', () => {
    assert.strictEqual(h.bookRoot('../', 'file:///b/sub/x.html'), '/b/');
    assert.strictEqual(h.bookRoot('', 'http://h/book/index.html'), '/book/');
    assert.strictEqual(h.bookRoot(null, 'http://h/book/a.html'), '/book/');
});

test('pagePath is relative to the root, with an index alias', () => {
    assert.strictEqual(h.pagePath('/book/', '/book/'), 'index.html');
    assert.strictEqual(h.pagePath('/book/', '/book/sub/n%20x.html'), 'sub/n x.html');
});

test('storageKey separates books served at the same address', () => {
    assert.strictEqual(h.storageKey('/', 'Book A'), 'mdbook-highlights:/#Book A');
    assert.notStrictEqual(h.storageKey('/', 'Book A'), h.storageKey('/', 'Book B'));
    assert.strictEqual(h.storageKey('/b/', ''), 'mdbook-highlights:/b/');
});

test('loadData returns empty data for bad storage contents', () => {
    const empty = { version: 1, entries: [] };
    assert.deepStrictEqual(h.loadData(fakeStorage(null), 'k'), empty);
    assert.deepStrictEqual(h.loadData(fakeStorage('not json'), 'k'), empty);
    assert.deepStrictEqual(h.loadData(fakeStorage('{"version":2,"entries":[{}]}'), 'k'), empty);
    assert.deepStrictEqual(h.loadData(fakeStorage('{"version":1}'), 'k'), empty);
    assert.deepStrictEqual(h.loadData(fakeStorage(new Error('denied')), 'k'), empty);
});

test('loadData returns stored entries', () => {
    const data = { version: 1, entries: [{ id: 'a' }] };
    assert.deepStrictEqual(h.loadData(fakeStorage(JSON.stringify(data)), 'k'), data);
});

test('saveData reports storage failures', () => {
    const stored = {};
    const ok = { setItem(k, v) {
        stored[k] = v;
    } };
    assert.strictEqual(h.saveData(ok, 'k', { version: 1, entries: [] }), true);
    assert.strictEqual(stored.k, '{"version":1,"entries":[]}');
    const bad = { setItem() {
        throw new Error('full');
    } };
    assert.strictEqual(h.saveData(bad, 'k', { version: 1, entries: [] }), false);
});

test('newId avoids existing ids', () => {
    const id = h.newId(new Set(['aaaaaa']));
    assert.match(id, /^[a-z0-9]{6}$/);
    assert.notStrictEqual(id, 'aaaaaa');
});

test('makeQuote keeps 32 characters of context', () => {
    const text = 'abcdefghijklmnopqrstuvwxyz0123456789'.repeat(3);
    const q = h.makeQuote(text, 40, 45);
    assert.strictEqual(q.exact, text.slice(40, 45));
    assert.strictEqual(q.prefix, text.slice(8, 40));
    assert.strictEqual(q.suffix, text.slice(45, 77));
    assert.strictEqual(h.makeQuote(text, 0, 3).prefix, '');
});

test('findQuote picks the occurrence matching prefix/suffix', () => {
    const quote = { exact: 'foo', prefix: 'X ', suffix: ' baz' };
    assert.deepStrictEqual(h.findQuote('foo bar X foo baz', quote, 0), { start: 10, end: 13 });
});

test('findQuote breaks ties by closeness to pos', () => {
    const quote = { exact: 'ab', prefix: '', suffix: '' };
    assert.deepStrictEqual(h.findQuote('ab ab ab', quote, 4), { start: 3, end: 5 });
});

test('findQuote returns null when the text is gone', () => {
    assert.strictEqual(h.findQuote('nothing here', { exact: 'gone', prefix: '', suffix: '' }, 0),
        null);
});

test('formatDateLabel', () => {
    const now = new Date(2026, 9, 28, 15, 0);
    assert.strictEqual(h.formatDateLabel(new Date(2026, 9, 28, 1, 0).toISOString(), now), 'Today');
    assert.strictEqual(h.formatDateLabel(new Date(2026, 9, 27, 23, 0).toISOString(), now),
        'Yesterday');
    const march = h.formatDateLabel(new Date(2026, 2, 2, 12).toISOString(), now);
    assert.match(march, /Mar/);
    assert.match(march, /2/);
    assert.doesNotMatch(march, /2026/);
    assert.match(h.formatDateLabel(new Date(2025, 2, 2, 12).toISOString(), now), /2025/);
});

test('groupEntries by chapter follows book order', () => {
    const order = new Map([['a.html', 0], ['b.html', 1]]);
    const e = (id, path, kind, pos, created) => ({ id, path, kind, pos, created,
        chapter: path });
    const entries = [
        e('b5', 'b.html', 'highlight', 5, '2026-01-05'),
        e('a9', 'a.html', 'highlight', 9, '2026-01-01'),
        e('abm', 'a.html', 'bookmark', undefined, '2026-01-02'),
        e('a1', 'a.html', 'highlight', 1, '2026-01-03'),
        e('z', 'zzz.html', 'highlight', 0, '2026-01-04'),
    ];
    const groups = h.groupEntries(entries, 'chapter', order);
    assert.deepStrictEqual(groups.map(g => g.path), ['a.html', 'b.html', 'zzz.html']);
    assert.deepStrictEqual(groups[0].entries.map(x => x.id), ['abm', 'a1', 'a9']);
    assert.strictEqual(groups[0].chapter, 'a.html');

    const byDate = h.groupEntries(entries, 'date', order);
    assert.strictEqual(byDate.length, 1);
    assert.strictEqual(byDate[0].chapter, null);
    assert.deepStrictEqual(byDate[0].entries.map(x => x.id), ['b5', 'z', 'a1', 'abm', 'a9']);
});

test('textFragmentUrl encodes the quote', () => {
    const url = h.textFragmentUrl('http://h/p.html#x',
        { exact: 'a-b, c', prefix: 'pre ', suffix: ' suf' });
    assert.strictEqual(url, 'http://h/p.html#:~:text=pre-,a%2Db%2C%20c,-suf');
});

test('textFragmentUrl drops partial words from full-length context', () => {
    const prefix = 'ion one two three four five six ';
    const suffix = ' alpha beta gamma delta epsilonx';
    assert.strictEqual(prefix.length, 32);
    assert.strictEqual(suffix.length, 32);
    const url = h.textFragmentUrl('http://h/p.html', { exact: 'x', prefix, suffix });
    assert.strictEqual(url, 'http://h/p.html#:~:text='
        + 'one%20two%20three%20four%20five%20six-,x,-alpha%20beta%20gamma%20delta');
});

test('textFragmentUrl uses a range for long quotes', () => {
    const words = Array.from({ length: 80 }, (_, i) => 'w' + i).join(' ');
    const url = h.textFragmentUrl('http://h/p.html', { exact: words, prefix: '', suffix: '' });
    assert.strictEqual(url, 'http://h/p.html#:~:text=w0%20w1%20w2%20w3%20w4,'
        + 'w75%20w76%20w77%20w78%20w79');
});

test('textFragmentUrl splits short quotes with a line break without overlap', () => {
    const url = h.textFragmentUrl('http://h/p.html',
        { exact: 'here.\nSecond line', prefix: '', suffix: '' });
    assert.strictEqual(url, 'http://h/p.html#:~:text=here.,line');
});

test('textFragmentUrl keeps a one-word quote with a line break whole', () => {
    const url = h.textFragmentUrl('http://h/p.html', { exact: '\nword\n', prefix: '', suffix: '' });
    assert.strictEqual(url, 'http://h/p.html#:~:text=word');
});

test('validateImport accepts only well-formed files', () => {
    const entry = { id: 'a', kind: 'highlight', path: 'x.html', created: '2026-01-01',
        quote: { exact: 'q', prefix: '', suffix: '' } };
    assert.deepStrictEqual(h.validateImport({ version: 1, entries: [entry] }), [entry]);
    assert.strictEqual(h.validateImport({ version: 1 }), null);
    assert.strictEqual(h.validateImport({ version: 1, entries: [{ ...entry, kind: 'x' }] }), null);
    assert.strictEqual(h.validateImport({ version: 1, entries: [{ ...entry, quote: null }] }),
        null);
    assert.strictEqual(h.validateImport('str'), null);
});

test('mergeEntries adds new ids and keeps existing ones', () => {
    const existing = [{ id: 'a' }, { id: 'b', note: 'mine' }];
    const incoming = [{ id: 'b', note: 'theirs' }, { id: 'c' }];
    const result = h.mergeEntries(existing, incoming);
    assert.deepStrictEqual(result.entries.map(x => x.id), ['a', 'b', 'c']);
    assert.strictEqual(result.entries[1].note, 'mine');
    assert.strictEqual(result.added, 1);
    assert.strictEqual(result.skipped, 1);
});
