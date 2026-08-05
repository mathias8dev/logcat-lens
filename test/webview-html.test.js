const test = require('node:test');
const assert = require('node:assert/strict');

const { renderMainWebviewHtml } = require('../src/backend/webview/main-webview-html');

test('renders the main webview html with protocol and webview assets', () => {
	const webview = {
		cspSource: 'vscode-resource:',
		asWebviewUri: uri => `webview:${uri.path}`,
	};
	const vscode = {
		Uri: {
			joinPath: (base, relativePath) => ({ path: `${base.path}/${relativePath}` }),
		},
	};

	const html = renderMainWebviewHtml({
		webview,
		extensionUri: { path: '/extension' },
		nonce: 'nonce-value',
		vscode,
	});

	assert.match(html, /src\/protocol\/shared\/contracts\.js/);
	assert.match(html, /src\/frontend\/logcat\/logview\.css/);
	assert.match(html, /src\/frontend\/logcat\/log-filter-model\.js/);
	assert.match(html, /src\/frontend\/logcat\/message\/media-sniffer\.js/);
	assert.match(html, /src\/frontend\/logcat\/message\/binary-segments\.js/);
	assert.match(html, /src\/frontend\/logcat\/message\/message-formatting\.js/);
	assert.match(html, /src\/frontend\/logcat\/detail\/media-continuations\.js/);
	assert.match(html, /src\/frontend\/logcat\/detail\/json-detail\.js/);
	assert.match(html, /src\/frontend\/logcat\/detail\/log-detail-pane\.js/);
	assert.match(html, /src\/frontend\/logcat\/logview-template\.js/);
	assert.match(html, /src\/frontend\/logcat\/controls\/chrome-controls\.js/);
	assert.match(html, /src\/frontend\/logcat\/controls\/package-controls\.js/);
	assert.match(html, /src\/frontend\/logcat\/controls\/tag-controls\.js/);
	assert.match(html, /src\/frontend\/logcat\/viewport\/log-viewport\.js/);
	assert.match(html, /src\/frontend\/logcat\/search\/search-controls\.js/);
	assert.match(html, /src\/frontend\/logcat\/ingestion\/log-ingestion\.js/);
	assert.match(html, /src\/frontend\/logcat\/logview\.js/);
	assert.ok(html.indexOf('log-filter-model.js') < html.indexOf('logview.js'));
	assert.ok(html.indexOf('media-sniffer.js') < html.indexOf('binary-segments.js'));
	assert.ok(html.indexOf('binary-segments.js') < html.indexOf('message-formatting.js'));
	assert.ok(html.indexOf('message-formatting.js') < html.indexOf('media-continuations.js'));
	assert.ok(html.indexOf('media-continuations.js') < html.indexOf('json-detail.js'));
	assert.ok(html.indexOf('json-detail.js') < html.indexOf('log-detail-pane.js'));
	assert.ok(html.indexOf('log-detail-pane.js') < html.indexOf('logview-template.js'));
	assert.ok(html.indexOf('logview-template.js') < html.indexOf('chrome-controls.js'));
	assert.ok(html.indexOf('chrome-controls.js') < html.indexOf('package-controls.js'));
	assert.ok(html.indexOf('package-controls.js') < html.indexOf('tag-controls.js'));
	assert.ok(html.indexOf('tag-controls.js') < html.indexOf('log-viewport.js'));
	assert.ok(html.indexOf('log-viewport.js') < html.indexOf('search-controls.js'));
	assert.ok(html.indexOf('search-controls.js') < html.indexOf('log-ingestion.js'));
	assert.ok(html.indexOf('log-ingestion.js') < html.indexOf('logview.js'));
	assert.match(html, /<logview-universal><\/logview-universal>/);
	assert.match(html, /nonce="nonce-value"/);
});
