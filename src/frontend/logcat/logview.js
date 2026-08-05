const {
	DEFAULT_SOURCE,
	PARSERS,
	SOURCES,
	SOURCE_VALUES,
	UI_MESSAGES,
	VIEW_MESSAGES,
	normalizeParser,
	parserDefinition,
	parsersForSource,
} = globalThis.LogViewUniversalContracts;
const {
	LEVEL_NAMES: FILTER_LEVEL_NAMES,
	LEVEL_ORDER: FILTER_LEVEL_ORDER,
	rebuildFilteredIndices: buildFilteredIndices,
	searchMatchesForIndices,
	toggleLevelSelection,
} = globalThis.LogViewUniversalFilterModel;
const {
	isInlineMediaMime,
	toBase64,
} = globalThis.LogViewUniversalMediaSniffer;
const { segmentLogMessage } = globalThis.LogViewUniversalBinarySegments;
const {
	formatAnsiText: formatMessageAnsiText,
	formatLogMessage,
} = globalThis.LogViewUniversalMessageFormatting;
const {
	classifyMediaContinuation,
	collectMediaBlob,
} = globalThis.LogViewUniversalMediaContinuations;
const {
	collectMultilineJsonBody,
	softPrettyJson,
} = globalThis.LogViewUniversalJsonDetail;
const { createLogDetailPane } = globalThis.LogViewUniversalDetailPane;
const { renderLogViewTemplate } = globalThis.LogViewUniversalTemplate;
const PackageControls = globalThis.LogViewUniversalPackageControls;
const TagControls = globalThis.LogViewUniversalTagControls;
const ChromeControls = globalThis.LogViewUniversalChromeControls;
const Viewport = globalThis.LogViewUniversalViewport;
const SearchControls = globalThis.LogViewUniversalSearchControls;
const LogIngestion = globalThis.LogViewUniversalLogIngestion;

class LogView extends HTMLElementBase {
	BUFFER_SIZE = 100000;    // Can be huge now — only JS array, not DOM
	ROW_HEIGHT = 19;         // Fixed row height in px, matched to logview.css line-height
	OVERSCAN = 20;           // Extra rows rendered above/below viewport

	buffer = [];             // All log objects
	filteredIndices = [];    // indices into buffer that pass filters (and skip media continuations)

	matches = [];
	currentMatch = -1;
	query = '';

	autoScroll = true;
	softWrap = false;
	viewMode = 'standard';
	isPlaying = false;
	isPaused = false;
	state = 'idle';
	source = DEFAULT_SOURCE;
	selectedParser = PARSERS.ANDROID_LOGCAT;

	availablePackages = [];
	selectedPackages = [];
	tags = [];
	knownTags = new Set();
	tagGroups = {};
	activeTagGroup = null; // name of currently loaded group
	tagGroupExpanded = false; // whether to show individual tags
	selectedLevels = new Set(['V', 'D', 'I', 'W', 'E', 'F', 'L']); // All on by default
	searchFilterMode = false;

	// Batching
	_pendingLogs = [];
	_batchRAF = null;
	_searchDebounce = null;

	// Virtual scroll state
	_visibleStart = 0;
	_visibleEnd = 0;
	_renderedEntries = new Map(); // displayIndex -> { el, bufIdx }
	_pool = []; // Recycled entry elements
	_flowStart = 0; // First display index in DOM (soft-wrap mode)
	_flowEnd = 0;   // Last display index in DOM (soft-wrap mode)
	_mediaSources = new Map();
	SOFT_WRAP_MAX_DOM = 500; // Max DOM entries in soft-wrap at a time
	SOFT_WRAP_LOAD_CHUNK = 200; // How many older entries to load when scrolling up

	connectedCallback() {
		super.render(this.render());
		this.logSourceSelect.addEventListener('change', () => this.setLogSource(this.logSourceSelect.value));
		this.parserSelect.addEventListener('change', () => this.setParser(this.parserSelect.value));

		// Virtual scroll handler
		let scrollTicking = false;
		this.logList.onscroll = () => {
			if (!scrollTicking) {
				scrollTicking = true;
				requestAnimationFrame(() => {
					const threshold = this.softWrap ? 50 : 5;
					this.autoScroll = (this.logList.scrollTop + this.logList.clientHeight) >= (this.logList.scrollHeight - threshold);
					this.updateScrollButtons();

					if (this.softWrap) {
						// Load older entries when scrolling near top
						if (this.logList.scrollTop < 200) {
							this._loadOlderEntries();
						}
					} else {
						this.renderVisibleRows();
					}
					scrollTicking = false;
				});
			}
		};

		this.initTooltips();
		this.initDetailPane();
		this.initPackageAutocomplete();
		this.initTagInput();
		this.initColumnResize();
		this.renderLevelChips();
		this.renderParserOptions();
		this.updateSourceLabels();
		this.updateStatus();
		this.postMessage({ type: UI_MESSAGES.LOAD_TAG_GROUPS });

		// Check ADB before doing anything else
		this.postMessage({ type: UI_MESSAGES.CHECK_ADB });
	}

	_setAdbMissing(missing) {
		const show = missing && this.source === SOURCES.ANDROID;
		this.querySelector('#adb-missing-overlay').style.display = show ? '' : 'none';
		this.querySelector('sidebar').style.display = show ? 'none' : '';
		this.querySelector('.content').style.display = show ? 'none' : '';
		if (show) {
			const btn = this.querySelector('#adb-install-btn');
			btn.disabled = false;
			btn.textContent = 'Install ADB';
		}
	}

	onMessage(event) {
		event = event.data;

		switch (event.type) {
			case VIEW_MESSAGES.ADB_STATUS:
				if (this.source !== SOURCES.ANDROID) return;
				if (event.data.available) {
					this._setAdbMissing(false);
					this.refreshDevices();
				} else {
					this._setAdbMissing(true);
				}
				break;
			case VIEW_MESSAGES.DEVICES:
				if (event.data.source && event.data.source !== this.source) return;
				this.toggleLoading(false);
				this.setDevices(event.data.devices);
				break;
			case VIEW_MESSAGES.PACKAGES:
				if (event.data.source && event.data.source !== this.source) return;
				this.availablePackages = event.data.packages;
				if (document.activeElement === this.packageInput && this.packageInput.value) {
					this.showPackageDropdown(this.packageInput.value);
				}
				break;
			case VIEW_MESSAGES.TAGS:
				if (event.data.source && event.data.source !== this.source) return;
				event.data.tags.forEach(t => this.knownTags.add(t));
				break;
			case VIEW_MESSAGES.TAG_GROUPS:
				this.tagGroups = event.data.groups || {};
				break;
			case VIEW_MESSAGES.LOG:
				if (!this.isPaused) this.queueLogEntry(event.data.log);
				break;
			case VIEW_MESSAGES.PACKAGE_CHANGED:
				this._showPackageEvent(event.data.message);
				break;
			case VIEW_MESSAGES.LIFECYCLE:
				this._showLifecycleEvent(event.data);
				break;
			case VIEW_MESSAGES.PACKAGE_INFO:
				if (event.data.source && event.data.source !== this.source) return;
				this._showPackageInfo(event.data);
				break;
			case VIEW_MESSAGES.STOP:
				this.isPlaying = false;
				this.isPaused = false;
				this.state = 'idle';
				this.updatePlayButton();
				this.updateStatus();
				break;
		}
	}

	setLogSource(source) {
		if (!SOURCE_VALUES.includes(source) || source === this.source) return;
		if (this.isPlaying) this.postMessage({ type: UI_MESSAGES.STOP, data: { source: this.source } });

		this.source = source;
		this.selectedParser = normalizeParser(null, source);
		this.logSourceSelect.value = source;
		this.renderParserOptions();
		this.availablePackages = [];
		this.selectedPackages = [];
		this.tags = [];
		this.knownTags = new Set();
		this.activeTagGroup = null;
		this.tagGroupExpanded = false;
		this.renderPackages();
		this.renderTags();
		this.clear(false);
		this.isPlaying = false;
		this.isPaused = false;
		this.state = 'idle';
		this.updatePlayButton();
		this.updateStatus();
		this.updateSourceLabels();
		this._setAdbMissing(false);

		if (source === SOURCES.ANDROID) this.postMessage({ type: UI_MESSAGES.CHECK_ADB });
		else this.refreshDevices();
	}

	setParser(parserId) {
		const next = normalizeParser(parserId, this.source);
		if (next === this.selectedParser) return;
		this.selectedParser = next;
		this.availablePackages = [];
		this.knownTags = new Set();
		this.selectedPackages = [];
		this.tags = [];
		this.renderPackages();
		this.renderTags();
		this.rebuildFilteredIndices();
		this.updateSourceLabels();
		if (this.isPlaying) this.restart();
	}

	renderParserOptions() {
		const parsers = parsersForSource(this.source);
		this.selectedParser = normalizeParser(this.selectedParser, this.source);
		if (!this.parserSelect) return;
		this.parserSelect.innerHTML = parsers.map(id => {
			const parser = parserDefinition(id, this.source);
			return `<option value="${this.escapeAttr(parser.id)}">${this.escapeHtml(parser.label)}</option>`;
		}).join('');
		this.parserSelect.value = this.selectedParser;
		this.parserSelect.disabled = parsers.length <= 1;
	}

	currentParserDefinition() {
		return parserDefinition(this.selectedParser, this.source);
	}

	updateSourceLabels() {
		const isIOS = this.source === SOURCES.IOS;
		const isDebug = this.source === SOURCES.DEBUG;
		const parser = this.currentParserDefinition();
		this.deviceSelect.setAttribute('aria-label', isDebug ? 'Debug session' : isIOS ? 'iOS device' : 'Android device');
		this.packageInput.placeholder = parser.scopePlaceholder;
		this.tagTextInput.placeholder = parser.facetPlaceholder;
		this.packageInput.disabled = !parser.supportsScope;
		this.tagTextInput.disabled = !parser.supportsFacet;
		this.querySelector('.package-group')?.classList.toggle('disabled', !parser.supportsScope);
		this.querySelector('.tag-group')?.classList.toggle('disabled', !parser.supportsFacet);
		if (this.pkgColumnTitle) this.pkgColumnTitle.textContent = parser.primaryColumnLabel;
		if (this.tagColumnTitle) this.tagColumnTitle.textContent = parser.facetColumnLabel;
	}

	// ACTIONS
	start() {
		if (this.isPlaying && !this.isPaused) return;
		if (this.isPaused) { this.resume(); return; }

		this.postMessage({
			type: UI_MESSAGES.START,
			data: {
				source: this.source,
				parser: this.selectedParser,
				deviceId: this.deviceSelect.value,
				packages: this.selectedPackages,
				tag: this.tags,
				level: 'V',
				search: this.searchInput.value,
			}
		});

		this.isPlaying = true;
		this.isPaused = false;
		this.state = 'streaming';
		this.updatePlayButton();
		this.updateStatus();
	}

	pause() {
		if (!this.isPlaying || this.isPaused) return;
		this.isPaused = true;
		this.state = 'paused';
		this.postMessage({ type: UI_MESSAGES.PAUSE });
		this.updatePlayButton();
		this.updateStatus();
	}

	resume() {
		if (!this.isPaused) return;
		this.isPaused = false;
		this.state = 'streaming';
		this.postMessage({ type: UI_MESSAGES.RESUME });
		this.updatePlayButton();
		this.updateStatus();
	}

	stop() {
		if (!this.isPlaying) return;
		this.postMessage({ type: UI_MESSAGES.STOP, data: { source: this.source } });
		this.isPlaying = false;
		this.isPaused = false;
		this.state = 'idle';
		this.updatePlayButton();
		this.updateStatus();
	}

	restart() {
		this.clear();
		this.postMessage({
			type: UI_MESSAGES.RESTART,
			data: {
				source: this.source,
				parser: this.selectedParser,
				deviceId: this.deviceSelect.value,
				packages: this.selectedPackages,
				tag: this.tags,
				level: 'V',
				search: this.searchInput.value,
			}
		});
		this.isPlaying = true;
		this.isPaused = false;
		this.state = 'streaming';
		this.updatePlayButton();
		this.updateStatus();
	}

	clear(remote = true) {
		this.buffer = [];
		this.filteredIndices = [];
		this._mediaSources = new Map();
		this._pendingLogs = [];
		if (this._batchRAF) {
			cancelAnimationFrame(this._batchRAF);
			this._batchRAF = null;
		}
		this.clearSearch();

		if (this.softWrap) {
			// Flow mode — just clear the viewport
			this.viewport.innerHTML = '';
			this._flowStart = 0;
			this._flowEnd = 0;
		} else {
			// Virtual scroll — return entries to pool
			for (const [, item] of this._renderedEntries) {
				item.el.style.transform = 'translateY(-9999px)';
				this._pool.push(item.el);
			}
			this._renderedEntries.clear();
			this.updateVirtualHeight();
		}

		if (remote) this.postMessage({ type: UI_MESSAGES.CLEAR, data: { source: this.source } });
	}

	// ========================
	// VIRTUAL SCROLLING
	// ========================
	getDisplayCount() {
		return Viewport.getDisplayCount(this);
	}

	getLogAtDisplayIndex(displayIdx) {
		return Viewport.getLogAtDisplayIndex(this, displayIdx);
	}

	getBufferIndexForDisplayIndex(displayIdx) {
		return Viewport.getBufferIndexForDisplayIndex(this, displayIdx);
	}

	updateVirtualHeight() {
		Viewport.updateVirtualHeight(this);
	}

	renderVisibleRows() {
		Viewport.renderVisibleRows(this);
	}

	_entryHTML(log, bufIdx) {
		return Viewport.entryHTML(this, log, bufIdx);
	}

	_updateEntry(el, log, bufIdx) {
		Viewport.updateEntry(this, el, log, bufIdx);
	}

	_formatMessage(text, bufIdx) {
		return formatLogMessage(text, bufIdx, {
			ansiRenderer: globalThis.LogViewUniversalAnsiRenderer,
			escapeHtml: value => this.escapeHtml(value),
			renderBinaryChip: (segment, index) => this._renderBinaryChip(segment, index),
			segmentLogMessage,
		});
	}

	_formatAnsiText(text) {
		return formatMessageAnsiText(text, {
			ansiRenderer: globalThis.LogViewUniversalAnsiRenderer,
			escapeHtml: value => this.escapeHtml(value),
		});
	}

	_renderBinaryChip(seg, bufIdx) {
		// If this row is the MEDIA header line, stitch the full payload across
		// continuation chunks and render the image (or audio/video) inline.
		if (bufIdx != null && seg.mime && isInlineMediaMime(seg.mime)) {
			const stitched = collectMediaBlob(this.buffer, bufIdx);
			if (stitched) {
				const dataUrl = `data:${stitched.mime};base64,${toBase64(stitched.payload, stitched.enc)}`;
				const kb = stitched.size >= 1024
					? (stitched.size / 1024).toFixed(1) + ' KB'
					: stitched.size + ' B';
				if (stitched.mime.startsWith('image/')) {
					return `<span class="log-media-inline" title="${this.escapeHtml(stitched.mime)} · ${kb}"><img src="${dataUrl}" alt="${this.escapeHtml(stitched.mime)}"></span>`;
				}
				if (stitched.mime.startsWith('audio/')) {
					return `<span class="log-media-inline"><audio controls preload="none" src="${dataUrl}"></audio></span>`;
				}
				if (stitched.mime.startsWith('video/')) {
					return `<span class="log-media-inline"><video controls preload="metadata" src="${dataUrl}"></video></span>`;
				}
			}
		}
		const kb = seg.size >= 1024
			? (seg.size / 1024).toFixed(1) + ' KB'
			: seg.size + ' B';
		const id = this._stashBlob(seg);
		return `<span class="log-binary-chip" data-blob-id="${id}">[${this.escapeHtml(seg.mime)} · ${kb} · preview]</span>`;
	}

	_stashBlob(blob) {
		this._blobStore = this._blobStore || new Map();
		this._blobSeq = (this._blobSeq || 0) + 1;
		const id = String(this._blobSeq);
		this._blobStore.set(id, blob);
		// Cap the store so reused rows don't grow it unbounded.
		if (this._blobStore.size > 5000) {
			const firstKey = this._blobStore.keys().next().value;
			this._blobStore.delete(firstKey);
		}
		return id;
	}

	_invalidateAllRows() {
		Viewport.invalidateAllRows(this);
	}

	// ========================
	// CLIENT-SIDE FILTERING
	// ========================
	LEVEL_ORDER = FILTER_LEVEL_ORDER;
	LEVEL_NAMES = FILTER_LEVEL_NAMES;

	toggleLevel(level) {
		this.selectedLevels = toggleLevelSelection(this.selectedLevels, level);
		this.renderLevelChips();
		this.rebuildFilteredIndices();
	}

	renderLevelChips() {
		this.levelChips.innerHTML = this.LEVEL_ORDER.map(l => {
			const active = this.selectedLevels.has(l);
			return `<span class="level-chip level-${l}${active ? ' active' : ''}" data-tooltip="${this.LEVEL_NAMES[l]}" onclick="${this.handle}.toggleLevel('${l}')">${l}</span>`;
		}).join('');
	}

	rebuildFilteredIndices() {
		this.filteredIndices = buildFilteredIndices({
			buffer: this.buffer,
			tags: this.tags,
			selectedPackages: this.selectedPackages,
			selectedLevels: this.selectedLevels,
			searchFilterMode: this.searchFilterMode,
			query: this.query,
		});

		// Rebuild search matches against filtered view
		if (this.query) {
			this.matches = searchMatchesForIndices(this.buffer, this.filteredIndices, this.query);
			this.currentMatch = -1;
			this.updateSearchUI();
		}

		if (this.softWrap) {
			// Flow mode renders DOM entries directly — rebuild it.
			this._enterFlowMode();
		} else {
			this.updateVirtualHeight();
			this._invalidateAllRows();
			this.renderVisibleRows();
		}

		if (this.autoScroll) {
			this.logList.scrollTop = this.logList.scrollHeight;
		}
	}

	// ========================
	// LOG INGESTION (BATCHING)
	// ========================
	queueLogEntry(log) {
		LogIngestion.queueLogEntry(this, SOURCES, classifyMediaContinuation, log);
	}

	flushBatch() {
		LogIngestion.flushBatch(this);
	}

	trimBuffer() {
		LogIngestion.trimBuffer(this);
	}

	escapeHtml(text) {
		return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}

	escapeAttr(text) {
		return this.escapeHtml(text).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
	}

	// ========================
	// PLAY/PAUSE/STATUS
	// ========================
	togglePausePlay() {
		ChromeControls.togglePausePlay(this);
	}

	statusAction() {
		ChromeControls.statusAction(this);
	}

	updatePlayButton() {
		ChromeControls.updatePlayButton(this);
	}

	updateStatus() {
		ChromeControls.updateStatus(this);
	}

	// ========================
	// DEVICES
	// ========================
	refreshDevices() {
		ChromeControls.refreshDevices(this, UI_MESSAGES);
	}

	setDevices(devices) {
		ChromeControls.setDevices(this, SOURCES, devices);
	}

	initDetailPane() {
		this._detailPane = createLogDetailPane({
			buffer: this.buffer,
			blobStore: () => this._blobStore,
			collectMediaBlob,
			collectMultilineJsonBody,
			copy: text => this.postMessage({ type: UI_MESSAGES.COPY, data: { text } }),
			elements: () => ({
				pane: this.querySelector('#log-detail-pane'),
				body: this.querySelector('#log-detail-body'),
				title: this.querySelector('#log-detail-title'),
				copyBtn: this.querySelector('#log-detail-copy'),
				closeBtn: this.querySelector('#log-detail-close'),
				resize: this.querySelector('#log-detail-resize'),
			}),
			formatAnsiText: text => this._formatAnsiText(text),
			logList: this.logList,
			renderedEntries: this._renderedEntries,
			segmentLogMessage,
			softPrettyJson,
			stashBlob: blob => this._stashBlob(blob),
			toBase64,
			viewport: this.viewport,
		});
		this._detailPane.init();
	}

	initTooltips() {
		ChromeControls.initTooltips(this);
	}

	// ========================
	// PACKAGES AND LIFECYCLE
	// ========================
	fetchPackages() {
		PackageControls.fetchPackages(this, UI_MESSAGES);
	}

	fetchTags() {
		PackageControls.fetchTags(this, UI_MESSAGES);
	}

	initPackageAutocomplete() {
		PackageControls.initPackageAutocomplete(this);
	}

	showPackageDropdown(filter) {
		PackageControls.showPackageDropdown(this, filter);
	}

	selectPackage(pkg) {
		PackageControls.selectPackage(this, UI_MESSAGES, pkg);
	}

	_notifyPackagesChanged() {
		PackageControls.notifyPackagesChanged(this, UI_MESSAGES);
	}

	renderPackages() {
		PackageControls.renderPackages(this);
	}

	removePackage(index) {
		PackageControls.removePackage(this, index);
	}

	hidePackageDropdown() {
		PackageControls.hidePackageDropdown(this);
	}

	_showPackageEvent(message) {
		PackageControls.showPackageEvent(this, UI_MESSAGES, message);
	}

	_showLifecycleEvent(data) {
		PackageControls.showLifecycleEvent(this, data);
	}

	appAction(action) {
		PackageControls.appAction(this, UI_MESSAGES, action);
	}

	_showPackageInfo(info) {
		PackageControls.showPackageInfo(this, info);
	}

	// ========================
	// TAGS AND TAG GROUPS
	// ========================
	initTagInput() {
		TagControls.initTagInput(this);
	}

	showTagDropdown(filter) {
		TagControls.showTagDropdown(this, filter);
	}

	selectTag(tag) {
		TagControls.selectTag(this, tag);
	}

	hideTagDropdown() {
		TagControls.hideTagDropdown(this);
	}

	renderTags() {
		TagControls.renderTags(this);
	}

	removeTag(index) {
		TagControls.removeTag(this, index);
	}

	toggleTagGroupExpand() {
		TagControls.toggleTagGroupExpand(this);
	}

	clearActiveTagGroup() {
		TagControls.clearActiveTagGroup(this);
	}

	showTagGroupMenu() {
		TagControls.showTagGroupMenu(this);
	}

	_updateSaveBtn() {
		TagControls.updateSaveBtn(this);
	}

	saveCurrentTagGroup() {
		TagControls.saveCurrentTagGroup(this, UI_MESSAGES);
	}

	loadTagGroup(name) {
		TagControls.loadTagGroup(this, name);
	}

	deleteTagGroup(name) {
		TagControls.deleteTagGroup(this, UI_MESSAGES, name);
	}

	// ========================
	// COLUMN RESIZE
	// ========================
	initColumnResize() {
		ChromeControls.initColumnResize(this);
	}

	// ========================
	// SEARCH
	// ========================
	search(dir) {
		SearchControls.search(this, dir);
	}

	_doSearch(dir) {
		SearchControls.doSearch(this, dir);
	}

	toggleSearchFilter() {
		SearchControls.toggleSearchFilter(this);
	}

	clearSearch() {
		SearchControls.clearSearch(this);
	}

	matchesQuery(log, query) {
		return SearchControls.matchesQuery(this, log, query);
	}

	scrollToMatch(bufferIndex) {
		SearchControls.scrollToMatch(this, bufferIndex);
	}

	_rebuildFlowAround(displayIdx) {
		SearchControls.rebuildFlowAround(this, displayIdx);
	}

	updateSearchUI() {
		SearchControls.updateSearchUI(this);
	}

	// ========================
	// SCROLL AND VIEW MODES
	// ========================
	scrollToTop() {
		Viewport.scrollToTop(this);
	}

	scrollToBottom() {
		Viewport.scrollToBottom(this);
	}

	updateScrollButtons() {
		Viewport.updateScrollButtons(this);
	}

	_getMiddleDisplayIndex() {
		return Viewport.getMiddleDisplayIndex(this);
	}

	toggleSoftWrap() {
		Viewport.toggleSoftWrap(this);
	}

	_scrollToDisplayIndex(displayIdx) {
		Viewport.scrollToDisplayIndex(this, displayIdx);
	}

	_enterFlowMode() {
		Viewport.enterFlowMode(this);
	}

	_loadOlderEntries() {
		Viewport.loadOlderEntries(this);
	}

	_exitFlowMode() {
		Viewport.exitFlowMode(this);
	}

	toggleViewMode() {
		Viewport.toggleViewMode(this);
	}

	// ========================
	// COPY & EXPORT
	// ========================
	copyLogLine(event) {
		ChromeControls.copyLogLine(this, UI_MESSAGES, event);
	}

	exportLogs() {
		ChromeControls.exportLogs(this, UI_MESSAGES);
	}

	// ========================
	// MISC
	// ========================
	toggleLoading(force) {
		ChromeControls.toggleLoading(this, force);
	}

	render() {
		return renderLogViewTemplate({ handle: this.handle, UI_MESSAGES });
	}
}

customElements.define('logview-universal', LogView);
