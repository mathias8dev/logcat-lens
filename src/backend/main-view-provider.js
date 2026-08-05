const vscode = require('vscode');

const vsc = require('./core/vsc');
const util = require('./core/utils');
const AdbService = require('./core/adb-service');
const IOSService = require('./core/ios-service');
const DebugSessionService = require('./core/debug-session-service');
const LogSourceRegistry = require('./log-source-registry');
const { isAdbAvailable, downloadAndInstallAdb, resetAdbCache } = require('./core/adb-service');
const settings = require('./settings/logview-settings');
const { renderMainWebviewHtml } = require('./webview/main-webview-html');
const { copyLogText, exportLogs } = require('../application/log-document-usecases');
const {
	clearLogStream,
	restartLogStream,
	startLogStream,
	stopLogStream,
} = require('../application/log-stream-usecases');
const {
	DEFAULT_SOURCE,
	SOURCES,
	SOURCE_EVENT_KINDS,
	UI_MESSAGES,
	VIEW_MESSAGES,
	sourceEvent,
} = require('../protocol/shared/contracts');

module.exports = class MainViewProvider {
	#view;
	#extensionURI;
	#state = {
		paused: false,
		activeSource: DEFAULT_SOURCE,
	};
	#androidTrackingStarted = false;
	#sources;
	adb;
	ios;
	debug;

	constructor(context) {
		this.#extensionURI = context.extensionUri;
		this.adb = new AdbService();
		this.ios = new IOSService();
		this.debug = new DebugSessionService(context);
		this.#sources = new LogSourceRegistry({
			android: this.adb,
			ios: this.ios,
			debug: this.debug,
			onEvent: (event) => this.#onMessage(event),
		});
	}

	release() {
		this.#sources.stopAll();
		this.#sources.stopDeviceTracking();
		this.#sources.dispose();
	}

	#service(source = this.#activeSource) {
		return this.#sources.service(source);
	}

	#source(event) {
		return this.#sources.sourceFromMessage(event, this.#activeSource);
	}

	get #activeSource() {
		return this.#state.activeSource;
	}

	get #paused() {
		return this.#state.paused;
	}

	set #paused(value) {
		this.#state.paused = value;
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
					await startLogStream({ registry: this.#sources, state: this.#state, source, data: event.data });
					break;
				}
				case UI_MESSAGES.STOP:
					stopLogStream({ registry: this.#sources, state: this.#state, source: this.#source(event) });
					break;
				case UI_MESSAGES.PAUSE:
					this.#paused = true;
					break;
				case UI_MESSAGES.RESUME:
					this.#paused = false;
					break;
				case UI_MESSAGES.CLEAR:
					clearLogStream({ registry: this.#sources, source: this.#source(event) });
					break;
				case UI_MESSAGES.RESTART: {
					const source = this.#source(event);
					await restartLogStream({ registry: this.#sources, state: this.#state, source, data: event.data });
					break;
				}
				case UI_MESSAGES.UPDATE_PACKAGES:
					this.#service(this.#source(event)).updatePackages(event.data.packages);
					break;
				case UI_MESSAGES.COPY:
					copyLogText({ clipboard: vsc, text: event.data.text });
					break;
				case UI_MESSAGES.EXPORT:
					await exportLogs({ workspace: vscode.workspace, window: vscode.window, logs: event.data.logs });
					break;
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
					const groups = await settings.saveTagGroup(
						vscode.workspace,
						vscode.ConfigurationTarget.Global,
						event.data.name,
						event.data.tags,
					);
					this.#postMessage({ type: VIEW_MESSAGES.TAG_GROUPS, data: { groups } });
					break;
				}
				case UI_MESSAGES.LOAD_TAG_GROUPS: {
					const groups = settings.savedTagGroups(vscode.workspace);
					this.#postMessage({ type: VIEW_MESSAGES.TAG_GROUPS, data: { groups } });
					break;
				}
				case UI_MESSAGES.DELETE_TAG_GROUP: {
					const grps = await settings.deleteTagGroup(vscode.workspace, vscode.ConfigurationTarget.Global, event.data.name);
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
					vscode.commands.executeCommand('workbench.action.openSettings', settings.adbPathSettingId());
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
		return renderMainWebviewHtml({
			webview,
			extensionUri: this.#extensionURI,
			nonce: util.getNonce(),
			vscode,
		});
	}
}
