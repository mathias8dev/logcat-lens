const { stripAnsi: stripAnsiText } = require('./ansi-text');

function copyLogText({ clipboard, text }) {
	clipboard.copyToClipboard(text);
}

async function exportLogs({ workspace, window, logs, stripAnsi = true }) {
	const content = stripAnsi ? stripAnsiText(logs) : logs;
	const doc = await workspace.openTextDocument({ content, language: 'log' });
	await window.showTextDocument(doc);
	return doc;
}

module.exports = {
	copyLogText,
	exportLogs,
};
