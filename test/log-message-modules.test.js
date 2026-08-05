const test = require('node:test');
const assert = require('node:assert/strict');

const media = require('../src/frontend/logcat/message/media-sniffer');
const { findJsonBlocks, scanBalancedJson, segmentLogMessage } = require('../src/frontend/logcat/message/binary-segments');
const { formatLogMessage, linkifyEscapedText } = require('../src/frontend/logcat/message/message-formatting');
const { formatAnsiText } = require('../src/frontend/logcat/ansi-renderer');

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
const PDF_HEX = '255044462d312e370a25';

test('sniffs common media from base64 and hex heads', () => {
	assert.equal(media.sniffMime(media.b64DecodeHead(PNG_B64, 16)), 'image/png');
	assert.equal(media.sniffMime(media.hexDecodeHead(PDF_HEX, 16)), 'application/pdf');
	assert.equal(media.toBase64(PDF_HEX, 'hex').startsWith('JVBERi0x'), true);
	assert.equal(media.isInlineMediaMime('image/png'), true);
	assert.equal(media.isInlineMediaMime('application/pdf'), false);
});

test('finds balanced JSON blocks and ignores short objects', () => {
	const json = '{"items":[{"id":1,"name":"alpha"}],"next":null}';
	const raw = `prefix ${json} suffix`;

	assert.equal(scanBalancedJson(raw, raw.indexOf('{')), raw.indexOf(json) + json.length - 1);
	assert.deepEqual(findJsonBlocks('short {"a":1}'), []);
	assert.deepEqual(findJsonBlocks(raw), [{
		kind: 'json',
		start: 7,
		end: 7 + json.length,
		text: json,
	}]);
});

test('segments text, JSON and binary payloads in order', () => {
	const json = '{"items":[{"id":1,"name":"alpha"}],"next":null}';
	const segments = segmentLogMessage(`before ${json} image ${PNG_B64} after`);

	assert.deepEqual(segments.map(segment => segment.type), ['text', 'json', 'text', 'binary', 'text']);
	assert.equal(segments[1].text, json);
	assert.equal(segments[3].mime, 'image/png');
	assert.equal(segments[3].enc, 'b64');
});

test('formats log messages using host callbacks', () => {
	const html = formatLogMessage(`see https://example.com ${PNG_B64}`, 12, {
		ansiRenderer: { formatAnsiText },
		escapeHtml: value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
		renderBinaryChip: (segment, index) => `[${index}:${segment.mime}:${segment.size}]`,
		segmentLogMessage,
	});

	assert.equal(html, 'see <a href="https://example.com" class="log-link" target="_blank" rel="noopener">https://example.com</a> [12:image/png:24]');
	assert.equal(linkifyEscapedText('x https://example.com/path.'), 'x <a href="https://example.com/path" class="log-link" target="_blank" rel="noopener">https://example.com/path</a>.');
});
