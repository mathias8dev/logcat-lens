const { PARSERS, SOURCES, normalizeParser } = require('../../shared/contracts');

const ANDROID_PRIORITY_PATTERN = '[VDIWEF]';
const JAVA_LEVEL_PATTERN = 'TRACE|DEBUG|INFO|INFORMATION|LOG|NOTICE|WARN|WARNING|ERROR|ERR|FATAL|CRITICAL|CRIT|SEVERE|FINEST|FINER|FINE|CONFIG|SILLY|VERBOSE|EMERG|EMERGENCY|ALERT';
const JAVA_LOGGER_PATTERN = '[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)+';
const ANDROID_LOGGER_PATTERN = '[^\\s:()]+(?:\\s+[^\\s:()]+)*';
const ANDROID_LEVEL_RE = new RegExp(`\\b(${ANDROID_PRIORITY_PATTERN})\\b`);
const JAVA_LEVEL_RE = new RegExp(`\\b(${JAVA_LEVEL_PATTERN})\\b`, 'i');
const LOGGER_RE = new RegExp(`^${JAVA_LOGGER_PATTERN}$`);
const ANSI_RE = /[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
const ANDROID_LOG_PATTERNS = [
	new RegExp(`^(\\d{2}-\\d{2}\\s+\\d{2}:\\d{2}:\\d{2}\\.\\d{3})\\s+(\\d+)\\s+(\\d+)\\s+(${ANDROID_PRIORITY_PATTERN})\\s+([^:]+):\\s*(.*)$`),
	new RegExp(`^(\\d{4}-\\d{2}-\\d{2}\\s+\\d{2}:\\d{2}:\\d{2}\\.\\d{3})\\s+(\\d+)-(\\d+)(?:/\\S+)?\\s+(${ANDROID_PRIORITY_PATTERN})/(${ANDROID_LOGGER_PATTERN})\\s*:\\s*(.*)$`),
	new RegExp(`^(${ANDROID_PRIORITY_PATTERN})/(${ANDROID_LOGGER_PATTERN})\\s*\\(\\s*(\\d+)\\s*\\)\\s*:\\s*(.*)$`),
	new RegExp(`^(${ANDROID_PRIORITY_PATTERN})\\s+(${ANDROID_LOGGER_PATTERN})\\s*\\(\\s*(\\d+)\\s*\\)\\s*:\\s*(.*)$`),
];
const SPRING_BOOT_LOG_RE = new RegExp(`^(\\d{4}-\\d{2}-\\d{2}T\\S+)\\s+(${JAVA_LEVEL_PATTERN})\\s+(\\d+)\\s+---\\s+(?:\\[[^\\]]*\\]\\s+)+(${JAVA_LOGGER_PATTERN})\\s*:\\s*(.*)$`, 'i');
const GENERIC_LOG_PATTERNS = [
	new RegExp(`^(\\d{4}-\\d{2}-\\d{2}[T\\s]\\S+)\\s+\\[?(${JAVA_LEVEL_PATTERN})\\]?\\s+\\[([^\\]]+)\\]\\s*(.*)$`, 'i'),
	new RegExp(`^(\\d{4}-\\d{2}-\\d{2}[T\\s]\\S+)\\s+\\[?(${JAVA_LEVEL_PATTERN})\\]?\\s+([A-Za-z0-9_$./:-]+)\\s*(?::|-)\\s*(.*)$`, 'i'),
	new RegExp(`^\\[?(${JAVA_LEVEL_PATTERN})\\]?\\s+\\[([^\\]]+)\\]\\s*(.*)$`, 'i'),
	new RegExp(`^\\[?(${JAVA_LEVEL_PATTERN})\\]?\\s+([A-Za-z0-9_$./:-]+)\\s*(?::|-)\\s*(.*)$`, 'i'),
];
const PYTHON_LOG_PATTERNS = [
	new RegExp(`^(\\d{4}-\\d{2}-\\d{2}\\s+\\d{2}:\\d{2}:\\d{2}(?:[,.]\\d+)?)\\s+(${JAVA_LEVEL_PATTERN})\\s+([A-Za-z_$][\\w$.-]*)\\s*:\\s*(.*)$`, 'i'),
	new RegExp(`^(${JAVA_LEVEL_PATTERN}):([A-Za-z_$][\\w$.-]*):(.*)$`, 'i'),
];
const NODE_LOG_PATTERNS = [
	new RegExp(`^\\[(\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?)\\]\\s+(${JAVA_LEVEL_PATTERN})(?:\\s+\\((\\d+)\\))?(?:\\s+([A-Za-z0-9_$./:-]+))?\\s*:\\s*(.*)$`, 'i'),
	new RegExp(`^(${JAVA_LEVEL_PATTERN})\\s+\\[([^\\]]+)\\]\\s*(.*)$`, 'i'),
];
const NEST_LOG_RE = new RegExp(`^\\[Nest\\]\\s+(\\d+)\\s+-\\s+(.+?)\\s+(${JAVA_LEVEL_PATTERN})\\s+\\[([^\\]]+)\\]\\s*(.*)$`, 'i');
const RUST_LOG_PATTERNS = [
	new RegExp(`^(\\d{4}-\\d{2}-\\d{2}T\\S+)\\s+(${JAVA_LEVEL_PATTERN})\\s+([A-Za-z0-9_$:.-]+)\\s*:\\s*(.*)$`, 'i'),
	new RegExp(`^(${JAVA_LEVEL_PATTERN})\\s+([A-Za-z0-9_$:.-]+)\\s+>\\s+(.*)$`, 'i'),
];
const DOTNET_LOG_RE = new RegExp(`^(${JAVA_LEVEL_PATTERN})\\s*:\\s*([A-Za-z_$][\\w$.<>-]+)(?:\\[(\\d+)\\])?\\s*(.*)$`, 'i');
const RUBY_LOG_RE = new RegExp(`^([VDIWEF]),\\s+\\[(\\d{4}-\\d{2}-\\d{2}T[^\\s]+)\\s+#(\\d+)\\]\\s+(${JAVA_LEVEL_PATTERN})\\s+--\\s+([^:]+)\\s*:\\s*(.*)$`, 'i');
const LARAVEL_LOG_RE = new RegExp(`^\\[(\\d{4}-\\d{2}-\\d{2}\\s+\\d{2}:\\d{2}:\\d{2})\\]\\s+([A-Za-z0-9_-]+)\\.(${JAVA_LEVEL_PATTERN})\\s*:\\s*(.*)$`, 'i');
const SYSLOG_RE = /^<\d+>|^\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}/;
const JAVA_LOG_PATTERNS = [
	new RegExp(`^.*?\\b(${JAVA_LEVEL_PATTERN})\\s+\\d+\\s+---\\s+\\[[^\\]]*\\]\\s+(${JAVA_LOGGER_PATTERN})\\s*(?::|-)?\\s*(.*)$`, 'i'),
	new RegExp(`^.*?\\b(${JAVA_LEVEL_PATTERN})\\s+\\[[^\\]]*\\]\\s+(${JAVA_LOGGER_PATTERN})\\s*(?:-|:)\\s*(.*)$`, 'i'),
	new RegExp(`^\\[(${JAVA_LEVEL_PATTERN})\\]\\s+(${JAVA_LOGGER_PATTERN})\\s*(?:-|:)\\s*(.*)$`, 'i'),
	new RegExp(`^(${JAVA_LEVEL_PATTERN})\\s+(${JAVA_LOGGER_PATTERN})\\s*(?:-|:)\\s*(.*)$`, 'i'),
	new RegExp(`^.*?\\b(${JAVA_LEVEL_PATTERN})\\s+(${JAVA_LOGGER_PATTERN})\\s*(?:-|:)\\s*(.*)$`, 'i'),
	new RegExp(`^(${JAVA_LOGGER_PATTERN})\\s+(${JAVA_LEVEL_PATTERN}):\\s*(.*)$`, 'i'),
];

function formatTimestamp(value) {
	const date = value ? new Date(value) : new Date();
	if (Number.isNaN(date.getTime())) return formatTimestamp();
	return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} `
		+ `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:`
		+ `${String(date.getSeconds()).padStart(2, '0')}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}

function mapPriority(category) {
	const normalized = (category || '').toString().toLowerCase();
	if (normalized === 'stderr') return 'E';
	if (normalized === 'important') return 'W';
	if (normalized === 'telemetry') return 'V';
	return 'I';
}

function mapJavaPriority(level) {
	const normalized = (level || '').toString().toUpperCase();
	if (normalized === 'TRACE' || normalized === 'FINEST' || normalized === 'FINER' || normalized === 'SILLY' || normalized === 'VERBOSE') return 'V';
	if (normalized === 'DEBUG' || normalized === 'FINE') return 'D';
	if (normalized === 'INFO' || normalized === 'INFORMATION' || normalized === 'CONFIG' || normalized === 'LOG' || normalized === 'NOTICE') return 'I';
	if (normalized === 'WARN' || normalized === 'WARNING' || normalized === 'ALERT') return 'W';
	if (normalized === 'ERROR' || normalized === 'ERR' || normalized === 'SEVERE') return 'E';
	if (normalized === 'FATAL' || normalized === 'CRITICAL' || normalized === 'CRIT' || normalized === 'EMERG' || normalized === 'EMERGENCY') return 'F';
	return 'I';
}

function cleanOutput(value) {
	return (value ?? '').toString().replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function stripAnsi(value) {
	return (value ?? '').toString().replace(ANSI_RE, '');
}

function rawIndexForVisibleIndex(raw, visibleIndex) {
	let visible = 0;
	for (let i = 0; i < raw.length; i++) {
		const code = raw.charCodeAt(i);
		if ((code === 0x1b && raw[i + 1] === '[') || code === 0x9b) {
			const start = code === 0x9b ? i : i + 2;
			for (let j = start; j < raw.length; j++) {
				const final = raw.charCodeAt(j);
				if (final >= 0x40 && final <= 0x7e) {
					i = j;
					break;
				}
			}
			continue;
		}
		if (visible >= visibleIndex) return i;
		visible++;
	}
	return raw.length;
}

function cleanTerminalOutput(value) {
	return cleanOutput(value)
		.replace(/\u0007/g, '')
		.replace(/\u0008/g, '')
		.replace(/\t/g, '    ');
}

function isLoggerName(value) {
	return LOGGER_RE.test((value || '').trim());
}

function packageFromLogger(logger) {
	const parts = (logger || '').split('.').filter(Boolean);
	if (parts.length < 2) return logger || '';
	const last = parts[parts.length - 1];
	if (/^[A-Z_$]/.test(last) || last.includes('$')) return parts.slice(0, -1).join('.');
	return logger;
}

function normalizeJavaLogger(logger) {
	return (logger || '').replace(/\s+/g, '').replace(/:+$/, '');
}

function normalizeAndroidTag(tag) {
	return (tag || '').trim().replace(/\s+/g, ' ');
}

function parseDebugLogLine(line, parserId = PARSERS.DEBUG_AUTO) {
	const rawText = (line || '').trim();
	const text = stripAnsi(rawText);
	if (!text) return null;

	const normalizedParser = normalizeParser(parserId, SOURCES.DEBUG);
	for (const step of parserStepsFor(normalizedParser)) {
		const parsed = step.parse(rawText, text);
		if (parsed) return { parser: step.id, ...parsed };
	}

	return null;
}

function parserStepsFor(parserId) {
	const steps = [
		{ id: PARSERS.DEBUG_ANDROID, parse: parseAndroidLogLine },
		{ id: PARSERS.DEBUG_JSON, parse: parseStructuredJsonLogLine },
		{ id: PARSERS.DEBUG_SPRING, parse: parseSpringBootLogLine },
		{ id: PARSERS.DEBUG_JAVA, parse: parseJavaLogLine },
		{ id: PARSERS.DEBUG_PYTHON, parse: parsePythonLogLine },
		{ id: PARSERS.DEBUG_NODE, parse: parseNodeLogLine },
		{ id: PARSERS.DEBUG_NODE, parse: parseNestLogLine },
		{ id: PARSERS.DEBUG_GO, parse: parseGoLogLine },
		{ id: PARSERS.DEBUG_RUST, parse: parseRustLogLine },
		{ id: PARSERS.DEBUG_DOTNET, parse: parseDotNetLogLine },
		{ id: PARSERS.DEBUG_RUBY, parse: parseRubyLogLine },
		{ id: PARSERS.DEBUG_LARAVEL, parse: parseLaravelLogLine },
		{ id: PARSERS.DEBUG_SYSLOG, parse: parseSyslogLine },
		{ id: PARSERS.DEBUG_GENERIC, parse: parseGenericLogLine },
	];
	if (parserId === PARSERS.DEBUG_AUTO) return steps;
	return steps.filter(step => step.id === parserId);
}

function parseAndroidLogLine(rawText, text) {
	if (!ANDROID_LEVEL_RE.test(text)) return null;

	for (const pattern of ANDROID_LOG_PATTERNS) {
		const match = text.match(pattern);
		if (!match) continue;

		if (match.length === 7) {
			const [, timestamp, pid, tid, priority, tag, messageText] = match;
			const message = messageText.trim();
			return {
				timestamp,
				pid,
				tid,
				priority,
				logger: normalizeAndroidTag(tag),
				message: rawSliceForVisibleText(rawText, text, message),
			};
		}

		if (match.length === 5) {
			const [, priority, tag, pid, messageText] = match;
			const message = messageText.trim();
			return {
				pid,
				priority,
				logger: normalizeAndroidTag(tag),
				message: rawSliceForVisibleText(rawText, text, message),
			};
		}
	}

	return null;
}

function parseJavaLogLine(rawText, text) {
	if (!JAVA_LEVEL_RE.test(text)) return null;

	for (const pattern of JAVA_LOG_PATTERNS) {
		const match = text.match(pattern);
		if (!match) continue;

		const first = match[1];
		const second = match[2];
		const firstIsLogger = isLoggerName(first);
		const logger = normalizeJavaLogger(firstIsLogger ? first : second);
		const level = firstIsLogger ? second : first;
		if (!isLoggerName(logger)) continue;

		const message = (match[3] || text).trim() || text;
		return {
			level: level.toUpperCase(),
			priority: mapJavaPriority(level),
			logger,
			pkg: packageFromLogger(logger),
			message: rawSliceForVisibleText(rawText, text, message),
		};
	}

	return null;
}

function parseSpringBootLogLine(rawText, text) {
	if (!JAVA_LEVEL_RE.test(text)) return null;

	const springMatch = text.match(SPRING_BOOT_LOG_RE);
	if (springMatch) {
		const [, timestamp, level, pid, logger, messageText] = springMatch;
		const loggerName = normalizeJavaLogger(logger);
		const message = messageText.trim() || text;
		if (isLoggerName(loggerName)) {
			return {
				timestamp: formatTimestamp(timestamp),
				pid,
				level: level.toUpperCase(),
				priority: mapJavaPriority(level),
				logger: loggerName,
				pkg: packageFromLogger(loggerName),
				message: rawSliceForVisibleText(rawText, text, message),
			};
		}
	}

	return null;
}

function parseStructuredJsonLogLine(_rawText, text) {
	if (!text.startsWith('{')) return null;

	let data;
	try {
		data = JSON.parse(text);
	} catch {
		return null;
	}
	if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

	const level = firstValue(data, ['level', 'severity', 'logLevel', 'lvl', 'priority']);
	const message = firstValue(data, ['msg', 'message', 'event', 'eventMessage']);
	if (level == null && message == null) return null;

	const logger = firstValue(data, ['logger', 'name', 'context', 'category', 'source', 'component', 'module', 'service', 'scope']);
	const timestamp = normalizeTimestampValue(firstValue(data, ['time', 'timestamp', '@timestamp', 'date', 'datetime', 'ts']));
	const pid = firstValue(data, ['pid', 'processId', 'processID']);
	const tid = firstValue(data, ['tid', 'threadId', 'threadID', 'thread']);
	const messageText = stringifyLogValue(message ?? data);
	const priority = mapStructuredPriority(level);

	return {
		timestamp: timestamp ? formatTimestamp(timestamp) : undefined,
		pid: pid == null ? '' : String(pid),
		tid: tid == null ? '' : String(tid),
		priority,
		logger: logger == null ? 'json' : normalizeAndroidTag(String(logger)),
		pkg: data.service || data.app || data.application || '',
		message: messageText,
	};
}

function parseFrameworkLogLine(rawText, text) {
	return parsePythonLogLine(rawText, text)
		|| parseNodeLogLine(rawText, text)
		|| parseNestLogLine(rawText, text)
		|| parseGoLogLine(rawText, text)
		|| parseRustLogLine(rawText, text)
		|| parseDotNetLogLine(rawText, text)
		|| parseRubyLogLine(rawText, text)
		|| parseLaravelLogLine(rawText, text)
		|| parseSyslogLine(rawText, text);
}

function parsePythonLogLine(rawText, text) {
	for (const pattern of PYTHON_LOG_PATTERNS) {
		const match = text.match(pattern);
		if (!match) continue;

		if (match.length === 5) {
			const [, timestamp, level, logger, messageText] = match;
			const message = messageText.trim();
			return {
				timestamp: formatTimestamp(normalizeTimestampValue(timestamp)),
				level: level.toUpperCase(),
				priority: mapJavaPriority(level),
				logger: normalizeAndroidTag(logger),
				message: rawSliceForVisibleText(rawText, text, message),
			};
		}

		if (match.length === 4) {
			const [, level, logger, messageText] = match;
			const message = messageText.trim();
			return {
				level: level.toUpperCase(),
				priority: mapJavaPriority(level),
				logger: normalizeAndroidTag(logger),
				message: rawSliceForVisibleText(rawText, text, message),
			};
		}
	}
	return null;
}

function parseNodeLogLine(rawText, text) {
	for (const pattern of NODE_LOG_PATTERNS) {
		const match = text.match(pattern);
		if (!match) continue;

		if (match.length === 6) {
			const [, , level, pid, tag, messageText] = match;
			const message = messageText.trim();
			return {
				pid: pid || '',
				level: level.toUpperCase(),
				priority: mapJavaPriority(level),
				logger: tag ? normalizeAndroidTag(tag) : 'node',
				message: rawSliceForVisibleText(rawText, text, message),
			};
		}

		if (match.length === 4) {
			const [, level, tag, messageText] = match;
			const message = messageText.trim();
			return {
				level: level.toUpperCase(),
				priority: mapJavaPriority(level),
				logger: normalizeAndroidTag(tag),
				message: rawSliceForVisibleText(rawText, text, message),
			};
		}
	}
	return null;
}

function parseNestLogLine(rawText, text) {
	const match = text.match(NEST_LOG_RE);
	if (!match) return null;

	const [, pid, timestamp, level, context, messageText] = match;
	const message = messageText.trim();
	return {
		timestamp: formatTimestamp(normalizeTimestampValue(timestamp)),
		pid,
		level: level.toUpperCase(),
		priority: mapJavaPriority(level),
		logger: normalizeAndroidTag(context),
		message: rawSliceForVisibleText(rawText, text, message),
	};
}

function parseGoLogLine(rawText, text) {
	const keyValues = parseKeyValuePairs(text);
	if (keyValues.level || keyValues.msg || keyValues.message) {
		const message = keyValues.msg || keyValues.message || text;
		const level = keyValues.level || 'INFO';
		return {
			timestamp: keyValues.time || keyValues.timestamp ? formatTimestamp(normalizeTimestampValue(keyValues.time || keyValues.timestamp)) : undefined,
			pid: keyValues.pid || '',
			tid: keyValues.tid || keyValues.thread || '',
			level: level.toUpperCase(),
			priority: mapJavaPriority(level),
			logger: normalizeAndroidTag(keyValues.logger || keyValues.component || keyValues.module || keyValues.service || 'go'),
			message: rawSliceForVisibleText(rawText, text, message),
		};
	}

	const goMatch = text.match(/^(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s+(.*)$/);
	if (!goMatch) return null;

	const [, timestamp, message] = goMatch;
	return {
		timestamp: formatTimestamp(normalizeTimestampValue(timestamp)),
		priority: 'I',
		logger: 'go',
		message: rawSliceForVisibleText(rawText, text, message.trim()),
	};
}

function parseRustLogLine(rawText, text) {
	for (const pattern of RUST_LOG_PATTERNS) {
		const match = text.match(pattern);
		if (!match) continue;

		if (match.length === 5) {
			const [, timestamp, level, target, messageText] = match;
			const message = messageText.trim();
			return {
				timestamp: formatTimestamp(normalizeTimestampValue(timestamp)),
				level: level.toUpperCase(),
				priority: mapJavaPriority(level),
				logger: normalizeAndroidTag(target),
				message: rawSliceForVisibleText(rawText, text, message),
			};
		}

		if (match.length === 4) {
			const [, level, target, messageText] = match;
			const message = messageText.trim();
			return {
				level: level.toUpperCase(),
				priority: mapJavaPriority(level),
				logger: normalizeAndroidTag(target),
				message: rawSliceForVisibleText(rawText, text, message),
			};
		}
	}
	return null;
}

function parseDotNetLogLine(rawText, text) {
	const match = text.match(DOTNET_LOG_RE);
	if (!match) return null;

	const [, level, logger, eventId, messageText] = match;
	const message = messageText.trim();
	return {
		level: level.toUpperCase(),
		priority: mapJavaPriority(level),
		logger: normalizeAndroidTag(logger),
		tid: eventId || '',
		message: rawSliceForVisibleText(rawText, text, message),
	};
}

function parseRubyLogLine(rawText, text) {
	const match = text.match(RUBY_LOG_RE);
	if (!match) return null;

	const [, , timestamp, pid, level, logger, messageText] = match;
	const message = messageText.trim();
	return {
		timestamp: formatTimestamp(normalizeTimestampValue(timestamp)),
		pid,
		level: level.toUpperCase(),
		priority: mapJavaPriority(level),
		logger: normalizeAndroidTag(logger),
		message: rawSliceForVisibleText(rawText, text, message),
	};
}

function parseLaravelLogLine(rawText, text) {
	const match = text.match(LARAVEL_LOG_RE);
	if (!match) return null;

	const [, timestamp, channel, level, messageText] = match;
	const message = messageText.trim();
	return {
		timestamp: formatTimestamp(normalizeTimestampValue(timestamp)),
		level: level.toUpperCase(),
		priority: mapJavaPriority(level),
		logger: normalizeAndroidTag(channel),
		message: rawSliceForVisibleText(rawText, text, message),
	};
}

function parseSyslogLine(rawText, text) {
	if (!SYSLOG_RE.test(text)) return null;

	const line = text.replace(/^<\d+>/, '');
	const match = line.match(/^(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+\S+\s+([A-Za-z0-9_.-]+)(?:\[(\d+)\])?:\s*(.*)$/);
	if (!match) return null;

	const [, , tag, pid, messageText] = match;
	const message = messageText.trim();
	return {
		pid: pid || '',
		priority: 'I',
		logger: normalizeAndroidTag(tag),
		message: rawSliceForVisibleText(rawText, text, message),
	};
}

function firstValue(source, keys) {
	for (const key of keys) {
		if (source[key] != null) return source[key];
	}
	return undefined;
}

function stringifyLogValue(value) {
	if (value == null) return '';
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function normalizeTimestampValue(value) {
	if (value == null || value === '') return undefined;
	if (typeof value === 'number') {
		return value > 0 && value < 10_000_000_000 ? value * 1000 : value;
	}

	const text = String(value).trim();
	if (/^\d+$/.test(text)) {
		const numeric = Number(text);
		return numeric > 0 && numeric < 10_000_000_000 ? numeric * 1000 : numeric;
	}
	return text.replace(',', '.');
}

function mapStructuredPriority(level) {
	if (typeof level === 'number') {
		if (level < 20) return 'V';
		if (level < 30) return 'D';
		if (level < 40) return 'I';
		if (level < 50) return 'W';
		if (level < 60) return 'E';
		return 'F';
	}
	return mapJavaPriority(level);
}

function parseKeyValuePairs(text) {
	const values = {};
	const pattern = /([A-Za-z_][\w.-]*)=("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\S+)/g;
	let match;
	while ((match = pattern.exec(text)) !== null) {
		const key = match[1];
		let value = match[2];
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1).replace(/\\(["'\\])/g, '$1');
		}
		values[key] = value;
	}
	return values;
}

function parseGenericLogLine(rawText, text) {
	if (!JAVA_LEVEL_RE.test(text)) return null;

	for (const pattern of GENERIC_LOG_PATTERNS) {
		const match = text.match(pattern);
		if (!match) continue;

		if (match.length === 5) {
			const [, timestamp, level, tag, messageText] = match;
			const message = messageText.trim();
			return {
				timestamp: formatTimestamp(timestamp),
				level: level.toUpperCase(),
				priority: mapJavaPriority(level),
				logger: normalizeAndroidTag(tag),
				message: rawSliceForVisibleText(rawText, text, message),
			};
		}

		if (match.length === 4) {
			const [, level, tag, messageText] = match;
			const message = messageText.trim();
			return {
				level: level.toUpperCase(),
				priority: mapJavaPriority(level),
				logger: normalizeAndroidTag(tag),
				message: rawSliceForVisibleText(rawText, text, message),
			};
		}
	}

	return null;
}

function rawSliceForVisibleText(rawText, visibleText, visibleSlice) {
	if (!rawText.includes('\u001b') && !rawText.includes('\u009b')) return visibleSlice;

	const visibleStart = visibleText.lastIndexOf(visibleSlice);
	if (visibleStart < 0) return rawText;
	const rawStart = includeAdjacentLeadingAnsi(rawText, rawIndexForVisibleIndex(rawText, visibleStart));
	return rawText.slice(rawStart).trim() || rawText;
}

function includeAdjacentLeadingAnsi(rawText, rawStart) {
	let start = rawStart;
	let found = true;
	while (found) {
		found = false;
		const prefix = rawText.slice(0, start);
		const ansiPattern = /(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]$/;
		const match = prefix.match(ansiPattern);
		if (match) {
			start -= match[0].length;
			found = true;
		}
	}
	return start;
}

module.exports = {
	cleanOutput,
	cleanTerminalOutput,
	formatTimestamp,
	mapPriority,
	parseDebugLogLine,
};
