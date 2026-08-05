(function defineContracts(root, factory) {
	if (typeof module === 'object' && module.exports) {
		module.exports = factory();
		return;
	}
	root.LogcatLensContracts = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function createContracts() {
	const SOURCES = Object.freeze({
		ANDROID: 'android',
		IOS: 'ios',
		DEBUG: 'debug',
	});

	const DEFAULT_SOURCE = SOURCES.ANDROID;
	const SOURCE_VALUES = Object.freeze(Object.values(SOURCES));

	const UI_MESSAGES = Object.freeze({
		START: 'start',
		STOP: 'stop',
		PAUSE: 'pause',
		RESUME: 'resume',
		CLEAR: 'clear',
		RESTART: 'restart',
		UPDATE_PACKAGES: 'update-packages',
		COPY: 'copy',
		EXPORT: 'export',
		APP_LAUNCH: 'app-launch',
		APP_FORCE_STOP: 'app-force-stop',
		APP_CLEAR_DATA: 'app-clear-data',
		DEVICES: 'devices',
		PACKAGES: 'packages',
		SAVE_TAG_GROUP: 'save-tag-group',
		LOAD_TAG_GROUPS: 'load-tag-groups',
		DELETE_TAG_GROUP: 'delete-tag-group',
		PACKAGE_INFO: 'package-info',
		FETCH_TAGS: 'fetch-tags',
		CHECK_ADB: 'check-adb',
		INSTALL_ADB: 'install-adb',
		OPEN_ADB_SETTINGS: 'open-adb-settings',
		OPEN_ADB_DOWNLOAD: 'open-adb-download',
	});

	const VIEW_MESSAGES = Object.freeze({
		ADB_STATUS: 'adb-status',
		DEVICES: 'devices',
		PACKAGES: 'packages',
		TAGS: 'tags',
		TAG_GROUPS: 'tag-groups',
		LOG: 'log',
		PACKAGE_CHANGED: 'package-changed',
		LIFECYCLE: 'lifecycle',
		PACKAGE_INFO: 'package-info',
		STOP: 'stop',
	});

	const SOURCE_EVENT_KINDS = Object.freeze({
		LOG: 'log',
		PACKAGE_CHANGED: 'package-changed',
		LIFECYCLE: 'lifecycle',
		DEVICES_CHANGED: 'devices-changed',
		CLOSED: 'closed',
		ERROR: 'error',
		WARNING: 'warning',
	});

	const SOURCE_EVENT_TYPES = Object.freeze(
		SOURCE_VALUES.reduce((types, source) => {
			for (const kind of Object.values(SOURCE_EVENT_KINDS)) {
				types[`${source}.${kind}`] = { source, kind, type: `${source}.${kind}` };
			}
			return types;
		}, {})
	);

	function isSource(value) {
		return SOURCE_VALUES.includes(value);
	}

	function normalizeSource(value, fallback = DEFAULT_SOURCE) {
		if (isSource(value)) return value;
		return isSource(fallback) ? fallback : DEFAULT_SOURCE;
	}

	function sourceEventType(source, kind) {
		return `${normalizeSource(source)}.${kind}`;
	}

	function sourceEvent(type) {
		return SOURCE_EVENT_TYPES[type] || null;
	}

	return Object.freeze({
		DEFAULT_SOURCE,
		SOURCES,
		SOURCE_VALUES,
		UI_MESSAGES,
		VIEW_MESSAGES,
		SOURCE_EVENT_KINDS,
		SOURCE_EVENT_TYPES,
		isSource,
		normalizeSource,
		sourceEvent,
		sourceEventType,
	});
});
