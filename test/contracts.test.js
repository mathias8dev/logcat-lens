const test = require('node:test');
const assert = require('node:assert/strict');

const {
	DEFAULT_SOURCE,
	SOURCES,
	SOURCE_EVENT_KINDS,
	UI_MESSAGES,
	VIEW_MESSAGES,
	isSource,
	normalizeSource,
	sourceEvent,
	sourceEventType,
} = require('../src/shared/contracts');

test('defines the stable log sources', () => {
	assert.equal(DEFAULT_SOURCE, SOURCES.ANDROID);
	assert.deepEqual(Object.values(SOURCES).sort(), ['android', 'debug', 'ios']);
	assert.equal(isSource(SOURCES.ANDROID), true);
	assert.equal(isSource('unknown'), false);
	assert.equal(normalizeSource('unknown'), SOURCES.ANDROID);
	assert.equal(normalizeSource('unknown', SOURCES.DEBUG), SOURCES.DEBUG);
});

test('maps source event type strings back to source and kind', () => {
	for (const source of Object.values(SOURCES)) {
		for (const kind of Object.values(SOURCE_EVENT_KINDS)) {
			const type = sourceEventType(source, kind);
			assert.deepEqual(sourceEvent(type), { source, kind, type });
		}
	}
});

test('keeps common message names centralized', () => {
	assert.equal(UI_MESSAGES.START, 'start');
	assert.equal(UI_MESSAGES.CHECK_ADB, 'check-adb');
	assert.equal(VIEW_MESSAGES.LOG, 'log');
	assert.equal(VIEW_MESSAGES.STOP, 'stop');
});
