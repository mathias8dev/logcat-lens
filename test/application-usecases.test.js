const test = require('node:test');
const assert = require('node:assert/strict');

const { copyLogText, exportLogs } = require('../src/application/log-document-usecases');
const {
	clearLogStream,
	restartLogStream,
	startLogStream,
	stopLogStream,
} = require('../src/application/log-stream-usecases');

function registry() {
	const calls = [];
	const services = {
		android: {
			start: async data => calls.push(['android.start', data]),
			restart: async data => calls.push(['android.restart', data]),
			stop: () => calls.push(['android.stop']),
			clear: () => calls.push(['android.clear']),
		},
		debug: {
			start: async data => calls.push(['debug.start', data]),
			restart: async data => calls.push(['debug.restart', data]),
			stop: () => calls.push(['debug.stop']),
			clear: () => calls.push(['debug.clear']),
		},
	};
	return {
		calls,
		service: source => services[source],
		stopInactive: source => calls.push(['stopInactive', source]),
	};
}

test('starts and restarts log streams through the registry', async () => {
	const reg = registry();
	const state = { activeSource: 'android', paused: true };

	await startLogStream({ registry: reg, state, source: 'debug', data: { session: 's1' } });
	await restartLogStream({ registry: reg, state, source: 'android', data: { device: 'd1' } });

	assert.deepEqual(state, { activeSource: 'android', paused: false });
	assert.deepEqual(reg.calls, [
		['stopInactive', 'debug'],
		['debug.start', { session: 's1' }],
		['stopInactive', 'android'],
		['android.restart', { device: 'd1' }],
	]);
});

test('stops and clears log streams through the registry', () => {
	const reg = registry();
	const state = { activeSource: 'android', paused: true };

	stopLogStream({ registry: reg, state, source: 'debug' });
	clearLogStream({ registry: reg, source: 'android' });

	assert.equal(state.paused, false);
	assert.deepEqual(reg.calls, [
		['debug.stop'],
		['android.clear'],
	]);
});

test('copies and exports log text through ports', async () => {
	const copied = [];
	const shown = [];
	const doc = { uri: 'untitled:log' };
	const clipboard = { copyToClipboard: text => copied.push(text) };
	const workspace = {
		openTextDocument: async options => {
			assert.deepEqual(options, { content: 'hello', language: 'log' });
			return doc;
		},
	};
	const window = { showTextDocument: async value => shown.push(value) };

	copyLogText({ clipboard, text: 'line' });
	assert.equal(await exportLogs({ workspace, window, logs: 'hello' }), doc);

	assert.deepEqual(copied, ['line']);
	assert.deepEqual(shown, [doc]);
});

test('strips ansi sequences from exported logs by default', async () => {
	const opened = [];
	const workspace = {
		openTextDocument: async options => {
			opened.push(options);
			return { uri: 'untitled:log' };
		},
	};
	const window = { showTextDocument: async () => {} };

	await exportLogs({ workspace, window, logs: '\u001b[32mDEBUG\u001b[0m plain' });
	await exportLogs({ workspace, window, logs: '\u001b[32mDEBUG\u001b[0m plain', stripAnsi: false });

	assert.deepEqual(opened.map(options => options.content), [
		'DEBUG plain',
		'\u001b[32mDEBUG\u001b[0m plain',
	]);
});
