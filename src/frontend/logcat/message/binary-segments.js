(function defineBinarySegments(root, factory) {
	if (typeof module === 'object' && module.exports) {
		module.exports = factory(require('./media-sniffer'));
		return;
	}
	root.LogViewUniversalBinarySegments = factory(root.LogViewUniversalMediaSniffer);
})(typeof globalThis !== 'undefined' ? globalThis : this, function createBinarySegments(media) {
	const MAX_ENCODED_LENGTH = 1_000_000;
	const JSON_MIN_LENGTH = 40;

	function scanBalancedJson(value, start) {
		const open = value[start];
		const close = open === '{' ? '}' : ']';
		let depth = 0;
		let inString = false;

		for (let index = start; index < value.length; index += 1) {
			const char = value[index];
			if (inString) {
				if (char === '\\') {
					index += 1;
					continue;
				}
				if (char === '"') inString = false;
			} else {
				if (char === '"') inString = true;
				else if (char === '{' || char === '[') depth += 1;
				else if (char === '}' || char === ']') {
					depth -= 1;
					if (depth === 0) return char === close ? index : -1;
				}
			}
		}

		return -1;
	}

	function findJsonBlocks(raw) {
		const out = [];
		for (let index = 0; index < raw.length; index += 1) {
			const char = raw[index];
			if (char !== '{' && char !== '[') continue;
			const end = scanBalancedJson(raw, index);
			if (end < 0) continue;
			const len = end - index + 1;
			if (len < JSON_MIN_LENGTH) {
				index = end;
				continue;
			}
			const text = raw.slice(index, end + 1);
			try {
				const parsed = JSON.parse(text);
				if (parsed && typeof parsed === 'object') {
					out.push({ kind: 'json', start: index, end: end + 1, text });
				}
			} catch {
				// Not a valid JSON block.
			}
			index = end;
		}
		return out;
	}

	function binaryHits(raw) {
		const patterns = [
			{ kind: 'dataurl', re: /data:([a-z]+\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=_-]+)/g },
			{ kind: 'b64', re: /\b[A-Za-z0-9+/_-]{32,}={0,2}/g },
			{ kind: 'hex', re: /\b[0-9a-fA-F]{16,}\b/g },
		];
		const hits = [];

		for (const { kind, re } of patterns) {
			re.lastIndex = 0;
			let match;
			while ((match = re.exec(raw)) !== null) {
				if (match[0].length > MAX_ENCODED_LENGTH) continue;
				let mime = null;
				let payload = null;
				let enc = null;

				if (kind === 'dataurl') {
					mime = match[1];
					payload = match[2];
					enc = 'b64';
				} else if (kind === 'b64') {
					payload = match[0];
					const head = media.b64DecodeHead(payload, 16);
					mime = head ? media.sniffMime(head) : null;
					enc = 'b64';
				} else {
					payload = match[0].length % 2 === 0 ? match[0] : match[0].slice(0, -1);
					const head = media.hexDecodeHead(payload, 16);
					mime = head ? media.sniffMime(head) : null;
					enc = 'hex';
				}

				if (!mime) continue;
				hits.push({ start: match.index, end: match.index + match[0].length, mime, payload, enc });
			}
		}

		return hits;
	}

	function orderedNonOverlappingHits(hits) {
		hits.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
		const kept = [];
		let cursor = 0;
		for (const hit of hits) {
			if (hit.start < cursor) continue;
			kept.push(hit);
			cursor = hit.end;
		}
		return kept;
	}

	function segmentLogMessage(raw = '') {
		const hits = [
			...findJsonBlocks(raw),
			...binaryHits(raw),
		];

		if (hits.length === 0) return [{ type: 'text', value: raw }];

		const segments = [];
		let pos = 0;
		for (const hit of orderedNonOverlappingHits(hits)) {
			if (hit.start > pos) segments.push({ type: 'text', value: raw.slice(pos, hit.start) });
			if (hit.kind === 'json') {
				segments.push({ type: 'json', text: hit.text });
			} else {
				const size = hit.enc === 'b64'
					? Math.floor(hit.payload.replace(/=+$/, '').length * 3 / 4)
					: Math.floor(hit.payload.length / 2);
				segments.push({ type: 'binary', mime: hit.mime, payload: hit.payload, enc: hit.enc, size });
			}
			pos = hit.end;
		}
		if (pos < raw.length) segments.push({ type: 'text', value: raw.slice(pos) });
		return segments;
	}

	return {
		findJsonBlocks,
		scanBalancedJson,
		segmentLogMessage,
	};
});
