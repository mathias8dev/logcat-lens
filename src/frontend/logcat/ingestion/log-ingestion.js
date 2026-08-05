(function (root, factory) {
	if (typeof module === 'object' && module.exports) module.exports = factory();
	else root.LogViewUniversalLogIngestion = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
	function queueLogEntry(host, SOURCES, classifyMediaContinuation, log) {
		log.text = `${log.timestamp} ${log.pkg || ''} ${log.tag} ${log.message}`.toLowerCase();
		if (log.tag) host.knownTags.add(log.tag.trim());
		if (host.source === SOURCES.DEBUG && log.platform === SOURCES.DEBUG && log.pkg && !host.availablePackages.includes(log.pkg)) {
			host.availablePackages.push(log.pkg);
			host.availablePackages.sort();
			if (document.activeElement === host.packageInput) host.showPackageDropdown(host.packageInput.value);
		}
		classifyMediaContinuation(log, host._mediaSources);
		host._pendingLogs.push(log);

		if (!host._batchRAF) {
			host._batchRAF = requestAnimationFrame(() => host.flushBatch());
		}
	}

	function flushBatch(host) {
		host._batchRAF = null;
		const logs = host._pendingLogs;
		if (!logs.length) return;
		host._pendingLogs = [];

		const allLevels = host.selectedLevels.size === host.LEVEL_ORDER.length;
		const hasLevel = !allLevels;
		const hasTags = host.tags.length > 0;
		const hasPkgs = host.selectedPackages.length > 0;
		const hasSearch = host.searchFilterMode && host.query;

		for (let i = 0; i < logs.length; i++) {
			const log = logs[i];
			const bufIdx = host.buffer.length;
			host.buffer.push(log);

			if (log._mediaContinuation) continue;

			let pass;
			if (log.priority === 'L') {
				pass = host.selectedLevels.has('L');
			} else {
				pass = true;
				if (hasLevel && !host.selectedLevels.has(log.priority)) pass = false;
				if (hasTags && !host.tags.includes((log.tag || '').trim())) pass = false;
				if (hasPkgs && !host.selectedPackages.some(p => (log.pkg || '').includes(p))) pass = false;
				if (hasSearch && !host.matchesQuery(log)) pass = false;
			}
			if (pass) host.filteredIndices.push(bufIdx);

			if (pass && host.query && host.matchesQuery(log)) {
				host.matches.push(bufIdx);
			}
		}

		if (host.query) host.updateSearchUI();

		host.trimBuffer();

		if (host.softWrap) {
			const filterSet = new Set(host.filteredIndices.slice(-host.SOFT_WRAP_MAX_DOM));
			let html = '';
			const startIdx = host.buffer.length - logs.length;
			for (let i = 0; i < logs.length; i++) {
				const bufIdx = startIdx + i;
				if (!filterSet.has(bufIdx)) continue;
				const log = logs[i];
				html += `<entry class="${log.priority}${log._lifecycle ? ' lifecycle-entry lifecycle-' + log._lifecycle : ''}" data-buf-idx="${bufIdx}">${host._entryHTML(log, bufIdx)}</entry>`;
			}
			if (html) {
				host.viewport.insertAdjacentHTML('beforeend', html);
				host._flowEnd = host.getDisplayCount();
			}

			const children = host.viewport.children;
			if (children.length > host.SOFT_WRAP_MAX_DOM && host.autoScroll) {
				const removeCount = children.length - host.SOFT_WRAP_MAX_DOM;
				for (let r = 0; r < removeCount; r++) {
					children[0].remove();
				}
				host._flowStart += removeCount;
			}
		} else {
			host.updateVirtualHeight();
			host.renderVisibleRows();
		}

		if (host.autoScroll) {
			host.logList.scrollTop = host.logList.scrollHeight;
		}
	}

	function trimBuffer(host) {
		if (host.buffer.length <= host.BUFFER_SIZE) return;

		const oldDisplayCount = host.getDisplayCount();
		const removeCount = host.buffer.length - host.BUFFER_SIZE + 10000;
		host.buffer.splice(0, removeCount);

		host.filteredIndices = host.filteredIndices
			.map(idx => idx - removeCount)
			.filter(idx => idx >= 0);

		const origLen = host.matches.length;
		host.matches = host.matches
			.map(idx => idx - removeCount)
			.filter(idx => idx >= 0);
		if (host.currentMatch >= 0) {
			const removed = origLen - host.matches.length;
			host.currentMatch -= removed;
			if (host.currentMatch < 0) host.currentMatch = -1;
		}
		host.updateSearchUI();

		const newDisplayCount = host.getDisplayCount();
		const removedDisplayRows = oldDisplayCount - newDisplayCount;
		if (!host.autoScroll && removedDisplayRows > 0) {
			host.logList.scrollTop = Math.max(0, host.logList.scrollTop - removedDisplayRows * host.ROW_HEIGHT);
		}

		host._invalidateAllRows();
	}

	return {
		flushBatch,
		queueLogEntry,
		trimBuffer,
	};
});
