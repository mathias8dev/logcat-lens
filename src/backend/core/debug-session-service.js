const vscode = require('vscode');
const EventEmitter = require('events');

const ACTIVE_SESSION_ID = '__active_debug_session__';
const TERMINAL_CATEGORY = 'terminal';
const BUFFERED_LOG_LIMIT = 5000;
const ANDROID_PRIORITY_PATTERN = '[VDIWEF]';
const JAVA_LEVEL_PATTERN = 'TRACE|DEBUG|INFO|INFORMATION|LOG|NOTICE|WARN|WARNING|ERROR|ERR|FATAL|CRITICAL|CRIT|SEVERE|FINEST|FINER|FINE|CONFIG|SILLY|VERBOSE|EMERG|EMERGENCY|ALERT';
const JAVA_LOGGER_PATTERN = '[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)+';
const ANDROID_LOGGER_PATTERN = '[^\\s:()]+(?:\\s+[^\\s:()]+)*';
const ANDROID_LEVEL_RE = new RegExp(`\\b(${ANDROID_PRIORITY_PATTERN})\\b`);
const JAVA_LEVEL_RE = new RegExp(`\\b(${JAVA_LEVEL_PATTERN})\\b`, 'i');
const LOGGER_RE = new RegExp(`^${JAVA_LOGGER_PATTERN}$`);
const DEBUG_TERMINAL_COMMAND_RE = /(^|[\s"'=/\\])(java|gradle|gradlew|mvn|mvnw|kotlin|kotlinc)([\s"'$]|$)/i;
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

function parseDebugLogLine(line) {
	const rawText = (line || '').trim();
	const text = stripAnsi(rawText);
	if (!text) return null;

	const androidLog = parseAndroidLogLine(rawText, text);
	if (androidLog) return androidLog;

	const structuredLog = parseStructuredJsonLogLine(rawText, text);
	if (structuredLog) return structuredLog;

	const javaLog = parseJavaLogLine(rawText, text);
	if (javaLog) return javaLog;

	const frameworkLog = parseFrameworkLogLine(rawText, text);
	if (frameworkLog) return frameworkLog;

	const genericLog = parseGenericLogLine(rawText, text);
	if (genericLog) return genericLog;

	return null;
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
	return rawText.slice(rawIndexForVisibleIndex(rawText, visibleStart)).trim() || rawText;
}

class DebugSessionService extends EventEmitter {
	#running = false;
	#targetSessionId = ACTIVE_SESSION_ID;
	#currentSessionId = '';
	#sessions = new Map();
	#tags = new Set(['console', 'stdout', 'stderr']);
	#packages = new Set();
	#logBuffers = new Map();
	#warnedTerminalSessions = new Set();
	#terminalExecutions = new WeakSet();
	#disposables = [];
	lastParams;

	constructor(context) {
		super();

		this.#disposables.push(
			vscode.debug.registerDebugAdapterTrackerFactory('*', {
				createDebugAdapterTracker: (session) => this.#createTracker(session),
			}),
			vscode.debug.onDidStartDebugSession((session) => {
				this.#rememberSession(session);
				this.#bindCurrentSession(session);
				this.#emitDevicesChanged();
			}),
			vscode.debug.onDidTerminateDebugSession((session) => {
				this.#handleSessionEnded(session);
			}),
			vscode.debug.onDidChangeActiveDebugSession((session) => {
				if (session) {
					this.#rememberSession(session);
					this.#bindCurrentSession(session);
				}
				this.#emitDevicesChanged();
			})
		);

		if (typeof vscode.window.onDidStartTerminalShellExecution === 'function') {
			this.#disposables.push(
				vscode.window.onDidStartTerminalShellExecution((event) => {
					this.#onTerminalShellExecution(event);
				})
			);
		}

		if (vscode.debug.activeDebugSession) this.#rememberSession(vscode.debug.activeDebugSession);
		context?.subscriptions?.push(...this.#disposables);
	}

	listDevices() {
		const active = vscode.debug.activeDebugSession;
		const currentLabel = active
			? `Current: ${this.#sessionLabel(active)}`
			: 'Current Debug Session';
		const devices = [{
			id: ACTIVE_SESSION_ID,
			model: currentLabel,
			status: 'online',
			raw: active ? this.#sessionInfo(active) : null,
			platform: 'debug',
			kind: 'debug-session',
		}];

		for (const session of this.#sessions.values()) {
			devices.push({
				id: session.id,
				model: this.#sessionLabel(session),
				status: 'online',
				raw: this.#sessionInfo(session),
				platform: 'debug',
				kind: 'debug-session',
			});
		}

		return Promise.resolve(devices);
	}

	listPackages() {
		const names = new Set();
		for (const pkg of this.#packages) {
			names.add(pkg);
		}
		for (const session of this.#sessions.values()) {
			names.add(session.name || session.type || session.id);
		}
		const active = vscode.debug.activeDebugSession;
		if (active) names.add(active.name || active.type || active.id);
		return Promise.resolve([...names].sort());
	}

	listTags() {
		return Promise.resolve([...this.#tags].sort());
	}

	getPackageInfo(deviceId, packageName) {
		return Promise.resolve({
			packageName,
			version: 'debug session',
			versionCode: deviceId || '',
		});
	}

	start(params = {}) {
		this.lastParams = params;
		this.#targetSessionId = params.deviceId || ACTIVE_SESSION_ID;
		this.#currentSessionId = this.#targetSessionId === ACTIVE_SESSION_ID
			? vscode.debug.activeDebugSession?.id || ''
			: this.#targetSessionId;
		this.#running = true;
		const active = vscode.debug.activeDebugSession;
		if (active) this.#rememberSession(active);
		this.#warnIfTerminalBacked(this.#sessionForTarget(this.#targetSessionId));
		this.#replayBufferedLogs();
		return Promise.resolve();
	}

	stop() {
		this.#running = false;
		this.#currentSessionId = '';
	}

	clear() {}

	updatePackages() {}

	restart(params) {
		this.stop();
		return this.start(params || this.lastParams);
	}

	launchApp() {
		return Promise.reject(new Error('Debug session launch actions are not supported from Logcat Lens.'));
	}

	forceStopApp(deviceId) {
		const session = this.#sessionForTarget(deviceId);
		if (!session) return Promise.reject(new Error('No matching debug session is active.'));
		return vscode.debug.stopDebugging(session);
	}

	clearAppData() {
		return Promise.reject(new Error('Clear data is not supported for debug sessions.'));
	}

	startDeviceTracking() {}
	stopDeviceTracking() {}

	dispose() {
		this.stop();
		this.#disposables.forEach(disposable => disposable.dispose());
		this.#disposables = [];
	}

	#createTracker(session) {
		this.#rememberSession(session);
		this.#emitDevicesChanged();
		return {
			onDidSendMessage: (message) => this.#onDebugAdapterMessage(session, message),
			onError: (error) => {
				if (!this.#running || !this.#shouldEmit(session)) return;
				this.emit('debugevent', { type: 'debug.error', data: error.message || String(error) });
			},
			onExit: () => {
				this.#handleSessionEnded(session);
			},
		};
	}

	#onDebugAdapterMessage(session, message) {
		if (message?.type !== 'event' || message.event !== 'output') return;

		const body = message.body || {};
		const category = body.category || 'console';
		this.#tags.add(category);

		const output = cleanOutput(body.output);
		if (!output) return;

		const lines = output.endsWith('\n') ? output.slice(0, -1).split('\n') : output.split('\n');
		for (const line of lines) {
			this.#emitLogLine(session, category, line, body);
		}
	}

	#onTerminalShellExecution(event) {
		const session = this.#sessionForTerminalExecution(event);
		if (!session) return;

		this.#readTerminalExecution(session, event).catch(error => {
			if (!this.#running || !this.#shouldEmit(session)) return;
			this.emit('debugevent', { type: 'debug.error', data: error.message || String(error) });
		});
	}

	async #readTerminalExecution(session, event) {
		const execution = event.execution;
		if (!execution || this.#terminalExecutions.has(execution)) return;
		this.#terminalExecutions.add(execution);

		let pending = '';
		for await (const chunk of execution.read()) {
			const output = cleanTerminalOutput(chunk);
			if (!output) continue;

			pending += output;
			const lines = pending.split('\n');
			pending = lines.pop() || '';
			for (const line of lines) {
				this.#emitTerminalLine(session, line, event);
			}
		}

		if (pending) this.#emitTerminalLine(session, pending, event);
	}

	#emitTerminalLine(session, line, event) {
		const commandLine = (event.execution.commandLine?.value || '').trim();
		const trimmed = (line || '').trim();
		if (!trimmed || trimmed === commandLine) return;

		this.#emitLogLine(session, TERMINAL_CATEGORY, line, {
			terminalName: event.terminal?.name || '',
			commandLine,
		});
	}

	#emitLogLine(session, category, line, body = {}) {
		if (!line) return;

		const parsedLog = parseDebugLogLine(line);
		if (parsedLog?.logger) this.#tags.add(parsedLog.logger);
		if (parsedLog?.pkg) this.#packages.add(parsedLog.pkg);
		this.#tags.add(category);
		const log = this.#toLog(session, category, line, body, parsedLog);
		this.#bufferLog(session, log);

		if (!this.#running || !this.#shouldEmit(session)) return;
		this.emit('debugevent', {
			type: 'debug.log',
			data: log,
		});
	}

	#sessionForTerminalExecution(event) {
		const sessions = this.#knownSessions();
		const commandLine = event.execution?.commandLine?.value || '';
		const cwd = event.execution?.cwd?.fsPath || '';
		const commandLooksRelevant = this.#looksLikeDebugTerminalCommand(commandLine);

		const active = vscode.debug.activeDebugSession;
		if (active && this.#terminalExecutionMatchesSession(active, cwd)) {
			this.#rememberSession(active);
			return active;
		}

		const target = this.#sessionForTarget(this.#targetSessionId);
		if (target && this.#terminalExecutionMatchesSession(target, cwd)) return target;

		if (!commandLooksRelevant) return null;
		return sessions.find(session => this.#terminalExecutionMatchesSession(session, cwd)) || null;
	}

	#knownSessions() {
		const sessions = [...this.#sessions.values()];
		const active = vscode.debug.activeDebugSession;
		if (active && !sessions.some(session => session.id === active.id)) sessions.push(active);
		return sessions;
	}

	#terminalExecutionMatchesSession(session, cwd) {
		if (!session || !this.#usesIntegratedTerminal(session)) return false;
		if (!cwd) return true;

		const sessionCwd = session.configuration?.cwd || session.workspaceFolder?.uri?.fsPath || '';
		const workspacePath = session.workspaceFolder?.uri?.fsPath || '';
		return this.#samePathOrChild(cwd, sessionCwd) || this.#samePathOrChild(cwd, workspacePath);
	}

	#usesIntegratedTerminal(session) {
		return session?.configuration?.console === 'integratedTerminal';
	}

	#looksLikeDebugTerminalCommand(commandLine) {
		return DEBUG_TERMINAL_COMMAND_RE.test(commandLine || '');
	}

	#samePathOrChild(path, base) {
		if (!path || !base) return false;
		const normalizedPath = path.replace(/\/+$/, '');
		const normalizedBase = base.replace(/\/+$/, '');
		return normalizedPath === normalizedBase || normalizedPath.startsWith(`${normalizedBase}/`);
	}

	#toLog(session, category, message, body, parsedLog) {
		const isTerminal = category === TERMINAL_CATEGORY;
		return {
			timestamp: parsedLog?.timestamp || formatTimestamp(),
			pid: parsedLog?.pid || '',
			tid: parsedLog?.tid || (body.threadId ? String(body.threadId) : ''),
			priority: parsedLog?.priority || mapPriority(category),
			tag: parsedLog?.logger || category,
			message: parsedLog?.message || message,
			pkg: parsedLog?.pkg || session.name || session.type || session.id,
			platform: 'debug',
			sessionId: session.id,
			sessionType: session.type,
			debugCategory: category,
			terminalName: isTerminal ? body.terminalName || '' : undefined,
			commandLine: isTerminal ? body.commandLine || '' : undefined,
		};
	}

	#bufferLog(session, log) {
		if (!session?.id) return;
		const buffer = this.#logBuffers.get(session.id) || [];
		buffer.push(log);
		if (buffer.length > BUFFERED_LOG_LIMIT) {
			buffer.splice(0, buffer.length - BUFFERED_LOG_LIMIT);
		}
		this.#logBuffers.set(session.id, buffer);
	}

	#replayBufferedLogs() {
		for (const session of this.#sessionsForCurrentTarget()) {
			const buffer = this.#logBuffers.get(session.id) || [];
			for (const log of buffer) {
				this.emit('debugevent', { type: 'debug.log', data: log });
			}
		}
	}

	#sessionsForCurrentTarget() {
		if (this.#targetSessionId !== ACTIVE_SESSION_ID) {
			const session = this.#sessions.get(this.#targetSessionId);
			return session ? [session] : [];
		}

		const active = vscode.debug.activeDebugSession;
		if (active) return [active];
		if (this.#currentSessionId) {
			const current = this.#sessions.get(this.#currentSessionId);
			if (current) return [current];
		}
		return [];
	}

	#shouldEmit(session) {
		if (this.#targetSessionId === ACTIVE_SESSION_ID) {
			const active = vscode.debug.activeDebugSession;
			if (!active || active.id !== session.id) return false;
			if (!this.#currentSessionId) this.#currentSessionId = session.id;
			return this.#currentSessionId === session.id;
		}
		return this.#targetSessionId === session.id;
	}

	#sessionForTarget(target) {
		if (target && target !== ACTIVE_SESSION_ID) return this.#sessions.get(target);
		return vscode.debug.activeDebugSession;
	}

	#rememberSession(session) {
		if (!session?.id) return;
		this.#sessions.set(session.id, session);
	}

	#bindCurrentSession(session) {
		if (!session?.id || !this.#running) return;
		if (this.#targetSessionId === ACTIVE_SESSION_ID && !this.#currentSessionId) {
			this.#currentSessionId = session.id;
		}
		this.#warnIfTerminalBacked(session);
	}

	#warnIfTerminalBacked(session) {
		if (!session?.id || !this.#usesIntegratedTerminal(session) || this.#warnedTerminalSessions.has(session.id)) return;
		this.#warnedTerminalSessions.add(session.id);
		this.emit('debugevent', {
			type: 'debug.warning',
			data: 'This debug session writes to VS Code Terminal. VS Code does not expose that terminal output to extensions, so Logcat Lens can only capture it if the launch configuration uses "console": "internalConsole".',
		});
	}

	#handleSessionEnded(session) {
		const removed = this.#sessions.delete(session.id);
		this.#emitDevicesChanged();
		const isSelectedSession = this.#targetSessionId === session.id
			|| (this.#targetSessionId === ACTIVE_SESSION_ID && this.#currentSessionId === session.id);
		if (removed && this.#running && isSelectedSession) {
			this.#running = false;
			this.#currentSessionId = '';
			this.emit('debugevent', { type: 'debug.closed', data: 0 });
		}
	}

	#sessionLabel(session) {
		const type = session.type ? ` (${session.type})` : '';
		return `${session.name || session.id}${type}`;
	}

	#sessionInfo(session) {
		return {
			id: session.id,
			name: session.name,
			type: session.type,
			workspaceFolder: session.workspaceFolder?.uri?.fsPath || '',
		};
	}

	#emitDevicesChanged() {
		this.emit('debugevent', { type: 'debug.devices-changed' });
	}
}

DebugSessionService.ACTIVE_SESSION_ID = ACTIVE_SESSION_ID;

module.exports = DebugSessionService;
