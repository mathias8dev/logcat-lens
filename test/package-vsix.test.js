const test = require('node:test');
const assert = require('node:assert/strict');

const {
	artifactVersionFor,
	executableInvocation,
	packageDisplayNameFor,
	packageOptions,
	timestampSuffix,
} = require('../scripts/package-vsix');

test('creates timestamped artifact versions by default', () => {
	const date = new Date(2026, 6, 8, 1, 22, 43);

	assert.equal(timestampSuffix(date), '20260708012243');
	assert.equal(artifactVersionFor('3.1.0', 'timestamped', date), '3.1.0-20260708012243');
});

test('creates experimental artifact versions and display names', () => {
	const date = new Date(2026, 6, 8, 1, 22, 43);

	assert.equal(artifactVersionFor('3.1.0', 'experimental', date), '3.1.0-experimental-20260708012243');
	assert.equal(packageDisplayNameFor('LogView Universal', 'experimental'), 'LogView Universal Experimental');
});

test('keeps release artifact versions and display names unchanged', () => {
	assert.equal(artifactVersionFor('3.1.0', 'release'), '3.1.0');
	assert.equal(packageDisplayNameFor('LogView Universal', 'release'), 'LogView Universal');
});

test('parses package options', () => {
	assert.deepEqual(packageOptions([]), {
		mode: 'timestamped',
		createTag: false,
		help: false,
		out: '',
	});
	assert.deepEqual(packageOptions(['experimental', '--tag', '--out', '/tmp/logview-universal.vsix']), {
		mode: 'experimental',
		createTag: true,
		help: false,
		out: '/tmp/logview-universal.vsix',
	});
});

test('runs javascript executables with node', () => {
	assert.deepEqual(executableInvocation('/tmp/vsce.js', ['package']), {
		command: process.execPath,
		args: ['/tmp/vsce.js', 'package'],
	});
	assert.deepEqual(executableInvocation('/usr/bin/vsce', ['package']), {
		command: '/usr/bin/vsce',
		args: ['package'],
	});
});
