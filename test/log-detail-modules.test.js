const test = require('node:test');
const assert = require('node:assert/strict');

const { collectMultilineJsonBody, softPrettyJson } = require('../src/frontend/logcat/detail/json-detail');
const { logTitle, sizeLabel } = require('../src/frontend/logcat/detail/log-detail-pane');
const { classifyMediaContinuation, collectMediaBlob } = require('../src/frontend/logcat/detail/media-continuations');

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';

function log(message, overrides = {}) {
	return {
		message,
		pid: '42',
		tag: 'HTTP',
		tid: '7',
		...overrides,
	};
}

test('classifies base64 media continuation lines after a media header', () => {
	const mediaSources = new Map();
	const header = log(`image ${PNG_B64}`);
	const continuation = log('AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH');
	const marker = log('MEDIA_END');
	const next = log('regular message');

	classifyMediaContinuation(header, mediaSources);
	classifyMediaContinuation(continuation, mediaSources);
	classifyMediaContinuation(marker, mediaSources);
	classifyMediaContinuation(next, mediaSources);

	assert.equal(header._mediaContinuation, undefined);
	assert.equal(continuation._mediaContinuation, true);
	assert.equal(marker._mediaContinuation, true);
	assert.equal(next._mediaContinuation, undefined);
	assert.equal(mediaSources.size, 0);
});

test('formats detail pane labels', () => {
	assert.equal(sizeLabel(512), '512 B');
	assert.equal(sizeLabel(1536), '1.5 KB');
	assert.equal(logTitle({
		pkg: 'com.app',
		pid: '42',
		priority: 'I',
		tag: 'HTTP',
		timestamp: '08-05 12:00:00.000',
	}), '08-05 12:00:00.000  I  HTTP  com.app  pid=42');
	assert.equal(logTitle({
		pkg: '',
		pid: '',
		priority: 'D',
		tag: 'stdout',
		timestamp: 'now',
	}, 'JSON'), 'now  D  stdout    pid=  · JSON');
});

test('collects media blobs across same-source base64 chunks', () => {
	const buffer = [
		log(`prefix ${PNG_B64}`),
		log('QUJDREVGR0g'),
		log('MEDIA_END'),
		log('next regular line'),
	];

	const blob = collectMediaBlob(buffer, 1);

	assert.equal(blob.mime, 'image/png');
	assert.equal(blob.enc, 'b64');
	assert.equal(blob.payload, `${PNG_B64}QUJDREVGR0g`);
	assert.equal(blob.size > 24, true);
});

test('collects multiline JSON body containing the clicked line', () => {
	const buffer = [
		log('noise', { tag: 'Other' }),
		log('{"items":['),
		log('{"id":1,"name":"alpha"}'),
		log('],"next":null}'),
		log('trailing text'),
	];

	assert.deepEqual(collectMultilineJsonBody(buffer, 2, buffer[2]), {
		text: '{"items":[{"id":1,"name":"alpha"}],"next":null}',
		lineCount: 3,
	});
});

test('returns best-effort truncated JSON when the closing brace is missing', () => {
	const buffer = [
		log('prefix {"items":['),
		log('{"id":1}'),
	];

	assert.deepEqual(collectMultilineJsonBody(buffer, 1, buffer[1]), {
		text: '{"items":[{"id":1}',
		lineCount: 2,
		truncated: true,
	});
	assert.equal(softPrettyJson('{"a":1,"b":[2]}'), '{\n  "a": 1,\n  "b": [\n    2\n  ]\n}');
});
