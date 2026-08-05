(function defineMessageFormatting(root, factory) {
	if (typeof module === 'object' && module.exports) {
		module.exports = factory();
		return;
	}
	root.LogViewUniversalMessageFormatting = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function createMessageFormatting() {
	function linkifyEscapedText(html) {
		return html.replace(
			/\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]}]/g,
			(url) => `<a href="${url}" class="log-link" target="_blank" rel="noopener">${url}</a>`
		);
	}

	function formatAnsiText(text, { ansiRenderer, escapeHtml }) {
		return ansiRenderer.formatAnsiText(text, {
			escapeHtml,
			linkifyEscapedText,
		});
	}

	function formatJsonSegment(segment, { escapeHtml }) {
		return escapeHtml(segment.text);
	}

	function formatLogMessage(text, bufIdx, options) {
		const raw = text || '';
		const segments = options.segmentLogMessage(raw);
		let out = '';
		for (const segment of segments) {
			if (segment.type === 'binary') {
				out += options.renderBinaryChip(segment, bufIdx);
			} else if (segment.type === 'json') {
				out += formatJsonSegment(segment, options);
			} else {
				out += formatAnsiText(segment.value, options);
			}
		}
		return out;
	}

	return {
		formatAnsiText,
		formatJsonSegment,
		formatLogMessage,
		linkifyEscapedText,
	};
});
