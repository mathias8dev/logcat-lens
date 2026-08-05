const test = require('node:test');
const assert = require('node:assert/strict');

const {
	LEVEL_ORDER,
	logMatchesQuery,
	rebuildFilteredIndices,
	searchMatchesForIndices,
	toggleLevelSelection,
} = require('../src/frontend/logcat/log-filter-model');

const logs = [
	{ priority: 'I', tag: 'Activity', pkg: 'com.app', text: 'activity started' },
	{ priority: 'D', tag: 'HTTP', pkg: 'com.app.api', text: 'http 200' },
	{ priority: 'E', tag: 'DB', pkg: 'com.app.db', text: 'db failed' },
	{ priority: 'L', tag: 'LogView Universal', pkg: '', text: 'foreground' },
	{ priority: 'I', tag: 'MEDIA', pkg: 'com.app', text: 'hidden media chunk', _mediaContinuation: true },
];

test('filters log indices by level, tag, package and search query', () => {
	const indices = rebuildFilteredIndices({
		buffer: logs,
		tags: ['HTTP'],
		selectedPackages: ['com.app'],
		selectedLevels: new Set(['D', 'E']),
		searchFilterMode: true,
		query: '200',
	});

	assert.deepEqual(indices, [1]);
});

test('keeps lifecycle rows controlled by lifecycle level', () => {
	assert.deepEqual(rebuildFilteredIndices({
		buffer: logs,
		selectedLevels: new Set(['I']),
	}), [0]);

	assert.deepEqual(rebuildFilteredIndices({
		buffer: logs,
		selectedLevels: new Set(['I', 'L']),
	}), [0, 3]);
});

test('searches against filtered indices', () => {
	assert.deepEqual(searchMatchesForIndices(logs, [0, 1, 2], 'app'), []);
	assert.deepEqual(searchMatchesForIndices(logs, [0, 1, 2], 'http'), [1]);
	assert.equal(logMatchesQuery(logs[2], 'FAILED'), true);
});

test('toggles levels while keeping at least one level selected', () => {
	const all = new Set(LEVEL_ORDER);
	const withoutInfo = toggleLevelSelection(all, 'I');
	assert.equal(withoutInfo.has('I'), false);

	const stillInfo = toggleLevelSelection(new Set(['I']), 'I');
	assert.deepEqual([...stillInfo], ['I']);
	assert.equal(toggleLevelSelection(new Set(['I']), 'D').has('D'), true);
});
