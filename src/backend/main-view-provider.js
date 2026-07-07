const vscode = require('vscode');

const vsc = require('./core/vsc');
const util = require('./core/utils');
const AdbService = require('./core/adb-service');
const IOSService = require('./core/ios-service');
const DebugSessionService = require('./core/debug-session-service');
const { isAdbAvailable, downloadAndInstallAdb, resetAdbCache } = require('./core/adb-service');

module.exports = class MainViewProvider {
	#view;
	#extensionURI;
	#paused = false;
	#activeSource = 'android';
	#androidTrackingStarted = false;
	adb;
	ios;
	debug;

	constructor(context) {
		this.#extensionURI = context.extensionUri;
		this.adb = new AdbService();
		this.ios = new IOSService();
		this.debug = new DebugSessionService(context);
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
		if (source === 'ios') return this.ios;
		if (source === 'debug') return this.debug;
		return this.adb;
	}

	#source(event) {
		return event?.data?.source || this.#activeSource || 'android';
	}

	#stopInactiveServices(source) {
		if (source !== 'android') this.adb.stop();
		if (source !== 'ios') this.ios.stop();
		if (source !== 'debug') this.debug.stop();
	}

	#ensureAndroidTracking() {
		if (this.#androidTrackingStarted) return;
		this.adb.startDeviceTracking();
		this.#androidTrackingStarted = true;
	}

	// MESSAGING
	async #onMessage(event) {
		try {
			switch (event.type) {
				// UI EVENTS
				case 'start': {
					const source = this.#source(event);
					this.#activeSource = source;
					this.#paused = false;
					this.#stopInactiveServices(source);
					await this.#service(source).start(event.data);
					break;
				}
				case 'stop':
					this.#service(this.#source(event)).stop();
					this.#paused = false;
					break;
				case 'pause':
					this.#paused = true;
					break;
				case 'resume':
					this.#paused = false;
					break;
				case 'clear':
					this.#service(this.#source(event)).clear();
					break;
				case 'restart': {
					const source = this.#source(event);
					this.#activeSource = source;
					this.#paused = false;
					this.#stopInactiveServices(source);
					await this.#service(source).restart(event.data);
					break;
				}
				case 'update-packages':
					this.#service(this.#source(event)).updatePackages(event.data.packages);
					break;
				case 'copy':
					vsc.copyToClipboard(event.data.text);
					break;
				case 'export': {
					const doc = await vscode.workspace.openTextDocument({ content: event.data.logs, language: 'log' });
					await vscode.window.showTextDocument(doc);
					break;
				}
				case 'app-launch':
					this.#service(this.#source(event)).launchApp(event.data.deviceId, event.data.packageName).catch(() => {});
					break;
				case 'app-force-stop':
					this.#service(this.#source(event)).forceStopApp(event.data.deviceId, event.data.packageName).catch(() => {});
					break;
				case 'app-clear-data':
					this.#service(this.#source(event)).clearAppData(event.data.deviceId, event.data.packageName).catch(err => {
						const detail = (err?.message || '').trim();
						const isPermBlock = /permission|denied|not allowed|SecurityException|monitor/i.test(detail);
						const msg = isPermBlock
							? `Couldn't clear app data for ${event.data.packageName}. This is usually caused by "Permission monitoring" in Developer Options — disable it on the device and try again.`
							: `Couldn't clear app data for ${event.data.packageName}${detail ? `: ${detail}` : ''}.`;
						vsc.showErrorPopup(msg);
					});
					break;
				case 'devices': {
					const source = this.#source(event);
					if (source === 'android' && isAdbAvailable()) this.#ensureAndroidTracking();
					this.#service(source).listDevices()
						.then(devices => this.#postMessage({ type: 'devices', data: { source, devices } }))
						.catch(err => {
							if (source === 'android' && this.#isAdbMissingError(err)) return this.#sendAdbMissing();
							this.#postMessage({ type: 'devices', data: { source, devices: [] } });
							vsc.showErrorPopup(err.message || err);
						});
					break;
				}
				case 'packages': {
					const source = this.#source(event);
					this.#service(source).listPackages(event.data.deviceId)
						.then(packages => this.#postMessage({ type: 'packages', data: { source, packages } }))
						.catch(err => vsc.showErrorPopup(err.message || err));
					break;
				}
				case 'save-tag-group': {
					const config = vscode.workspace.getConfiguration('logcatLens');
					const groups = { ...config.get('tagGroups', {}) };
					groups[event.data.name] = event.data.tags;
					await config.update('tagGroups', groups, vscode.ConfigurationTarget.Global);
					this.#postMessage({ type: 'tag-groups', data: { groups } });
					break;
				}
				case 'load-tag-groups': {
					const groups = vscode.workspace.getConfiguration('logcatLens').get('tagGroups', {});
					this.#postMessage({ type: 'tag-groups', data: { groups } });
					break;
				}
				case 'delete-tag-group': {
					const cfg = vscode.workspace.getConfiguration('logcatLens');
					const grps = { ...cfg.get('tagGroups', {}) };
					delete grps[event.data.name];
					await cfg.update('tagGroups', grps, vscode.ConfigurationTarget.Global);
					this.#postMessage({ type: 'tag-groups', data: { groups: grps } });
					break;
				}
				case 'package-info': {
					const source = this.#source(event);
					this.#service(source).getPackageInfo(event.data.deviceId, event.data.packageName)
						.then(info => this.#postMessage({ type: 'package-info', data: { source, ...info } }))
						.catch(() => {});
					break;
				}
				case 'fetch-tags': {
					const source = this.#source(event);
					this.#service(source).listTags(event.data.deviceId)
						.then(tags => this.#postMessage({ type: 'tags', data: { source, tags } }))
						.catch(() => {});
					break;
				}
				case 'check-adb': {
					const available = isAdbAvailable();
					if (available) this.#ensureAndroidTracking();
					this.#postMessage({ type: 'adb-status', data: { available } });
					break;
				}
				case 'install-adb':
					downloadAndInstallAdb().then(ok => {
						this.#postMessage({ type: 'adb-status', data: { available: !!ok } });
					});
					break;
				case 'open-adb-settings':
					vscode.commands.executeCommand('workbench.action.openSettings', 'logcatLens.adbPath');
					break;
				case 'open-adb-download':
					vscode.env.openExternal(vscode.Uri.parse('https://developer.android.com/tools/releases/platform-tools'));
					break;

				// ADB EVENTS
				case 'adb.log':
					if (this.#activeSource !== 'android') break;
					if (!this.#paused) {
						this.#postMessage({ type: 'log', data: { log: event.data } });
					}
					break;
				case 'ios.log':
					if (this.#activeSource !== 'ios') break;
					if (!this.#paused) {
						this.#postMessage({ type: 'log', data: { log: event.data } });
					}
					break;
				case 'debug.log':
					if (this.#activeSource !== 'debug') break;
					if (!this.#paused) {
						this.#postMessage({ type: 'log', data: { log: event.data } });
					}
					break;

				case 'adb.package-changed':
					if (this.#activeSource !== 'android') break;
					this.#postMessage({ type: 'package-changed', data: event.data });
					break;

				case 'adb.lifecycle':
					if (this.#activeSource !== 'android') break;
					this.#postMessage({ type: 'lifecycle', data: event.data });
					break;

				case 'adb.devices-changed':
					if (this.#activeSource !== 'android') break;
					this.adb.listDevices()
						.then(devices => this.#postMessage({ type: 'devices', data: { source: 'android', devices } }))
						.catch(err => {
							if (this.#isAdbMissingError(err)) this.#sendAdbMissing();
						});
					break;
				case 'debug.devices-changed':
					if (this.#activeSource !== 'debug') break;
					this.debug.listDevices()
						.then(devices => this.#postMessage({ type: 'devices', data: { source: 'debug', devices } }))
						.catch(err => vsc.showErrorPopup(err.message || err));
					break;

				case 'adb.closed':
					if (this.#activeSource !== 'android') break;
					this.#postMessage({ type: 'stop' });
					break;
				case 'ios.closed':
					if (this.#activeSource !== 'ios') break;
					this.#postMessage({ type: 'stop' });
					break;
				case 'debug.closed':
					if (this.#activeSource !== 'debug') break;
					this.#postMessage({ type: 'stop' });
					break;

				case 'adb.error':
					if (this.#activeSource !== 'android') break;
					if (this.#isAdbMissingError(event.data)) return this.#sendAdbMissing();
					vsc.showErrorPopup(event.data.toString());
					this.#service().stop();
					this.#postMessage({ type: 'stop' });
					break;
				case 'ios.error':
					if (this.#activeSource !== 'ios') break;
					vsc.showErrorPopup(event.data.toString());
					this.#service().stop();
					this.#postMessage({ type: 'stop' });
					break;
				case 'debug.error':
					if (this.#activeSource !== 'debug') break;
					vsc.showErrorPopup(event.data.toString());
					this.#service().stop();
					this.#postMessage({ type: 'stop' });
					break;
				case 'debug.warning':
					if (this.#activeSource !== 'debug') break;
					vsc.showWarningPopup(event.data.toString());
					break;
			}

		} catch (err) {
			if (this.#source(event) === 'android' && this.#isAdbMissingError(err)) return this.#sendAdbMissing();
			vsc.showErrorPopup(err.message || err);
			this.#service().stop();
			this.#postMessage({ type: 'stop' });
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
		this.#postMessage({ type: 'adb-status', data: { available: false } });
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
				<script nonce="${nonce}" src="${uri('src/frontend/core/html-element-base.js')}"></script>

				<link href="${uri('src/frontend/logcat/logcat.css')}" rel="stylesheet">
				<script nonce="${nonce}" src="${uri('src/frontend/logcat/logcat.js')}"></script>
			</head>

			<body data-vscode-context='{ "preventDefaultContextMenuItems": true }'>
				<logcat-lens></logcat-lens>
			</body>
			</html>
		`;
	}
}
