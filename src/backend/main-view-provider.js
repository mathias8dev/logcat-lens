const vscode = require('vscode');

const vsc = require('./core/vsc');
const util = require('./core/utils');
const AdbService = require('./core/adb-service');
const IOSService = require('./core/ios-service');
const DebugSessionService = require('./core/debug-session-service');
const { isAdbAvailable, downloadAndInstallAdb, resetAdbCache } = require('./core/adb-service');
const {
	DEFAULT_SOURCE,
	SOURCES,
	SOURCE_EVENT_KINDS,
	UI_MESSAGES,
	VIEW_MESSAGES,
	normalizeSource,
	sourceEvent,
} = require('../shared/contracts');

module.exports = class MainViewProvider {
	#view;
	#extensionURI;
	#paused = false;
	#activeSource = DEFAULT_SOURCE;
	#androidTrackingStarted = false;
	#services = new Map();
	adb;
	ios;
	debug;

	constructor(context) {
		this.#extensionURI = context.extensionUri;
		this.adb = new AdbService();
		this.ios = new IOSService();
		this.debug = new DebugSessionService(context);
		this.#services.set(SOURCES.ANDROID, this.adb);
		this.#services.set(SOURCES.IOS, this.ios);
		this.#services.set(SOURCES.DEBUG, this.debug);
		this.adb.on('adbevent', (event) => this.#onMessage(event));
		this.ios.on('iosevent', (event) => this.#onMessage(event));
		this.debug.on('debugevent', (event) => this.#onMessage(event));
	}

	release() {
		this.adb.stop();
		this.adb.stopDeviceTracking();
		this.ios.stop();
		this.ios.stopDeviceTracking();
		this.debug.dispose();
	}

	#service(source = this.#activeSource) {
		return this.#services.get(normalizeSource(source)) || this.adb;
	}

	#source(event) {
		return normalizeSource(event?.data?.source || this.#activeSource);
	}

	#stopInactiveServices(source) {
		const activeSource = normalizeSource(source);
		for (const [candidate, service] of this.#services.entries()) {
			if (candidate !== activeSource) service.stop();
		}
	}

	#ensureAndroidTracking() {
		if (this.#androidTrackingStarted) return;
		this.adb.startDeviceTracking();
		this.#androidTrackingStarted = true;
	}

	// MESSAGING
	async #onMessage(event) {
		try {
			const sourceEventInfo = sourceEvent(event.type);
			if (sourceEventInfo) {
				await this.#onSourceEvent(sourceEventInfo, event);
				return;
			}

			switch (event.type) {
				// UI EVENTS
				case UI_MESSAGES.START: {
					const source = this.#source(event);
					this.#activeSource = source;
					this.#paused = false;
					this.#stopInactiveServices(source);
					await this.#service(source).start(event.data);
					break;
				}
				case UI_MESSAGES.STOP:
					this.#service(this.#source(event)).stop();
					this.#paused = false;
					break;
				case UI_MESSAGES.PAUSE:
					this.#paused = true;
					break;
				case UI_MESSAGES.RESUME:
					this.#paused = false;
					break;
				case UI_MESSAGES.CLEAR:
					this.#service(this.#source(event)).clear();
					break;
				case UI_MESSAGES.RESTART: {
					const source = this.#source(event);
					this.#activeSource = source;
					this.#paused = false;
					this.#stopInactiveServices(source);
					await this.#service(source).restart(event.data);
					break;
				}
				case UI_MESSAGES.UPDATE_PACKAGES:
					this.#service(this.#source(event)).updatePackages(event.data.packages);
					break;
				case UI_MESSAGES.COPY:
					vsc.copyToClipboard(event.data.text);
					break;
				case UI_MESSAGES.EXPORT: {
					const doc = await vscode.workspace.openTextDocument({ content: event.data.logs, language: 'log' });
					await vscode.window.showTextDocument(doc);
					break;
				}
				case UI_MESSAGES.APP_LAUNCH:
					this.#service(this.#source(event)).launchApp(event.data.deviceId, event.data.packageName).catch(() => {});
					break;
				case UI_MESSAGES.APP_FORCE_STOP:
					this.#service(this.#source(event)).forceStopApp(event.data.deviceId, event.data.packageName).catch(() => {});
					break;
				case UI_MESSAGES.APP_CLEAR_DATA:
					this.#service(this.#source(event)).clearAppData(event.data.deviceId, event.data.packageName).catch(err => {
						const detail = (err?.message || '').trim();
						const isPermBlock = /permission|denied|not allowed|SecurityException|monitor/i.test(detail);
						const msg = isPermBlock
							? `Couldn't clear app data for ${event.data.packageName}. This is usually caused by "Permission monitoring" in Developer Options — disable it on the device and try again.`
							: `Couldn't clear app data for ${event.data.packageName}${detail ? `: ${detail}` : ''}.`;
						vsc.showErrorPopup(msg);
					});
					break;
				case UI_MESSAGES.DEVICES: {
					const source = this.#source(event);
					if (source === SOURCES.ANDROID && isAdbAvailable()) this.#ensureAndroidTracking();
					this.#service(source).listDevices()
						.then(devices => this.#postMessage({ type: VIEW_MESSAGES.DEVICES, data: { source, devices } }))
						.catch(err => {
							if (source === SOURCES.ANDROID && this.#isAdbMissingError(err)) return this.#sendAdbMissing();
							this.#postMessage({ type: VIEW_MESSAGES.DEVICES, data: { source, devices: [] } });
							vsc.showErrorPopup(err.message || err);
						});
					break;
				}
				case UI_MESSAGES.PACKAGES: {
					const source = this.#source(event);
					this.#service(source).listPackages(event.data.deviceId)
						.then(packages => this.#postMessage({ type: VIEW_MESSAGES.PACKAGES, data: { source, packages } }))
						.catch(err => vsc.showErrorPopup(err.message || err));
					break;
				}
				case UI_MESSAGES.SAVE_TAG_GROUP: {
					const config = vscode.workspace.getConfiguration('logcatLens');
					const groups = { ...config.get('tagGroups', {}) };
					groups[event.data.name] = event.data.tags;
					await config.update('tagGroups', groups, vscode.ConfigurationTarget.Global);
					this.#postMessage({ type: VIEW_MESSAGES.TAG_GROUPS, data: { groups } });
					break;
				}
				case UI_MESSAGES.LOAD_TAG_GROUPS: {
					const groups = vscode.workspace.getConfiguration('logcatLens').get('tagGroups', {});
					this.#postMessage({ type: VIEW_MESSAGES.TAG_GROUPS, data: { groups } });
					break;
				}
				case UI_MESSAGES.DELETE_TAG_GROUP: {
					const cfg = vscode.workspace.getConfiguration('logcatLens');
					const grps = { ...cfg.get('tagGroups', {}) };
					delete grps[event.data.name];
					await cfg.update('tagGroups', grps, vscode.ConfigurationTarget.Global);
					this.#postMessage({ type: VIEW_MESSAGES.TAG_GROUPS, data: { groups: grps } });
					break;
				}
				case UI_MESSAGES.PACKAGE_INFO: {
					const source = this.#source(event);
					this.#service(source).getPackageInfo(event.data.deviceId, event.data.packageName)
						.then(info => this.#postMessage({ type: VIEW_MESSAGES.PACKAGE_INFO, data: { source, ...info } }))
						.catch(() => {});
					break;
				}
				case UI_MESSAGES.FETCH_TAGS: {
					const source = this.#source(event);
					this.#service(source).listTags(event.data.deviceId)
						.then(tags => this.#postMessage({ type: VIEW_MESSAGES.TAGS, data: { source, tags } }))
						.catch(() => {});
					break;
				}
				case UI_MESSAGES.CHECK_ADB: {
					const available = isAdbAvailable();
					if (available) this.#ensureAndroidTracking();
					this.#postMessage({ type: VIEW_MESSAGES.ADB_STATUS, data: { available } });
					break;
				}
				case UI_MESSAGES.INSTALL_ADB:
					downloadAndInstallAdb().then(ok => {
						this.#postMessage({ type: VIEW_MESSAGES.ADB_STATUS, data: { available: !!ok } });
					});
					break;
				case UI_MESSAGES.OPEN_ADB_SETTINGS:
					vscode.commands.executeCommand('workbench.action.openSettings', 'logcatLens.adbPath');
					break;
				case UI_MESSAGES.OPEN_ADB_DOWNLOAD:
					vscode.env.openExternal(vscode.Uri.parse('https://developer.android.com/tools/releases/platform-tools'));
					break;
			}

		} catch (err) {
			if (this.#source(event) === SOURCES.ANDROID && this.#isAdbMissingError(err)) return this.#sendAdbMissing();
			vsc.showErrorPopup(err.message || err);
			this.#service().stop();
			this.#postMessage({ type: VIEW_MESSAGES.STOP });
		}
	}

	async #onSourceEvent(eventInfo, event) {
		const { source, kind } = eventInfo;
		if (this.#activeSource !== source) return;

		switch (kind) {
			case SOURCE_EVENT_KINDS.LOG:
				if (!this.#paused) this.#postMessage({ type: VIEW_MESSAGES.LOG, data: { log: event.data } });
				break;
			case SOURCE_EVENT_KINDS.PACKAGE_CHANGED:
				this.#postMessage({ type: VIEW_MESSAGES.PACKAGE_CHANGED, data: event.data });
				break;
			case SOURCE_EVENT_KINDS.LIFECYCLE:
				this.#postMessage({ type: VIEW_MESSAGES.LIFECYCLE, data: event.data });
				break;
			case SOURCE_EVENT_KINDS.DEVICES_CHANGED:
				await this.#refreshDevicesForSource(source);
				break;
			case SOURCE_EVENT_KINDS.CLOSED:
				this.#postMessage({ type: VIEW_MESSAGES.STOP });
				break;
			case SOURCE_EVENT_KINDS.ERROR:
				if (source === SOURCES.ANDROID && this.#isAdbMissingError(event.data)) return this.#sendAdbMissing();
				vsc.showErrorPopup(event.data.toString());
				this.#service(source).stop();
				this.#postMessage({ type: VIEW_MESSAGES.STOP });
				break;
			case SOURCE_EVENT_KINDS.WARNING:
				vsc.showWarningPopup(event.data.toString());
				break;
		}
	}

	async #refreshDevicesForSource(source) {
		try {
			const devices = await this.#service(source).listDevices();
			this.#postMessage({ type: VIEW_MESSAGES.DEVICES, data: { source, devices } });
		} catch (err) {
			if (source === SOURCES.ANDROID && this.#isAdbMissingError(err)) this.#sendAdbMissing();
			else vsc.showErrorPopup(err.message || err);
		}
	}

	#isAdbMissingError(err) {
		const msg = (err?.message || err || '').toString().toLowerCase();
		return msg.includes('not found') || msg.includes('no such file') || msg.includes('enoent');
	}

	#sendAdbMissing() {
		resetAdbCache();
		this.adb.stop();
		this.adb.stopDeviceTracking();
		this.#androidTrackingStarted = false;
		this.#postMessage({ type: VIEW_MESSAGES.ADB_STATUS, data: { available: false } });
	}

	#postMessage(message) {
		this.#view?.webview?.postMessage(message);
	}

	async resolveWebviewView(webviewView) {
		this.#view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this.#extensionURI],
		}
		webviewView.webview.html = this.#render(webviewView.webview);
		webviewView.webview.onDidReceiveMessage((message) => this.#onMessage(message));
	}

	/** @param {vscode.Webview} webview */
	#render(webview) {
		const uri = (path) => webview.asWebviewUri(vscode.Uri.joinPath(this.#extensionURI, path));
		const nonce = util.getNonce();

		return `
			<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta http-equiv="Content-Security-Policy" content="img-src https: data:; style-src 'unsafe-inline' ${webview.cspSource};">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">

				<link href="${uri('src/frontend/style.css')}" rel="stylesheet">
				<script nonce="${nonce}" src="${uri('src/shared/contracts.js')}"></script>
				<script nonce="${nonce}" src="${uri('src/frontend/core/html-element-base.js')}"></script>

				<link href="${uri('src/frontend/logcat/logcat.css')}" rel="stylesheet">
				<script nonce="${nonce}" src="${uri('src/frontend/logcat/ansi-renderer.js')}"></script>
				<script nonce="${nonce}" src="${uri('src/frontend/logcat/logcat.js')}"></script>
			</head>

			<body data-vscode-context='{ "preventDefaultContextMenuItems": true }'>
				<logcat-lens></logcat-lens>
			</body>
			</html>
		`;
	}
}
