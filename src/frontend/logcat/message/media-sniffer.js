(function defineMediaSniffer(root, factory) {
	if (typeof module === 'object' && module.exports) {
		module.exports = factory();
		return;
	}
	root.LogViewUniversalMediaSniffer = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function createMediaSniffer() {
	function b64DecodeHead(value, byteCount) {
		try {
			const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
			const padded = normalized.length % 4
				? normalized + '='.repeat(4 - (normalized.length % 4))
				: normalized;
			const bin = atob(padded.slice(0, Math.max(24, Math.ceil(byteCount * 4 / 3) + 4)));
			const len = Math.min(bin.length, byteCount);
			const out = new Uint8Array(len);
			for (let index = 0; index < len; index += 1) out[index] = bin.charCodeAt(index);
			return out;
		} catch {
			return null;
		}
	}

	function hexDecodeHead(value, byteCount) {
		const len = Math.min(Math.floor(value.length / 2), byteCount);
		const out = new Uint8Array(len);
		for (let index = 0; index < len; index += 1) {
			const byte = parseInt(value.substr(index * 2, 2), 16);
			if (Number.isNaN(byte)) return null;
			out[index] = byte;
		}
		return out;
	}

	function sniffMime(bytes) {
		if (!bytes || bytes.length < 2) return null;
		if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'image/png';
		if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image/jpeg';
		if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif';
		if (bytes[0] === 0x42 && bytes[1] === 0x4D) return 'image/bmp';
		if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'application/pdf';
		if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return 'audio/mpeg';
		if (bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0) return 'audio/mpeg';
		if (bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04) return 'application/zip';
		if (bytes[0] === 0x4F && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) return 'audio/ogg';
		if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes.length >= 12) {
			if (bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45) return 'audio/wav';
			if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
		}
		return null;
	}

	function isInlineMediaMime(mime) {
		return /^(image|audio|video)\//.test(mime || '');
	}

	function toBase64(payload, enc) {
		if (enc === 'b64') {
			let value = payload.replace(/-/g, '+').replace(/_/g, '/');
			if (value.length % 4) value += '='.repeat(4 - (value.length % 4));
			return value;
		}

		const len = Math.floor(payload.length / 2);
		let bin = '';
		for (let index = 0; index < len; index += 1) {
			bin += String.fromCharCode(parseInt(payload.substr(index * 2, 2), 16));
		}
		return btoa(bin);
	}

	return {
		b64DecodeHead,
		hexDecodeHead,
		isInlineMediaMime,
		sniffMime,
		toBase64,
	};
});
