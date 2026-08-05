const test = require('node:test');
const assert = require('node:assert/strict');

const { UI_MESSAGES } = require('../src/protocol/shared/contracts');
const { renderLogViewTemplate } = require('../src/frontend/logcat/logview-template');

test('renders logview shell with wired actions', () => {
	const html = renderLogViewTemplate({ handle: 'window.logview', UI_MESSAGES });

	assert.match(html, /id="adb-install-btn"/);
	assert.match(html, /id="log-detail-pane"/);
	assert.match(html, /id="parser-select"/);
	assert.match(html, /window\.logview\.postMessage/);
	assert.match(html, new RegExp(UI_MESSAGES.INSTALL_ADB));
});
