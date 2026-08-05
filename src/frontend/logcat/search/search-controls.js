(function (root, factory) {
	if (typeof module === 'object' && module.exports) module.exports = factory(require('../log-filter-model'));
	else root.LogViewUniversalSearchControls = factory(root.LogViewUniversalFilterModel);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (FilterModel) {
	const {
		logMatchesQuery,
		searchMatchesForIndices,
	} = FilterModel;

	function search(host, dir) {
		clearTimeout(host._searchDebounce);
		host._searchDebounce = setTimeout(() => doSearch(host, dir), 150);
	}

	function doSearch(host, dir) {
		const q = host.searchInput.value.toLowerCase();
		if (!q) return host.clearSearch();

		if (q != host.query) {
			host.query = q;
			if (host.searchFilterMode) host.rebuildFilteredIndices();
			host.matches = searchMatchesForIndices(host.buffer, host.filteredIndices, q);
			host.currentMatch = -1;
		}

		if (host.matches.length == 0) return host.updateSearchUI();

		if (dir === 'next') {
			host.currentMatch++;
			if (host.currentMatch >= host.matches.length) host.currentMatch = 0;
		} else {
			host.currentMatch--;
			if (host.currentMatch < 0) host.currentMatch = host.matches.length - 1;
		}

		host.scrollToMatch(host.matches[host.currentMatch]);
		host.updateSearchUI();
	}

	function toggleSearchFilter(host) {
		host.searchFilterMode = !host.searchFilterMode;
		host.searchFilterBtn.classList.toggle('active', host.searchFilterMode);
		host.rebuildFilteredIndices();
	}

	function clearSearch(host) {
		host.matches = [];
		host.currentMatch = -1;
		host.query = '';
		host.updateSearchUI();
		if (host.searchFilterMode) host.rebuildFilteredIndices();
		if (host.softWrap) {
			host.viewport.querySelectorAll('.active-match').forEach(e => e.classList.remove('active-match'));
		} else {
			host._invalidateAllRows();
			host.renderVisibleRows();
		}
	}

	function matchesQuery(host, log, query) {
		return logMatchesQuery(log, query || host.query);
	}

	function scrollToMatch(host, bufferIndex) {
		const displayIdx = host.filteredIndices.indexOf(bufferIndex);
		if (displayIdx === -1) return;

		if (host.softWrap) {
			const domIdx = displayIdx - host._flowStart;
			if (domIdx < 0 || domIdx >= host.viewport.children.length) {
				rebuildFlowAround(host, displayIdx);
			}
			host.viewport.querySelectorAll('.active-match').forEach(e => e.classList.remove('active-match'));
			const entry = host.viewport.children[displayIdx - host._flowStart];
			if (entry) {
				entry.classList.add('active-match');
				entry.scrollIntoView({ block: 'center' });
			}
		} else {
			const targetTop = displayIdx * host.ROW_HEIGHT;
			const viewHeight = host.logList.clientHeight;
			host.logList.scrollTop = targetTop - viewHeight / 2 + host.ROW_HEIGHT / 2;
			host._invalidateAllRows();
			host.renderVisibleRows();
		}

		host.autoScroll = false;
		host.updateScrollButtons();
	}

	function rebuildFlowAround(host, displayIdx) {
		const count = host.getDisplayCount();
		const half = Math.floor(host.SOFT_WRAP_MAX_DOM / 2);
		host._flowStart = Math.max(0, displayIdx - half);
		host._flowEnd = Math.min(count, host._flowStart + host.SOFT_WRAP_MAX_DOM);
		let html = '';
		for (let i = host._flowStart; i < host._flowEnd; i++) {
			const log = host.getLogAtDisplayIndex(i);
			if (!log) continue;
			html += `<entry class="${log.priority}${log._lifecycle ? ' lifecycle-entry lifecycle-' + log._lifecycle : ''}" data-buf-idx="${host.getBufferIndexForDisplayIndex(i)}">${host._entryHTML(log, host.getBufferIndexForDisplayIndex(i))}</entry>`;
		}
		host.viewport.innerHTML = html;
	}

	function updateSearchUI(host) {
		const total = host.matches.length;
		const current = host.currentMatch >= 0 ? host.currentMatch + 1 : 0;
		host.searchMatches.textContent = !total ? (host.query ? 'No results' : '') : `${current} of ${total}`;
		host.prevButton.disabled = host.nextButton.disabled = !total;
	}

	return {
		clearSearch,
		doSearch,
		matchesQuery,
		rebuildFlowAround,
		scrollToMatch,
		search,
		toggleSearchFilter,
		updateSearchUI,
	};
});
