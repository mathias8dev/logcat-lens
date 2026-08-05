(function defineAnsiRenderer(root, factory) {
	if (typeof module === 'object' && module.exports) {
		module.exports = factory();
		return;
	}
	root.LogcatLensAnsiRenderer = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function createAnsiRenderer() {
	function formatAnsiText(text, options = {}) {
		const escapeHtml = options.escapeHtml || defaultEscapeHtml;
		const linkifyEscapedText = options.linkifyEscapedText || defaultLinkifyEscapedText;
		const raw = String(text ?? '');
		if (!/[\u001b\u009b]/.test(raw)) return linkifyEscapedText(escapeHtml(raw));

		const ansiPattern = /(?:\u001b\[|\u009b)([0-9;]*)m|(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/g;
		const style = {};
		let out = '';
		let pos = 0;
		let match;

		while ((match = ansiPattern.exec(raw)) !== null) {
			if (match.index > pos) {
				out += styledAnsiChunk(raw.slice(pos, match.index), style, escapeHtml, linkifyEscapedText);
			}
			if (match[1] !== undefined) applyAnsiCodes(match[1], style);
			pos = ansiPattern.lastIndex;
		}

		if (pos < raw.length) out += styledAnsiChunk(raw.slice(pos), style, escapeHtml, linkifyEscapedText);
		return out;
	}

	function styledAnsiChunk(text, style, escapeHtml, linkifyEscapedText) {
		if (!text) return '';
		const html = linkifyEscapedText(escapeHtml(text));
		const css = ansiStyleToCss(style);
		return css ? `<span class="log-ansi" style="${css}">${html}</span>` : html;
	}

	function applyAnsiCodes(params, style) {
		const codes = params === '' ? [0] : params.split(';').map(v => Number(v || 0));
		for (let i = 0; i < codes.length; i++) {
			const code = codes[i];
			if (code === 0) {
				for (const key of Object.keys(style)) delete style[key];
			} else if (code === 1) {
				style.bold = true;
			} else if (code === 2) {
				style.dim = true;
			} else if (code === 3) {
				style.italic = true;
			} else if (code === 4) {
				style.underline = true;
			} else if (code === 22) {
				delete style.bold;
				delete style.dim;
			} else if (code === 23) {
				delete style.italic;
			} else if (code === 24) {
				delete style.underline;
			} else if (code === 39) {
				delete style.fg;
			} else if (code === 49) {
				delete style.bg;
			} else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
				style.fg = ansiBasicColor(code, false);
			} else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) {
				style.bg = ansiBasicColor(code, true);
			} else if ((code === 38 || code === 48) && codes[i + 1] === 5 && Number.isFinite(codes[i + 2])) {
				style[code === 38 ? 'fg' : 'bg'] = ansi256Color(codes[i + 2]);
				i += 2;
			} else if ((code === 38 || code === 48) && codes[i + 1] === 2) {
				const r = codes[i + 2], g = codes[i + 3], b = codes[i + 4];
				if ([r, g, b].every(v => Number.isFinite(v) && v >= 0 && v <= 255)) {
					style[code === 38 ? 'fg' : 'bg'] = `rgb(${r}, ${g}, ${b})`;
				}
				i += 4;
			}
		}
	}

	function ansiStyleToCss(style) {
		const css = [];
		if (style.fg) css.push(`color:${style.fg}`);
		if (style.bg) css.push(`background-color:${style.bg}`);
		if (style.bold) css.push('font-weight:700');
		if (style.dim) css.push('opacity:.7');
		if (style.italic) css.push('font-style:italic');
		if (style.underline) css.push('text-decoration:underline');
		return css.join(';');
	}

	function ansiBasicColor(code, background) {
		const base = background ? (code >= 100 ? code - 100 + 8 : code - 40) : (code >= 90 ? code - 90 + 8 : code - 30);
		return [
			'#000000', '#cd3131', '#0dbc79', '#e5e510',
			'#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5',
			'#666666', '#f14c4c', '#23d18b', '#f5f543',
			'#3b8eea', '#d670d6', '#29b8db', '#ffffff',
		][base] || '';
	}

	function ansi256Color(value) {
		const n = Math.max(0, Math.min(255, Number(value) || 0));
		if (n < 16) return ansiBasicColor(n < 8 ? n + 30 : n + 82, false);
		if (n >= 232) {
			const level = 8 + (n - 232) * 10;
			return `rgb(${level}, ${level}, ${level})`;
		}
		const idx = n - 16;
		const r = Math.floor(idx / 36);
		const g = Math.floor((idx % 36) / 6);
		const b = idx % 6;
		const conv = v => v === 0 ? 0 : 55 + v * 40;
		return `rgb(${conv(r)}, ${conv(g)}, ${conv(b)})`;
	}

	function defaultEscapeHtml(text) {
		return String(text)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;');
	}

	function defaultLinkifyEscapedText(html) {
		return html.replace(
			/\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]}]/g,
			(url) => `<a href="${url}" class="log-link" target="_blank" rel="noopener">${url}</a>`
		);
	}

	return Object.freeze({
		formatAnsiText,
	});
});
