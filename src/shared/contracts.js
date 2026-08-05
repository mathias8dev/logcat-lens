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

	const PARSERS = Object.freeze({
		ANDROID_LOGCAT: 'android-logcat',
		IOS_UNIFIED: 'ios-unified',
		DEBUG_AUTO: 'debug-auto',
		DEBUG_ANDROID: 'debug-android',
		DEBUG_JSON: 'debug-json',
		DEBUG_JAVA: 'debug-java',
		DEBUG_SPRING: 'debug-spring',
		DEBUG_PYTHON: 'debug-python',
		DEBUG_NODE: 'debug-node',
		DEBUG_GO: 'debug-go',
		DEBUG_RUST: 'debug-rust',
		DEBUG_DOTNET: 'debug-dotnet',
		DEBUG_RUBY: 'debug-ruby',
		DEBUG_LARAVEL: 'debug-laravel',
		DEBUG_SYSLOG: 'debug-syslog',
		DEBUG_GENERIC: 'debug-generic',
	});

	const PARSER_DEFINITIONS = Object.freeze({
		[PARSERS.ANDROID_LOGCAT]: {
			id: PARSERS.ANDROID_LOGCAT,
			source: SOURCES.ANDROID,
			label: 'Logcat',
			scopeLabel: 'Package',
			scopePlaceholder: 'Package',
			facetLabel: 'Tag',
			facetPlaceholder: 'Tags',
			primaryColumnLabel: 'Package',
			facetColumnLabel: 'Tag',
			supportsScope: true,
			supportsFacet: true,
		},
		[PARSERS.IOS_UNIFIED]: {
			id: PARSERS.IOS_UNIFIED,
			source: SOURCES.IOS,
			label: 'Unified log',
			scopeLabel: 'Bundle',
			scopePlaceholder: 'Bundle ID',
			facetLabel: 'Subsystem',
			facetPlaceholder: 'Subsystem or process',
			primaryColumnLabel: 'Bundle',
			facetColumnLabel: 'Subsystem',
			supportsScope: true,
			supportsFacet: true,
		},
		[PARSERS.DEBUG_AUTO]: {
			id: PARSERS.DEBUG_AUTO,
			source: SOURCES.DEBUG,
			label: 'Auto detect',
			scopeLabel: 'Source',
			scopePlaceholder: 'Source or session',
			facetLabel: 'Logger',
			facetPlaceholder: 'Logger / category',
			primaryColumnLabel: 'Source',
			facetColumnLabel: 'Logger',
			supportsScope: true,
			supportsFacet: true,
		},
		[PARSERS.DEBUG_ANDROID]: {
			id: PARSERS.DEBUG_ANDROID,
			source: SOURCES.DEBUG,
			label: 'Android / logcat',
			scopeLabel: 'Package',
			scopePlaceholder: 'Package',
			facetLabel: 'Tag',
			facetPlaceholder: 'Tags',
			primaryColumnLabel: 'Package',
			facetColumnLabel: 'Tag',
			supportsScope: true,
			supportsFacet: true,
		},
		[PARSERS.DEBUG_JSON]: {
			id: PARSERS.DEBUG_JSON,
			source: SOURCES.DEBUG,
			label: 'Structured JSON',
			scopeLabel: 'Service',
			scopePlaceholder: 'Service / app',
			facetLabel: 'Context',
			facetPlaceholder: 'Logger / context',
			primaryColumnLabel: 'Service',
			facetColumnLabel: 'Context',
			supportsScope: true,
			supportsFacet: true,
		},
		[PARSERS.DEBUG_JAVA]: {
			id: PARSERS.DEBUG_JAVA,
			source: SOURCES.DEBUG,
			label: 'Java',
			scopeLabel: 'Package',
			scopePlaceholder: 'Java package',
			facetLabel: 'Logger',
			facetPlaceholder: 'Logger',
			primaryColumnLabel: 'Package',
			facetColumnLabel: 'Logger',
			supportsScope: true,
			supportsFacet: true,
		},
		[PARSERS.DEBUG_SPRING]: {
			id: PARSERS.DEBUG_SPRING,
			source: SOURCES.DEBUG,
			label: 'Spring Boot',
			scopeLabel: 'Package',
			scopePlaceholder: 'Java package',
			facetLabel: 'Logger',
			facetPlaceholder: 'Spring logger',
			primaryColumnLabel: 'Package',
			facetColumnLabel: 'Logger',
			supportsScope: true,
			supportsFacet: true,
		},
		[PARSERS.DEBUG_PYTHON]: {
			id: PARSERS.DEBUG_PYTHON,
			source: SOURCES.DEBUG,
			label: 'Python logging',
			scopeLabel: 'Module',
			scopePlaceholder: 'Module',
			facetLabel: 'Logger',
			facetPlaceholder: 'Logger',
			primaryColumnLabel: 'Module',
			facetColumnLabel: 'Logger',
			supportsScope: false,
			supportsFacet: true,
		},
		[PARSERS.DEBUG_NODE]: {
			id: PARSERS.DEBUG_NODE,
			source: SOURCES.DEBUG,
			label: 'Node',
			scopeLabel: 'Process',
			scopePlaceholder: 'Process / app',
			facetLabel: 'Context',
			facetPlaceholder: 'Context',
			primaryColumnLabel: 'Process',
			facetColumnLabel: 'Context',
			supportsScope: false,
			supportsFacet: true,
		},
		[PARSERS.DEBUG_GO]: {
			id: PARSERS.DEBUG_GO,
			source: SOURCES.DEBUG,
			label: 'Go / logfmt',
			scopeLabel: 'Service',
			scopePlaceholder: 'Service',
			facetLabel: 'Component',
			facetPlaceholder: 'Component / module',
			primaryColumnLabel: 'Service',
			facetColumnLabel: 'Component',
			supportsScope: true,
			supportsFacet: true,
		},
		[PARSERS.DEBUG_RUST]: {
			id: PARSERS.DEBUG_RUST,
			source: SOURCES.DEBUG,
			label: 'Rust tracing',
			scopeLabel: 'Crate',
			scopePlaceholder: 'Crate / target',
			facetLabel: 'Target',
			facetPlaceholder: 'Target',
			primaryColumnLabel: 'Crate',
			facetColumnLabel: 'Target',
			supportsScope: false,
			supportsFacet: true,
		},
		[PARSERS.DEBUG_DOTNET]: {
			id: PARSERS.DEBUG_DOTNET,
			source: SOURCES.DEBUG,
			label: '.NET',
			scopeLabel: 'Namespace',
			scopePlaceholder: 'Namespace',
			facetLabel: 'Category',
			facetPlaceholder: 'Category',
			primaryColumnLabel: 'Namespace',
			facetColumnLabel: 'Category',
			supportsScope: false,
			supportsFacet: true,
		},
		[PARSERS.DEBUG_RUBY]: {
			id: PARSERS.DEBUG_RUBY,
			source: SOURCES.DEBUG,
			label: 'Ruby',
			scopeLabel: 'Program',
			scopePlaceholder: 'Program',
			facetLabel: 'Logger',
			facetPlaceholder: 'Logger',
			primaryColumnLabel: 'Program',
			facetColumnLabel: 'Logger',
			supportsScope: false,
			supportsFacet: true,
		},
		[PARSERS.DEBUG_LARAVEL]: {
			id: PARSERS.DEBUG_LARAVEL,
			source: SOURCES.DEBUG,
			label: 'Laravel',
			scopeLabel: 'Channel',
			scopePlaceholder: 'Channel',
			facetLabel: 'Channel',
			facetPlaceholder: 'Channel',
			primaryColumnLabel: 'Channel',
			facetColumnLabel: 'Channel',
			supportsScope: false,
			supportsFacet: true,
		},
		[PARSERS.DEBUG_SYSLOG]: {
			id: PARSERS.DEBUG_SYSLOG,
			source: SOURCES.DEBUG,
			label: 'Syslog',
			scopeLabel: 'Host',
			scopePlaceholder: 'Host',
			facetLabel: 'Process',
			facetPlaceholder: 'Process',
			primaryColumnLabel: 'Host',
			facetColumnLabel: 'Process',
			supportsScope: false,
			supportsFacet: true,
		},
		[PARSERS.DEBUG_GENERIC]: {
			id: PARSERS.DEBUG_GENERIC,
			source: SOURCES.DEBUG,
			label: 'Generic text',
			scopeLabel: 'Source',
			scopePlaceholder: 'Source',
			facetLabel: 'Label',
			facetPlaceholder: 'Label / category',
			primaryColumnLabel: 'Source',
			facetColumnLabel: 'Label',
			supportsScope: false,
			supportsFacet: true,
		},
	});

	const SOURCE_PARSERS = Object.freeze({
		[SOURCES.ANDROID]: Object.freeze([PARSERS.ANDROID_LOGCAT]),
		[SOURCES.IOS]: Object.freeze([PARSERS.IOS_UNIFIED]),
		[SOURCES.DEBUG]: Object.freeze([
			PARSERS.DEBUG_AUTO,
			PARSERS.DEBUG_ANDROID,
			PARSERS.DEBUG_JSON,
			PARSERS.DEBUG_JAVA,
			PARSERS.DEBUG_SPRING,
			PARSERS.DEBUG_PYTHON,
			PARSERS.DEBUG_NODE,
			PARSERS.DEBUG_GO,
			PARSERS.DEBUG_RUST,
			PARSERS.DEBUG_DOTNET,
			PARSERS.DEBUG_RUBY,
			PARSERS.DEBUG_LARAVEL,
			PARSERS.DEBUG_SYSLOG,
			PARSERS.DEBUG_GENERIC,
		]),
	});

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

	function parsersForSource(source) {
		return SOURCE_PARSERS[normalizeSource(source)] || SOURCE_PARSERS[DEFAULT_SOURCE];
	}

	function parserDefinition(parserId, source = DEFAULT_SOURCE) {
		const fallback = parsersForSource(source)[0];
		const candidate = PARSER_DEFINITIONS[parserId];
		return candidate || PARSER_DEFINITIONS[fallback];
	}

	function normalizeParser(parserId, source = DEFAULT_SOURCE) {
		const parser = parserDefinition(parserId, source);
		const normalizedSource = normalizeSource(source);
		if (parser.source === normalizedSource) return parser.id;
		return parsersForSource(normalizedSource)[0];
	}

	return Object.freeze({
		DEFAULT_SOURCE,
		PARSERS,
		PARSER_DEFINITIONS,
		SOURCES,
		SOURCE_PARSERS,
		SOURCE_VALUES,
		UI_MESSAGES,
		VIEW_MESSAGES,
		SOURCE_EVENT_KINDS,
		SOURCE_EVENT_TYPES,
		isSource,
		normalizeSource,
		normalizeParser,
		parserDefinition,
		parsersForSource,
		sourceEvent,
		sourceEventType,
	});
});
