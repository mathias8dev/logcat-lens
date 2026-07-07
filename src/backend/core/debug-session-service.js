const vscode = require('vscode');
const EventEmitter = require('events');

const ACTIVE_SESSION_ID = '__active_debug_session__';
const TERMINAL_CATEGORY = 'terminal';
const BUFFERED_LOG_LIMIT = 5000;
const JAVA_LEVEL_PATTERN = 'TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL|SEVERE|FINEST|FINER|FINE|CONFIG';
const JAVA_LOGGER_PATTERN = '[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)+';
const JAVA_LEVEL_RE = new RegExp(`\\b(${JAVA_LEVEL_PATTERN})\\b`, 'i');
const LOGGER_RE = new RegExp(`^${JAVA_LOGGER_PATTERN}$`);
const DEBUG_TERMINAL_COMMAND_RE = /(^|[\s"'=/\\])(java|gradle|gradlew|mvn|mvnw|kotlin|kotlinc)([\s"'$]|$)/i;
const ANSI_RE = /[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
const SPRING_BOOT_LOG_RE = new RegExp(`^(\\d{4}-\\d{2}-\\d{2}T\\S+)\\s+(${JAVA_LEVEL_PATTERN})\\s+(\\d+)\\s+---\\s+(?:\\[[^\\]]*\\]\\s+)+(${JAVA_LOGGER_PATTERN})\\s*:\\s*(.*)$`, 'i');
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
	if (normalized === 'TRACE' || normalized === 'FINEST' || normalized === 'FINER') return 'V';
	if (normalized === 'DEBUG' || normalized === 'FINE') return 'D';
	if (normalized === 'INFO' || normalized === 'CONFIG') return 'I';
	if (normalized === 'WARN' || normalized === 'WARNING') return 'W';
	if (normalized === 'ERROR' || normalized === 'SEVERE') return 'E';
	if (normalized === 'FATAL') return 'F';
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

function parseJavaLogLine(line) {
	const rawText = (line || '').trim();
	const text = stripAnsi(rawText);
	if (!text || !JAVA_LEVEL_RE.test(text)) return null;

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

		const javaLog = parseJavaLogLine(line);
		if (javaLog?.logger) this.#tags.add(javaLog.logger);
		if (javaLog?.pkg) this.#packages.add(javaLog.pkg);
		this.#tags.add(category);
		const log = this.#toLog(session, category, line, body, javaLog);
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
			tid: body.threadId ? String(body.threadId) : '',
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
