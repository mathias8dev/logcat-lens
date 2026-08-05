(function defineLogFilterModel(root, factory) {
	if (typeof module === 'object' && module.exports) {
		module.exports = factory();
		return;
	}
	root.LogViewUniversalFilterModel = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function createLogFilterModel() {
	const LEVEL_ORDER = Object.freeze(['V', 'D', 'I', 'W', 'E', 'F', 'L']);
	const LEVEL_NAMES = Object.freeze({
		V: 'Verbose',
		D: 'Debug',
		I: 'Info',
		W: 'Warning',
		E: 'Error',
		F: 'Fatal',
		L: 'LogView Universal',
	});

	function logMatchesQuery(log, query) {
		return (log?.text || '').includes((query || '').toLowerCase());
	}

	function rebuildFilteredIndices({
		buffer,
		tags = [],
		selectedPackages = [],
		selectedLevels = new Set(LEVEL_ORDER),
		searchFilterMode = false,
		query = '',
	}) {
		const hasTags = tags.length > 0;
		const hasPkgs = selectedPackages.length > 0;
		const allLevels = selectedLevels.size === LEVEL_ORDER.length;
		const hasLevel = !allLevels;
		const hasSearch = searchFilterMode && query;
		const showLifecycle = selectedLevels.has('L');
		const filteredIndices = [];

		for (let index = 0; index < buffer.length; index += 1) {
			const log = buffer[index];
			if (log._mediaContinuation) continue;
			if (log.priority === 'L') {
				if (showLifecycle) filteredIndices.push(index);
				continue;
			}
			if (hasLevel && !selectedLevels.has(log.priority)) continue;
			if (hasTags && !tags.includes((log.tag || '').trim())) continue;
			if (hasPkgs && !selectedPackages.some(pkg => (log.pkg || '').includes(pkg))) continue;
			if (hasSearch && !logMatchesQuery(log, query)) continue;
			filteredIndices.push(index);
		}

		return filteredIndices;
	}

	function searchMatchesForIndices(buffer, indices, query) {
		if (!query) return [];
		return indices.filter(index => logMatchesQuery(buffer[index], query));
	}

	function toggleLevelSelection(selectedLevels, level) {
		const next = new Set(selectedLevels);
		if (next.has(level)) {
			if (next.size > 1) next.delete(level);
		} else {
			next.add(level);
		}
		return next;
	}

	return {
		LEVEL_NAMES,
		LEVEL_ORDER,
		logMatchesQuery,
		rebuildFilteredIndices,
		searchMatchesForIndices,
		toggleLevelSelection,
	};
});
