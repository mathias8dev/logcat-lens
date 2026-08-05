const test = require('node:test');
const assert = require('node:assert/strict');

const { parseDebugLogLine } = require('../src/backend/parsers/debug-log-parser');
const { PARSERS } = require('../src/protocol/shared/contracts');

test('parses Spring Boot logs with logger, pid, level and package', () => {
	const line = '2026-07-08T01:22:43.234+02:00 DEBUG 1612561 --- [suza-backend] [or-http-epoll-5] o.s.w.s.adapter.HttpWebHandlerAdapter : [ad3b35ae-8] HTTP GET "/api/feed?page=0&size=10"';
	const parsed = parseDebugLogLine(line);

	assert.equal(parsed.priority, 'D');
	assert.equal(parsed.parser, PARSERS.DEBUG_SPRING);
	assert.equal(parsed.pid, '1612561');
	assert.equal(parsed.logger, 'o.s.w.s.adapter.HttpWebHandlerAdapter');
	assert.equal(parsed.pkg, 'o.s.w.s.adapter');
	assert.equal(parsed.message, '[ad3b35ae-8] HTTP GET "/api/feed?page=0&size=10"');
});

test('parses Android logcat threadtime lines', () => {
	const parsed = parseDebugLogLine('07-08 01:22:43.236 1612561 1612600 I stdout: Application started.');

	assert.equal(parsed.timestamp, '07-08 01:22:43.236');
	assert.equal(parsed.pid, '1612561');
	assert.equal(parsed.tid, '1612600');
	assert.equal(parsed.priority, 'I');
	assert.equal(parsed.logger, 'stdout');
	assert.equal(parsed.message, 'Application started.');
});

test('parses structured JSON logs', () => {
	const parsed = parseDebugLogLine('{"level":30,"time":1783473763236,"pid":42,"name":"api","service":"backend","msg":"started"}');

	assert.equal(parsed.priority, 'I');
	assert.equal(parsed.pid, '42');
	assert.equal(parsed.logger, 'api');
	assert.equal(parsed.pkg, 'backend');
	assert.equal(parsed.message, 'started');
});

test('parses Python logging output', () => {
	const parsed = parseDebugLogLine('ERROR:uvicorn.error:Application failed');

	assert.equal(parsed.priority, 'E');
	assert.equal(parsed.logger, 'uvicorn.error');
	assert.equal(parsed.message, 'Application failed');
});

test('parses Node style logs', () => {
	const parsed = parseDebugLogLine('[12:34:56] warn (123) server: Slow request');

	assert.equal(parsed.priority, 'W');
	assert.equal(parsed.pid, '123');
	assert.equal(parsed.logger, 'server');
	assert.equal(parsed.message, 'Slow request');
});

test('parses key-value Go/logfmt style logs', () => {
	const parsed = parseDebugLogLine('time=2026-07-08T01:22:43.234+02:00 level=error service=api pid=77 msg="request failed"');

	assert.equal(parsed.priority, 'E');
	assert.equal(parsed.pid, '77');
	assert.equal(parsed.logger, 'api');
	assert.equal(parsed.message, 'request failed');
});

test('parses .NET logger output', () => {
	const parsed = parseDebugLogLine('warn: Microsoft.AspNetCore.Hosting.Diagnostics[1] Request starting');

	assert.equal(parsed.priority, 'W');
	assert.equal(parsed.logger, 'Microsoft.AspNetCore.Hosting.Diagnostics');
	assert.equal(parsed.tid, '1');
	assert.equal(parsed.message, 'Request starting');
});

test('parses syslog output', () => {
	const parsed = parseDebugLogLine('Jul  8 01:22:43 host sshd[123]: Accepted publickey');

	assert.equal(parsed.priority, 'I');
	assert.equal(parsed.pid, '123');
	assert.equal(parsed.logger, 'sshd');
	assert.equal(parsed.message, 'Accepted publickey');
});

test('keeps ANSI sequences in parsed message slices', () => {
	const parsed = parseDebugLogLine('INFO com.example.App: \u001b[32mhello\u001b[0m');

	assert.equal(parsed.priority, 'I');
	assert.equal(parsed.logger, 'com.example.App');
	assert.equal(parsed.message, '\u001b[32mhello\u001b[0m');
});

test('can force a specific debug parser', () => {
	const springLine = '2026-07-08T01:22:43.234+02:00 DEBUG 1612561 --- [suza-backend] [or-http-epoll-5] o.s.w.s.adapter.HttpWebHandlerAdapter : Completed 200 OK';
	const jsonLine = '{"level":40,"service":"api","msg":"slow"}';

	assert.equal(parseDebugLogLine(springLine, PARSERS.DEBUG_JSON), null);
	assert.equal(parseDebugLogLine(springLine, PARSERS.DEBUG_SPRING).parser, PARSERS.DEBUG_SPRING);
	assert.equal(parseDebugLogLine(jsonLine, PARSERS.DEBUG_JSON).parser, PARSERS.DEBUG_JSON);
	assert.equal(parseDebugLogLine(jsonLine, PARSERS.DEBUG_SPRING), null);
});
