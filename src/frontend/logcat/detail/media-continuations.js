(function defineMediaContinuations(root, factory) {
	if (typeof module === 'object' && module.exports) {
		module.exports = factory(require('../message/media-sniffer'));
		return;
	}
	root.LogViewUniversalMediaContinuations = factory(root.LogViewUniversalMediaSniffer);
})(typeof globalThis !== 'undefined' ? globalThis : this, function createMediaContinuations(media) {
	const PURE_B64 = /^[A-Za-z0-9+/=]+$/;
	const SHORT_MARKER = /^[A-Za-z_]{1,16}$/;

	function sourceKey(log) {
		return `${log.tag}|${log.pid}|${log.tid}`;
	}

	function sameSourceAs(target) {
		return log => log && log.tag === target.tag && log.pid === target.pid && log.tid === target.tid;
	}

	function classifyMediaContinuation(log, mediaSources) {
		const key = sourceKey(log);
		const message = (log.message || '').trim();
		const b64Match = message.match(/[A-Za-z0-9+/]{32,}={0,2}/);
		if (b64Match) {
			const head = media.b64DecodeHead(b64Match[0], 16);
			const mime = head ? media.sniffMime(head) : null;
			if (media.isInlineMediaMime(mime)) {
				mediaSources.set(key, true);
				return;
			}
		}

		if (!mediaSources.get(key)) return;

		if (PURE_B64.test(message) || SHORT_MARKER.test(message)) {
			log._mediaContinuation = true;
			return;
		}

		mediaSources.delete(key);
	}

	function collectMediaBlob(buffer, bufIdx) {
		const clicked = buffer[bufIdx];
		if (!clicked) return null;
		const sameSource = sameSourceAs(clicked);

		let headerIdx = -1;
		let mime = '';
		let firstChunk = '';
		for (let index = bufIdx; index >= 0; index -= 1) {
			const log = buffer[index];
			if (!sameSource(log)) continue;
			const message = (log.message || '').trim();
			const b64Match = message.match(/[A-Za-z0-9+/]{32,}={0,2}/);
			if (!b64Match) {
				if (index < bufIdx) break;
				continue;
			}
			const head = media.b64DecodeHead(b64Match[0], 16);
			const detectedMime = head ? media.sniffMime(head) : null;
			if (media.isInlineMediaMime(detectedMime)) {
				headerIdx = index;
				mime = detectedMime;
				firstChunk = message.substring(b64Match.index);
				break;
			}
		}
		if (headerIdx < 0) return null;

		let b64 = firstChunk.replace(/[^A-Za-z0-9+/=].*$/, '');
		for (let index = headerIdx + 1; index < buffer.length; index += 1) {
			const log = buffer[index];
			if (!sameSource(log)) continue;
			const message = (log.message || '').trim();
			if (!message) continue;
			if (PURE_B64.test(message)) {
				b64 += message;
				continue;
			}
			if (SHORT_MARKER.test(message)) continue;
			break;
		}

		const unpadded = b64.replace(/=+$/, '');
		const size = Math.floor(unpadded.length * 3 / 4);
		return { type: 'binary', mime, size, payload: b64, enc: 'b64' };
	}

	return {
		classifyMediaContinuation,
		collectMediaBlob,
	};
});
