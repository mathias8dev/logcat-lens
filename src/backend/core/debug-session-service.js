const vscode = require('vscode');
const EventEmitter = require('events');
const { cleanOutput, cleanTerminalOutput, formatTimestamp, mapPriority, parseDebugLogLine } = require('../parsers/debug-log-parser');
const { PARSERS, SOURCES, SOURCE_EVENT_KINDS, normalizeParser, sourceEventType } = require('../../protocol/shared/contracts');

const ACTIVE_SESSION_ID = '__active_debug_session__';
const TERMINAL_CATEGORY = 'terminal';
const BUFFERED_LOG_LIMIT = 5000;
const DEBUG_TERMINAL_COMMAND_RE = /(^|[\s"'=/\\])(java|gradle|gradlew|mvn|mvnw|kotlin|kotlinc)([\s"'$]|$)/i;
const DEBUG_SOURCE = SOURCES.DEBUG;

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
	#parserId = PARSERS.DEBUG_AUTO;
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
			platform: DEBUG_SOURCE,
			kind: 'debug-session',
		}];

		for (const session of this.#sessions.values()) {
			devices.push({
				id: session.id,
				model: this.#sessionLabel(session),
				status: 'online',
				raw: this.#sessionInfo(session),
				platform: DEBUG_SOURCE,
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
		this.#parserId = normalizeParser(params.parser, SOURCES.DEBUG);
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
		return Promise.reject(new Error('Debug session launch actions are not supported from LogView Universal.'));
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
				this.emit('debugevent', { type: sourceEventType(DEBUG_SOURCE, SOURCE_EVENT_KINDS.ERROR), data: error.message || String(error) });
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
			this.emit('debugevent', { type: sourceEventType(DEBUG_SOURCE, SOURCE_EVENT_KINDS.ERROR), data: error.message || String(error) });
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

		const parsedLog = parseDebugLogLine(line, this.#parserId);
		if (parsedLog?.logger) this.#tags.add(parsedLog.logger);
		if (parsedLog?.pkg) this.#packages.add(parsedLog.pkg);
		this.#tags.add(category);
		const log = this.#toLog(session, category, line, body, parsedLog);
		this.#bufferLog(session, log);

		if (!this.#running || !this.#shouldEmit(session)) return;
		this.emit('debugevent', {
			type: sourceEventType(DEBUG_SOURCE, SOURCE_EVENT_KINDS.LOG),
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
			platform: DEBUG_SOURCE,
			parser: parsedLog?.parser || this.#parserId,
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
				this.emit('debugevent', { type: sourceEventType(DEBUG_SOURCE, SOURCE_EVENT_KINDS.LOG), data: log });
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
			type: sourceEventType(DEBUG_SOURCE, SOURCE_EVENT_KINDS.WARNING),
			data: 'This debug session writes to VS Code Terminal. VS Code does not expose that terminal output to extensions, so LogView Universal can only capture it if the launch configuration uses "console": "internalConsole".',
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
			this.emit('debugevent', { type: sourceEventType(DEBUG_SOURCE, SOURCE_EVENT_KINDS.CLOSED), data: 0 });
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
		this.emit('debugevent', { type: sourceEventType(DEBUG_SOURCE, SOURCE_EVENT_KINDS.DEVICES_CHANGED) });
	}
}

DebugSessionService.ACTIVE_SESSION_ID = ACTIVE_SESSION_ID;

module.exports = DebugSessionService;
