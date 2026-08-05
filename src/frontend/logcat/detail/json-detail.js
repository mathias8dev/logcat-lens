(function defineJsonDetail(root, factory) {
	if (typeof module === 'object' && module.exports) {
		module.exports = factory();
		return;
	}
	root.LogViewUniversalJsonDetail = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function createJsonDetail() {
	function softPrettyJson(text) {
		const indent = '  ';
		let out = '';
		let depth = 0;
		let inString = false;
		let escaped = false;

		for (let index = 0; index < text.length; index += 1) {
			const char = text[index];
			if (escaped) {
				out += char;
				escaped = false;
				continue;
			}
			if (inString) {
				out += char;
				if (char === '\\') escaped = true;
				else if (char === '"') inString = false;
				continue;
			}
			if (char === '"') {
				inString = true;
				out += char;
				continue;
			}
			if (char === '{' || char === '[') {
				depth += 1;
				out += char;
				if (text[index + 1] === '}' || text[index + 1] === ']') continue;
				out += '\n' + indent.repeat(depth);
				continue;
			}
			if (char === '}' || char === ']') {
				depth = Math.max(0, depth - 1);
				out += '\n' + indent.repeat(depth) + char;
				continue;
			}
			if (char === ',') {
				out += char + '\n' + indent.repeat(depth);
				continue;
			}
			if (char === ':') {
				out += ': ';
				continue;
			}
			out += char;
		}

		return out;
	}

	function sameSourceAs(log) {
		return candidate => candidate && candidate.tag === log.tag && candidate.pid === log.pid && candidate.tid === log.tid;
	}

	function collectSameSourceLines(buffer, bufIdx, log) {
		const sameSource = sameSourceAs(log);
		if (!sameSource(buffer[bufIdx])) return null;

		const before = [];
		for (let index = bufIdx - 1; index >= 0; index -= 1) {
			const candidate = buffer[index];
			if (!sameSource(candidate)) continue;
			before.push({ bufIdx: index, len: (candidate.message || '').length });
		}
		before.reverse();

		const after = [];
		for (let index = bufIdx + 1; index < buffer.length; index += 1) {
			const candidate = buffer[index];
			if (!sameSource(candidate)) continue;
			after.push({ bufIdx: index, len: (candidate.message || '').length });
		}

		const lines = [];
		let totalLen = 0;
		for (const item of before) {
			lines.push({ bufIdx: item.bufIdx, charStart: totalLen, charEnd: totalLen + item.len });
			totalLen += item.len;
		}
		const clickedCharStart = totalLen;
		const clickedMessage = buffer[bufIdx].message || '';
		lines.push({ bufIdx, charStart: clickedCharStart, charEnd: clickedCharStart + clickedMessage.length });
		totalLen += clickedMessage.length;
		const clickedCharEnd = totalLen;
		for (const item of after) {
			lines.push({ bufIdx: item.bufIdx, charStart: totalLen, charEnd: totalLen + item.len });
			totalLen += item.len;
		}

		return {
			clickedCharEnd,
			clickedCharStart,
			lines,
			text: lines.map(line => buffer[line.bufIdx].message).join(''),
		};
	}

	function lineCountForRange(lines, start, end = Infinity) {
		let lineCount = 0;
		for (const line of lines) {
			if (line.charEnd > start && line.charStart < end) lineCount += 1;
		}
		return lineCount;
	}

	function collectMultilineJsonBody(buffer, bufIdx, log) {
		const collection = collectSameSourceLines(buffer, bufIdx, log);
		if (!collection) return null;

		const { clickedCharEnd, clickedCharStart, lines, text } = collection;
		let depth = 0;
		let inString = false;
		let escaped = false;
		let openPos = -1;
		let lastUnclosedAtOrBeforeClick = -1;

		for (let index = 0; index < text.length; index += 1) {
			const char = text[index];
			if (escaped) {
				escaped = false;
				continue;
			}
			if (inString) {
				if (char === '\\') escaped = true;
				else if (char === '"') inString = false;
				continue;
			}
			if (char === '"') {
				inString = true;
				continue;
			}
			if (char === '{' || char === '[') {
				if (depth === 0) {
					openPos = index;
					if (index <= clickedCharEnd) lastUnclosedAtOrBeforeClick = index;
				}
				depth += 1;
			} else if (char === '}' || char === ']') {
				if (depth === 0) continue;
				depth -= 1;
				if (depth === 0 && openPos >= 0) {
					const closeEnd = index + 1;
					if (clickedCharStart >= openPos && clickedCharEnd <= closeEnd) {
						const candidate = text.slice(openPos, closeEnd);
						try {
							const parsed = JSON.parse(candidate);
							if (parsed && typeof parsed === 'object') {
								return { text: candidate, lineCount: lineCountForRange(lines, openPos, closeEnd) };
							}
						} catch {
							// Keep scanning.
						}
					}
					if (openPos === lastUnclosedAtOrBeforeClick) lastUnclosedAtOrBeforeClick = -1;
					openPos = -1;
				}
			}
		}

		if (lastUnclosedAtOrBeforeClick >= 0) {
			return {
				text: text.slice(lastUnclosedAtOrBeforeClick),
				lineCount: lineCountForRange(lines, lastUnclosedAtOrBeforeClick),
				truncated: true,
			};
		}
		return null;
	}

	return {
		collectMultilineJsonBody,
		softPrettyJson,
	};
});
