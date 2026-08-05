function renderMainWebviewHtml({ webview, extensionUri, nonce, vscode }) {
	const uri = (path) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, path));

	return `
		<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta http-equiv="Content-Security-Policy" content="img-src https: data:; style-src 'unsafe-inline' ${webview.cspSource};">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">

			<link href="${uri('src/frontend/style.css')}" rel="stylesheet">
			<script nonce="${nonce}" src="${uri('src/protocol/shared/contracts.js')}"></script>
			<script nonce="${nonce}" src="${uri('src/frontend/core/html-element-base.js')}"></script>

			<link href="${uri('src/frontend/logcat/logview.css')}" rel="stylesheet">
			<script nonce="${nonce}" src="${uri('src/frontend/logcat/ansi-renderer.js')}"></script>
			<script nonce="${nonce}" src="${uri('src/frontend/logcat/log-filter-model.js')}"></script>
			<script nonce="${nonce}" src="${uri('src/frontend/logcat/message/media-sniffer.js')}"></script>
			<script nonce="${nonce}" src="${uri('src/frontend/logcat/message/binary-segments.js')}"></script>
			<script nonce="${nonce}" src="${uri('src/frontend/logcat/message/message-formatting.js')}"></script>
			<script nonce="${nonce}" src="${uri('src/frontend/logcat/detail/media-continuations.js')}"></script>
			<script nonce="${nonce}" src="${uri('src/frontend/logcat/detail/json-detail.js')}"></script>
			<script nonce="${nonce}" src="${uri('src/frontend/logcat/detail/log-detail-pane.js')}"></script>
			<script nonce="${nonce}" src="${uri('src/frontend/logcat/logview-template.js')}"></script>
			<script nonce="${nonce}" src="${uri('src/frontend/logcat/controls/chrome-controls.js')}"></script>
			<script nonce="${nonce}" src="${uri('src/frontend/logcat/controls/package-controls.js')}"></script>
			<script nonce="${nonce}" src="${uri('src/frontend/logcat/controls/tag-controls.js')}"></script>
			<script nonce="${nonce}" src="${uri('src/frontend/logcat/viewport/log-viewport.js')}"></script>
			<script nonce="${nonce}" src="${uri('src/frontend/logcat/search/search-controls.js')}"></script>
			<script nonce="${nonce}" src="${uri('src/frontend/logcat/ingestion/log-ingestion.js')}"></script>
			<script nonce="${nonce}" src="${uri('src/frontend/logcat/logview.js')}"></script>
		</head>

		<body data-vscode-context='{ "preventDefaultContextMenuItems": true }'>
			<logview-universal></logview-universal>
		</body>
		</html>
	`;
}

module.exports = {
	renderMainWebviewHtml,
};
