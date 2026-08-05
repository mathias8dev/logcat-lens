const { spawn, execFile } = require('child_process');
const { mkdtemp, readFile, rm } = require('fs/promises');
const { accessSync, constants } = require('fs');
const { basename, join } = require('path');
const { tmpdir, platform } = require('os');
const { fileURLToPath } = require('url');
const EventEmitter = require('events');
const { SOURCES, SOURCE_EVENT_KINDS, sourceEventType } = require('../../shared/contracts');

const IOS_SOURCE = SOURCES.IOS;

function execFileAsync(file, args, opts = {}) {
	return new Promise((resolve, reject) => {
		execFile(file, args, { maxBuffer: 20 * 1024 * 1024, ...opts }, (error, stdout, stderr) => {
			if (error) {
				error.stdout = stdout;
				error.stderr = stderr;
				return reject(error);
			}
			resolve({ stdout, stderr });
		});
	});
}

function formatTimestamp(value) {
	const date = value ? new Date(value) : new Date();
	if (Number.isNaN(date.getTime())) return formatTimestamp();
	return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} `
		+ `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:`
		+ `${String(date.getSeconds()).padStart(2, '0')}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}

function mapPriority(value) {
	const normalized = (value || '').toString().toLowerCase();
	if (/\bfault\b|\bcritical\b|\bfatal\b/.test(normalized)) return 'F';
	if (/\berror\b/.test(normalized)) return 'E';
	if (/\bwarn/.test(normalized)) return 'W';
	if (/\binfo\b|\bnotice\b|default/.test(normalized)) return 'I';
	if (/\bdebug\b/.test(normalized)) return 'D';
	return 'V';
}

function collectBundleIds(value, out = new Set()) {
	if (!value || typeof value !== 'object') return out;
	if (typeof value.bundleIdentifier === 'string') out.add(value.bundleIdentifier);
	if (typeof value.bundleID === 'string') out.add(value.bundleID);
	if (typeof value.bundleId === 'string') out.add(value.bundleId);
	if (typeof value.CFBundleIdentifier === 'string') out.add(value.CFBundleIdentifier);
	for (const item of Array.isArray(value) ? value : Object.values(value)) {
		collectBundleIds(item, out);
	}
	return out;
}

function asString(value) {
	if (typeof value === 'string') return value.trim();
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	return '';
}

function firstString(value, keys) {
	for (const key of keys) {
		const str = asString(value?.[key]);
		if (str) return str;
	}
	return '';
}

function looksLikeBundleId(value) {
	return /^[A-Za-z0-9][A-Za-z0-9_-]*(\.[A-Za-z0-9][A-Za-z0-9_-]*)+$/.test(asString(value));
}

function normalizeLookup(value) {
	return asString(value).toLowerCase();
}

function normalizePathValue(value) {
	const raw = asString(value);
	if (!raw) return '';

	try {
		const path = raw.startsWith('file:') ? fileURLToPath(raw) : decodeURIComponent(raw);
		return path.replace(/\/+$/, '');
	} catch {
		return raw.replace(/\/+$/, '');
	}
}

function unquotePlistValue(value) {
	const raw = value.trim();
	if (!raw) return '';
	if (!raw.startsWith('"') || !raw.endsWith('"')) return raw;
	return raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function readQuoted(input, start) {
	let value = '';
	let escaped = false;
	for (let i = start + 1; i < input.length; i++) {
		const char = input[i];
		if (escaped) {
			value += char;
			escaped = false;
			continue;
		}
		if (char === '\\') {
			escaped = true;
			continue;
		}
		if (char === '"') return { value, end: i + 1 };
		value += char;
	}
	return { value, end: input.length };
}

function scanBalancedBlock(input, start) {
	let depth = 0;
	let inString = false;
	let escaped = false;

	for (let i = start; i < input.length; i++) {
		const char = input[i];
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
		} else if (char === '{') {
			depth++;
		} else if (char === '}') {
			depth--;
			if (depth === 0) return i;
		}
	}
	return -1;
}

function parsePlistFields(input) {
	const fields = {};
	let cursor = 0;

	while (cursor < input.length) {
		while (/\s/.test(input[cursor] || '')) cursor++;
		if (cursor >= input.length) break;

		let key = '';
		if (input[cursor] === '"') {
			const quoted = readQuoted(input, cursor);
			key = quoted.value;
			cursor = quoted.end;
		} else {
			const start = cursor;
			while (cursor < input.length && !/[\s=]/.test(input[cursor])) cursor++;
			key = input.slice(start, cursor).trim();
		}

		while (/\s/.test(input[cursor] || '')) cursor++;
		if (input[cursor] !== '=') {
			cursor++;
			continue;
		}
		cursor++;

		let depth = 0;
		let inString = false;
		let escaped = false;
		const valueStart = cursor;
		while (cursor < input.length) {
			const char = input[cursor];
			if (escaped) {
				escaped = false;
			} else if (inString) {
				if (char === '\\') escaped = true;
				else if (char === '"') inString = false;
			} else if (char === '"') {
				inString = true;
			} else if (char === '{' || char === '(') {
				depth++;
			} else if (char === '}' || char === ')') {
				depth--;
			} else if (char === ';' && depth === 0) {
				break;
			}
			cursor++;
		}

		if (key) fields[key] = unquotePlistValue(input.slice(valueStart, cursor));
		cursor++;
	}

	return fields;
}

function createAppRecord(value, fallbackBundleId = '') {
	if (!value || typeof value !== 'object') return null;
	const bundleId = firstString(value, ['bundleIdentifier', 'bundleID', 'bundleId', 'CFBundleIdentifier'])
		|| (looksLikeBundleId(fallbackBundleId) ? fallbackBundleId : '');
	if (!bundleId) return null;

	return {
		bundleId,
		executable: firstString(value, ['CFBundleExecutable', 'bundleExecutable', 'executable', 'executableName']),
		name: firstString(value, ['CFBundleName', 'name']),
		displayName: firstString(value, ['CFBundleDisplayName', 'displayName']),
		path: normalizePathValue(firstString(value, ['Path', 'path'])),
		bundlePath: normalizePathValue(firstString(value, ['Bundle', 'bundle', 'bundleURL', 'bundlePath', 'url'])),
		bundleContainerPath: normalizePathValue(firstString(value, ['BundleContainer', 'bundleContainer', 'bundleContainerPath'])),
		dataContainerPath: normalizePathValue(firstString(value, ['DataContainer', 'dataContainer', 'dataContainerPath'])),
	};
}

function collectAppRecords(value, out = [], fallbackBundleId = '') {
	if (!value || typeof value !== 'object') return out;
	if (Array.isArray(value)) {
		value.forEach(item => collectAppRecords(item, out));
		return out;
	}

	const record = createAppRecord(value, fallbackBundleId);
	if (record) out.push(record);

	for (const [key, item] of Object.entries(value)) {
		collectAppRecords(item, out, looksLikeBundleId(key) ? key : '');
	}
	return out;
}

function parseSimulatorAppList(output) {
	const records = [];
	const re = /"([^"]+)"\s*=\s*\{/g;
	let match;

	while ((match = re.exec(output)) !== null) {
		const open = output.indexOf('{', match.index);
		if (open < 0) continue;
		const close = scanBalancedBlock(output, open);
		if (close < 0) break;
		const fields = parsePlistFields(output.slice(open + 1, close));
		const record = createAppRecord(fields, match[1]);
		if (record) records.push(record);
		re.lastIndex = close + 1;
	}

	return records;
}

function appNameFromPath(path) {
	const name = basename(path || '');
	return name.endsWith('.app') ? name.slice(0, -4) : '';
}

function setUnique(map, value, bundleId) {
	const key = normalizeLookup(value);
	if (!key || !bundleId) return;
	const current = map.get(key);
	if (!map.has(key)) map.set(key, bundleId);
	else if (current !== bundleId) map.set(key, null);
}

function buildAppIndex(records) {
	const index = {
		bundleIds: new Set(),
		byBundleId: new Map(),
		byExecutable: new Map(),
		byPath: [],
	};
	const seen = new Set();

	for (const record of records) {
		if (!record?.bundleId) continue;
		const key = `${record.bundleId}|${record.executable}|${record.path}|${record.bundlePath}`;
		if (seen.has(key)) continue;
		seen.add(key);

		index.bundleIds.add(record.bundleId);
		index.byBundleId.set(normalizeLookup(record.bundleId), record.bundleId);
		[record.executable, record.name, record.displayName, appNameFromPath(record.path), appNameFromPath(record.bundlePath)]
			.forEach(value => setUnique(index.byExecutable, value, record.bundleId));
		[record.path, record.bundlePath, record.bundleContainerPath, record.dataContainerPath]
			.filter(Boolean)
			.forEach(path => index.byPath.push({ path, bundleId: record.bundleId }));
	}

	index.byPath.sort((a, b) => b.path.length - a.path.length);
	return index;
}

function parseAppListOutput(output) {
	try {
		return collectAppRecords(JSON.parse(output));
	} catch {
		return parseSimulatorAppList(output);
	}
}

function collectCoreDevices(value, out = []) {
	if (!value || typeof value !== 'object') return out;
	if (Array.isArray(value)) {
		value.forEach(item => collectCoreDevices(item, out));
		return out;
	}

	const props = value.deviceProperties || value.properties;
	const identifier = value.identifier || value.udid || value.UDID;
	const platformName = props?.platform || props?.platformName || value.platform || '';
	if (identifier && props && /ios|iphone|ipad/i.test(platformName || props.name || '')) {
		out.push(value);
	}

	Object.values(value).forEach(item => collectCoreDevices(item, out));
	return out;
}

async function withJsonOutput(run) {
	const dir = await mkdtemp(join(tmpdir(), 'logcat-universal-ios-'));
	const file = join(dir, 'output.json');
	try {
		await run(file);
		return JSON.parse(await readFile(file, 'utf8'));
	} finally {
		await rm(dir, { recursive: true, force: true }).catch(() => {});
	}
}

function findCommand(command) {
	const candidates = command.includes('/')
		? [command]
		: [
			...((process.env.PATH || '').split(':').filter(Boolean).map(dir => join(dir, command))),
			join('/opt/homebrew/bin', command),
			join('/usr/local/bin', command),
		];
	for (const candidate of candidates) {
		try {
			accessSync(candidate, constants.X_OK);
			return candidate;
		} catch { /* keep looking */ }
	}
	return null;
}

class IOSService extends EventEmitter {
	logProcess;
	devices = new Map();
	appIndexes = new Map();
	_stopping = false;

	async listDevices() {
		if (platform() !== 'darwin') {
			throw new Error('iOS logs require macOS with Xcode command line tools installed.');
		}

		const settled = await Promise.allSettled([
			this.#listSimulators(),
			this.#listPhysicalDevices(),
		]);

		const devices = [];
		for (const result of settled) {
			if (result.status === 'fulfilled') devices.push(...result.value);
		}

		const deduped = [];
		const seen = new Set();
		for (const device of devices) {
			if (seen.has(device.id)) continue;
			seen.add(device.id);
			deduped.push(device);
		}

		this.devices = new Map(deduped.map(device => [device.id, device]));

		if (!deduped.length) {
			const reason = settled.find(result => result.status === 'rejected')?.reason;
			if (reason) throw new Error(`No iOS devices or booted simulators found. ${reason.message || reason}`);
		}

		return deduped;
	}

	async #listSimulators() {
		const { stdout } = await execFileAsync('xcrun', ['simctl', 'list', 'devices', '--json']);
		const parsed = JSON.parse(stdout);
		const devicesByRuntime = parsed.devices || {};
		const devices = [];

		for (const [runtime, runtimeDevices] of Object.entries(devicesByRuntime)) {
			for (const device of runtimeDevices || []) {
				if (device.isAvailable === false) continue;
				devices.push({
					id: device.udid,
					model: `${device.name} (${runtime.replace(/^com\.apple\.CoreSimulator\.SimRuntime\./, '').replace(/-/g, ' ')})`,
					status: device.state === 'Booted' ? 'online' : 'offline',
					raw: device,
					platform: IOS_SOURCE,
					kind: 'simulator',
				});
			}
		}

		return devices;
	}

	async #listPhysicalDevices() {
		const parsed = await withJsonOutput((file) =>
			execFileAsync('xcrun', ['devicectl', 'list', 'devices', '--json-output', file], { timeout: 15000 })
		);
		const coreDevices = collectCoreDevices(parsed);

		return coreDevices.map(device => {
			const props = device.deviceProperties || device.properties || {};
			const connection = device.connectionProperties || {};
			const id = device.identifier || device.udid || device.UDID;
			const name = props.name || device.name || id;
			const osVersion = props.osVersionNumber || props.osVersion || '';
			const paired = !connection.pairingState || /paired|trusted/i.test(connection.pairingState);
			const unavailable = /unavailable/i.test(connection.tunnelState || device.state || '');

			return {
				id,
				model: `${name}${osVersion ? ` (${osVersion})` : ''}`,
				status: !paired ? 'unauthorized' : unavailable ? 'offline' : 'online',
					raw: device,
					platform: IOS_SOURCE,
					kind: 'device',
				};
		}).filter(device => device.id);
	}

	async listPackages(deviceId) {
		const device = this.devices.get(deviceId);
		if (device?.kind === 'device') return this.#listPhysicalApps(deviceId);
		return this.#listSimulatorApps(deviceId);
	}

	async #listSimulatorApps(deviceId) {
		try {
			const { stdout } = await execFileAsync('xcrun', ['simctl', 'listapps', deviceId, '--json']);
			return this.#setAppIndex(deviceId, parseAppListOutput(stdout));
		} catch {
			try {
				const { stdout } = await execFileAsync('xcrun', ['simctl', 'listapps', deviceId]);
				return this.#setAppIndex(deviceId, parseAppListOutput(stdout));
			} catch {
				this.appIndexes.set(deviceId, buildAppIndex([]));
				return [];
			}
		}
	}

	async #listPhysicalApps(deviceId) {
		try {
			const parsed = await withJsonOutput((file) =>
				execFileAsync('xcrun', ['devicectl', 'device', 'info', 'apps', '--device', deviceId, '--json-output', file], { timeout: 15000 })
			);
			const records = collectAppRecords(parsed);
			if (records.length) return this.#setAppIndex(deviceId, records);
			return this.#setAppIndex(deviceId, [...collectBundleIds(parsed)].map(bundleId => ({ bundleId })));
		} catch {
			this.appIndexes.set(deviceId, buildAppIndex([]));
			return [];
		}
	}

	#setAppIndex(deviceId, records) {
		const index = buildAppIndex(records);
		this.appIndexes.set(deviceId, index);
		return [...index.bundleIds].sort();
	}

	async listTags() {
		return [];
	}

	async getPackageInfo(deviceId, packageName) {
		const packages = await this.listPackages(deviceId);
		return {
			packageName,
			version: packages.includes(packageName) ? 'installed' : 'unknown',
			versionCode: '',
		};
	}

	async start({ deviceId, packages = [] }) {
		this.stop();
		this._stopping = false;
		if (!deviceId) throw new Error('Please select a booted iOS simulator or connected iOS device.');

		this.lastParams = { deviceId, packages };
		await this.listPackages(deviceId).catch(() => []);
		const device = this.devices.get(deviceId);
		if (device?.kind === 'device') return this.#startPhysicalDevice(deviceId);
		return this.#startSimulator(deviceId);
	}

	#startSimulator(deviceId) {
		const args = ['simctl', 'spawn', deviceId, 'log', 'stream', '--style', 'json', '--level', 'debug'];
		this.logProcess = spawn('xcrun', args);
		this.#wireJsonProcess(deviceId);
	}

	#startPhysicalDevice(deviceId) {
		const command = findCommand('idevicesyslog');
		if (!command) {
			throw new Error('Physical iOS device log streaming requires idevicesyslog from libimobiledevice. Simulator logs work with Xcode alone.');
		}

		this.logProcess = spawn(command, ['-u', deviceId]);
		this.#wireProcess((line) => this.#parsePlainLog(line, deviceId));
	}

	#wireJsonProcess(deviceId) {
		let jsonBuffer = '';
		let stderrBuffer = '';

		this.logProcess.stdout.on('data', (data) => {
			jsonBuffer += data.toString();
			const drained = this.#drainJsonEvents(jsonBuffer);
			jsonBuffer = drained.rest;
			for (const event of drained.events) {
				const log = this.#eventToLog(event, deviceId);
				if (log) this.emit('iosevent', { type: sourceEventType(IOS_SOURCE, SOURCE_EVENT_KINDS.LOG), data: log });
			}
		});

		this.logProcess.stderr.on('data', (data) => {
			const msg = data.toString().trim();
			if (!msg) return;
			stderrBuffer += `${msg}\n`;
		});

		const activeProcess = this.logProcess;
		this.logProcess.on('close', (code, signal) => {
			if (this.logProcess && this.logProcess !== activeProcess) return;
			this.logProcess = null;
			if (code && !signal && !this._stopping) {
				this.emit('iosevent', {
					type: sourceEventType(IOS_SOURCE, SOURCE_EVENT_KINDS.ERROR),
					data: stderrBuffer.trim() || `iOS log process exited with code ${code}`,
				});
				return;
			}
			this.emit('iosevent', { type: sourceEventType(IOS_SOURCE, SOURCE_EVENT_KINDS.CLOSED), data: code });
		});
	}

	#wireProcess(parseLine) {
		let lineBuffer = '';
		let stderrBuffer = '';

		this.logProcess.stdout.on('data', (data) => {
			lineBuffer += data.toString();
			const lines = lineBuffer.split('\n');
			lineBuffer = lines.pop();

			for (const line of lines) {
				const log = parseLine(line.trim());
				if (!log) continue;
				this.emit('iosevent', { type: sourceEventType(IOS_SOURCE, SOURCE_EVENT_KINDS.LOG), data: log });
			}
		});

		this.logProcess.stderr.on('data', (data) => {
			const msg = data.toString().trim();
			if (!msg) return;
			stderrBuffer += `${msg}\n`;
		});

		const activeProcess = this.logProcess;
		this.logProcess.on('close', (code, signal) => {
			if (this.logProcess && this.logProcess !== activeProcess) return;
			this.logProcess = null;
			if (code && !signal && !this._stopping) {
				this.emit('iosevent', {
					type: sourceEventType(IOS_SOURCE, SOURCE_EVENT_KINDS.ERROR),
					data: stderrBuffer.trim() || `iOS log process exited with code ${code}`,
				});
				return;
			}
			this.emit('iosevent', { type: sourceEventType(IOS_SOURCE, SOURCE_EVENT_KINDS.CLOSED), data: code });
		});
	}

	#drainJsonEvents(buffer) {
		const events = [];
		let cursor = 0;

		while (cursor < buffer.length) {
			const start = buffer.indexOf('{', cursor);
			if (start < 0) {
				return { events, rest: buffer.slice(Math.max(0, buffer.length - 1)) };
			}

			const end = this.#scanJsonObjectEnd(buffer, start);
			if (end < 0) return { events, rest: buffer.slice(start) };

			try {
				events.push(JSON.parse(buffer.slice(start, end + 1)));
			} catch { /* skip malformed event and keep scanning */ }
			cursor = end + 1;
		}

		return { events, rest: '' };
	}

	#scanJsonObjectEnd(buffer, start) {
		let depth = 0;
		let inString = false;
		let escaped = false;

		for (let i = start; i < buffer.length; i++) {
			const char = buffer[i];
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
			} else if (char === '{') {
				depth++;
			} else if (char === '}') {
				depth--;
				if (depth === 0) return i;
			}
		}
		return -1;
	}

	#eventToLog(event, deviceId) {
		if (!event || typeof event !== 'object') return null;
		const processPath = event.processImagePath || event.senderImagePath || event.imagePath || '';
		const processName = event.process || event.processName || event.sender || (processPath ? basename(processPath) : '');
		const subsystem = event.subsystem || '';
		const category = event.category || '';
		const message = event.eventMessage || event.message || event.composedMessage || '';
		const bundleId = this.#bundleIdForEvent(deviceId, { processName, processPath, subsystem });

		return {
			timestamp: formatTimestamp(event.timestamp || event.date),
			pid: String(event.processID || event.pid || ''),
			tid: String(event.threadID || event.thread || ''),
			priority: mapPriority(event.messageType || event.level || event.eventType),
			tag: [subsystem, category].filter(Boolean).join(':') || processName || 'iOS',
			message,
			pkg: bundleId || subsystem || processName || '',
			platform: IOS_SOURCE,
		};
	}

	#bundleIdForEvent(deviceId, event) {
		const index = this.appIndexes.get(deviceId);
		if (!index) return '';

		const subsystemBundle = index.byBundleId.get(normalizeLookup(event.subsystem));
		if (subsystemBundle) return subsystemBundle;

		const processPath = normalizePathValue(event.processPath);
		if (processPath) {
			for (const entry of index.byPath) {
				if (processPath === entry.path || processPath.startsWith(`${entry.path}/`)) return entry.bundleId;
			}
		}

		const processName = event.processName || (processPath ? basename(processPath) : '');
		const executableBundle = index.byExecutable.get(normalizeLookup(processName));
		return executableBundle || '';
	}

	#parsePlainLog(line, deviceId) {
		if (!line) return null;

		const syslogMatch = line.match(/^\w{3}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\S+\s+(.+?)\[(\d+)\]\s+<([^>]+)>:\s*(.*)$/);
		if (syslogMatch) {
			const processName = syslogMatch[1];
			const bundleId = this.#bundleIdForEvent(deviceId, { processName });
			return {
				timestamp: formatTimestamp(),
				pid: syslogMatch[2],
				tid: '',
				priority: mapPriority(syslogMatch[3]),
				tag: processName,
				message: syslogMatch[4],
				pkg: bundleId || processName,
				platform: IOS_SOURCE,
			};
		}

		return {
			timestamp: formatTimestamp(),
			pid: '',
			tid: '',
			priority: mapPriority(line),
			tag: 'iOS',
			message: line,
			pkg: '',
			platform: IOS_SOURCE,
		};
	}

	updatePackages(packages) {
		if (!this.lastParams) return;
		this.lastParams.packages = packages;
	}

	async restart(params) {
		this.stop();
		await this.start(params || this.lastParams);
	}

	clear() {
		// The unified logging store is system-owned. Clearing the viewer is handled
		// in the webview; do not erase host or simulator logs from here.
	}

	stop() {
		if (this.logProcess) this._stopping = true;
		this.logProcess?.kill();
	}

	stopDeviceTracking() {}
	startDeviceTracking() {}

	launchApp(deviceId, packageName) {
		const device = this.devices.get(deviceId);
		if (device?.kind === 'device') {
			return execFileAsync('xcrun', ['devicectl', 'device', 'process', 'launch', '--device', deviceId, packageName]);
		}
		return execFileAsync('xcrun', ['simctl', 'launch', deviceId, packageName]);
	}

	forceStopApp(deviceId, packageName) {
		const device = this.devices.get(deviceId);
		if (device?.kind === 'device') {
			return Promise.reject(new Error('Force stop is not supported for physical iOS devices yet.'));
		}
		return execFileAsync('xcrun', ['simctl', 'terminate', deviceId, packageName]);
	}

	clearAppData() {
		return Promise.reject(new Error('Clear data is not supported for iOS yet.'));
	}
}

module.exports = IOSService;
