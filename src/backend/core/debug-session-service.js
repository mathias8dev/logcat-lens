const vscode = require('vscode');
const EventEmitter = require('events');

const ACTIVE_SESSION_ID = '__active_debug_session__';
const JAVA_LEVEL_PATTERN = 'TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL|SEVERE|FINEST|FINER|FINE|CONFIG';
const JAVA_LOGGER_PATTERN = '[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)+';
const JAVA_LEVEL_RE = new RegExp(`\\b(${JAVA_LEVEL_PATTERN})\\b`, 'i');
const LOGGER_RE = new RegExp(`^${JAVA_LOGGER_PATTERN}$`);
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
	const text = (line || '').trim();
	if (!text || !JAVA_LEVEL_RE.test(text)) return null;

	for (const pattern of JAVA_LOG_PATTERNS) {
		const match = text.match(pattern);
		if (!match) continue;

		const first = match[1];
		const second = match[2];
		const firstIsLogger = isLoggerName(first);
		const logger = normalizeJavaLogger(firstIsLogger ? first : second);
		const level = firstIsLogger ? second : first;
		if (!isLoggerName(logger)) continue;

		return {
			level: level.toUpperCase(),
			priority: mapJavaPriority(level),
			logger,
			pkg: packageFromLogger(logger),
			message: (match[3] || text).trim() || text,
		};
	}

	return null;
}

class DebugSessionService extends EventEmitter {
	#running = false;
	#targetSessionId = ACTIVE_SESSION_ID;
	#currentSessionId = '';
	#sessions = new Map();
	#tags = new Set(['console', 'stdout', 'stderr']);
	#packages = new Set();
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
		if (!this.#running || !this.#shouldEmit(session)) return;
		if (message?.type !== 'event' || message.event !== 'output') return;

		const body = message.body || {};
		const category = body.category || 'console';
		this.#tags.add(category);

		const output = cleanOutput(body.output);
		if (!output) return;

		const lines = output.endsWith('\n') ? output.slice(0, -1).split('\n') : output.split('\n');
		for (const line of lines) {
			if (!line) continue;
			const javaLog = parseJavaLogLine(line);
			if (javaLog?.logger) this.#tags.add(javaLog.logger);
			if (javaLog?.pkg) this.#packages.add(javaLog.pkg);
			this.emit('debugevent', {
				type: 'debug.log',
				data: this.#toLog(session, category, line, body, javaLog),
			});
		}
	}

	#toLog(session, category, message, body, parsedLog) {
		return {
			timestamp: formatTimestamp(),
			pid: '',
			tid: body.threadId ? String(body.threadId) : '',
			priority: parsedLog?.priority || mapPriority(category),
			tag: parsedLog?.logger || category,
			message: parsedLog?.message || message,
			pkg: parsedLog?.pkg || session.name || session.type || session.id,
			platform: 'debug',
			sessionId: session.id,
			sessionType: session.type,
			debugCategory: category,
		};
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
