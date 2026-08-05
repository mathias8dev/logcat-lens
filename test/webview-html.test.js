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
	assert.match(html, /src\/frontend\/logcat\/logview\.js/);
	assert.ok(html.indexOf('log-filter-model.js') < html.indexOf('logview.js'));
	assert.match(html, /<logview-universal><\/logview-universal>/);
	assert.match(html, /nonce="nonce-value"/);
});
