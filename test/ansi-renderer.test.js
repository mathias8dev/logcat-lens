const test = require('node:test');
const assert = require('node:assert/strict');

const { formatAnsiText } = require('../src/frontend/logcat/ansi-renderer');

test('escapes plain text and linkifies URLs', () => {
	const html = formatAnsiText('<b>see</b> https://example.com/path.');

	assert.equal(html, '&lt;b&gt;see&lt;/b&gt; <a href="https://example.com/path" class="log-link" target="_blank" rel="noopener">https://example.com/path</a>.');
});

test('renders ANSI color spans', () => {
	const html = formatAnsiText('\u001b[32mDEBUG\u001b[0m plain');

	assert.equal(html, '<span class="log-ansi" style="color:#0dbc79">DEBUG</span> plain');
});

test('renders ANSI 256 and truecolor spans', () => {
	const html = formatAnsiText('\u001b[38;5;196mred\u001b[0m \u001b[38;2;1;2;3mcustom\u001b[0m');

	assert.equal(html, '<span class="log-ansi" style="color:rgb(255, 0, 0)">red</span> <span class="log-ansi" style="color:rgb(1, 2, 3)">custom</span>');
});

test('allows host-provided escaping and linkifying hooks', () => {
	const html = formatAnsiText('\u001b[1mX\u001b[0m', {
		escapeHtml: value => `[${value}]`,
		linkifyEscapedText: value => `{${value}}`,
	});

	assert.equal(html, '<span class="log-ansi" style="font-weight:700">{[X]}</span>');
});
