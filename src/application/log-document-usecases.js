function copyLogText({ clipboard, text }) {
	clipboard.copyToClipboard(text);
}

async function exportLogs({ workspace, window, logs }) {
	const doc = await workspace.openTextDocument({ content: logs, language: 'log' });
	await window.showTextDocument(doc);
	return doc;
}

module.exports = {
	copyLogText,
	exportLogs,
};
