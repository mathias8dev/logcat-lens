(function (root, factory) {
	if (typeof module === 'object' && module.exports) module.exports = factory();
	else root.LogViewUniversalViewport = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
	function getDisplayCount(host) {
		return host.filteredIndices.length;
	}

	function getLogAtDisplayIndex(host, displayIdx) {
		return host.buffer[host.filteredIndices[displayIdx]];
	}

	function getBufferIndexForDisplayIndex(host, displayIdx) {
		return host.filteredIndices[displayIdx];
	}

	function updateVirtualHeight(host) {
		const totalHeight = getDisplayCount(host) * host.ROW_HEIGHT;
		host.viewport.style.height = totalHeight + 'px';
	}

	function renderVisibleRows(host) {
		const scrollTop = host.logList.scrollTop;
		const viewHeight = host.logList.clientHeight;
		const totalRows = getDisplayCount(host);

		if (!viewHeight || !totalRows) return;

		const startRow = Math.max(0, Math.floor(scrollTop / host.ROW_HEIGHT) - host.OVERSCAN);
		const endRow = Math.min(totalRows, Math.ceil((scrollTop + viewHeight) / host.ROW_HEIGHT) + host.OVERSCAN);

		for (const [idx, item] of host._renderedEntries) {
			if (idx < startRow || idx >= endRow) {
				item.el.style.transform = 'translateY(-9999px)';
				host._pool.push(item.el);
				host._renderedEntries.delete(idx);
			}
		}

		const activeMatchBufIdx = (host.currentMatch >= 0) ? host.matches[host.currentMatch] : -1;

		for (let i = startRow; i < endRow; i++) {
			const bufIdx = getBufferIndexForDisplayIndex(host, i);
			const existing = host._renderedEntries.get(i);

			if (existing && existing.bufIdx === bufIdx) {
				continue;
			}

			const log = getLogAtDisplayIndex(host, i);
			if (!log) continue;

			let el;
			if (existing) {
				el = existing.el;
			} else if (host._pool.length > 0) {
				el = host._pool.pop();
			} else {
				el = document.createElement('entry');
				el.style.position = 'absolute';
				el.style.left = '0';
				el.style.height = host.ROW_HEIGHT + 'px';
				el.style.willChange = 'transform';
				host.viewport.appendChild(el);
			}

			el.className = entryClassName(host, log, bufIdx, activeMatchBufIdx);
			el.style.transform = `translateY(${i * host.ROW_HEIGHT}px)`;
			el.dataset.bufIdx = bufIdx;
			el.children.length === 0
				? el.innerHTML = entryHTML(host, log, bufIdx)
				: updateEntry(host, el, log, bufIdx);

			host._renderedEntries.set(i, { el, bufIdx });
		}

		host._visibleStart = startRow;
		host._visibleEnd = endRow;
	}

	function entryClassName(host, log, bufIdx, activeMatchBufIdx) {
		return log.priority
			+ (log._lifecycle ? ' lifecycle-entry lifecycle-' + log._lifecycle : '')
			+ (activeMatchBufIdx === bufIdx ? ' active-match' : '')
			+ (host._selectedBufIdx === bufIdx ? ' selected' : '');
	}

	function entryHTML(host, log, bufIdx) {
		return `<timestamp>${log.timestamp}</timestamp><tag>${(log.tag || '').trim()}</tag><pkg>${log.pkg || ''}</pkg><pid>${log.pid || ''}</pid><badge>${log.priority}</badge><message>${host._formatMessage(log.message, bufIdx)}</message>`;
	}

	function updateEntry(host, el, log, bufIdx) {
		const c = el.children;
		c[0].textContent = log.timestamp;
		c[1].textContent = (log.tag || '').trim();
		c[2].textContent = log.pkg || '';
		c[3].textContent = log.pid || '';
		c[4].textContent = log.priority;
		c[5].innerHTML = host._formatMessage(log.message, bufIdx);
	}

	function invalidateAllRows(host) {
		for (const [, item] of host._renderedEntries) {
			item.el.style.transform = 'translateY(-9999px)';
			host._pool.push(item.el);
		}
		host._renderedEntries.clear();
	}

	function scrollToTop(host) {
		host.logList.scrollTop = 0;
		host.autoScroll = false;
		host.updateScrollButtons();
	}

	function scrollToBottom(host) {
		host.logList.scrollTop = host.logList.scrollHeight;
		host.autoScroll = true;
		host.updateScrollButtons();
	}

	function updateScrollButtons(host) {
		host.scrollBottomBtn.classList.toggle('active', host.autoScroll);
	}

	function getMiddleDisplayIndex(host) {
		if (host.softWrap) {
			const midY = host.logList.scrollTop + host.logList.clientHeight / 2;
			const entries = host.viewport.children;
			for (let i = 0; i < entries.length; i++) {
				const top = entries[i].offsetTop;
				const bottom = top + entries[i].offsetHeight;
				if (midY >= top && midY < bottom) return i;
			}
			return Math.max(0, entries.length - 1);
		}

		const midRow = Math.floor((host.logList.scrollTop + host.logList.clientHeight / 2) / host.ROW_HEIGHT);
		return Math.min(midRow, getDisplayCount(host) - 1);
	}

	function toggleSoftWrap(host) {
		const midDisplayIdx = getDisplayCount(host) > 0 ? getMiddleDisplayIndex(host) : -1;

		host.softWrap = !host.softWrap;
		host.logList.classList.toggle('soft-wrap', host.softWrap);
		host.softWrapBtn.classList.toggle('active', host.softWrap);

		if (host.softWrap) {
			enterFlowMode(host);
		} else {
			exitFlowMode(host);
		}

		if (midDisplayIdx >= 0 && !host.autoScroll) {
			scrollToDisplayIndex(host, midDisplayIdx);
		}
	}

	function scrollToDisplayIndex(host, displayIdx) {
		if (host.softWrap) {
			const entry = host.viewport.children[displayIdx];
			if (entry) {
				host.logList.scrollTop = entry.offsetTop - host.logList.clientHeight / 2 + entry.offsetHeight / 2;
			}
			return;
		}

		host.logList.scrollTop = displayIdx * host.ROW_HEIGHT - host.logList.clientHeight / 2 + host.ROW_HEIGHT / 2;
		renderVisibleRows(host);
	}

	function enterFlowMode(host) {
		host._renderedEntries.clear();
		host._pool = [];
		host.viewport.innerHTML = '';
		host.viewport.style.height = 'auto';

		const count = getDisplayCount(host);
		host._flowStart = Math.max(0, count - host.SOFT_WRAP_MAX_DOM);
		host._flowEnd = count;
		let html = '';
		for (let i = host._flowStart; i < host._flowEnd; i++) {
			const log = getLogAtDisplayIndex(host, i);
			if (!log) continue;
			html += `<entry class="${log.priority}${log._lifecycle ? ' lifecycle-entry lifecycle-' + log._lifecycle : ''}" data-buf-idx="${getBufferIndexForDisplayIndex(host, i)}">${entryHTML(host, log, getBufferIndexForDisplayIndex(host, i))}</entry>`;
		}
		host.viewport.innerHTML = html;

		if (host.autoScroll) host.logList.scrollTop = host.logList.scrollHeight;
	}

	function loadOlderEntries(host) {
		if (host._flowStart <= 0) return;

		const loadCount = Math.min(host.SOFT_WRAP_LOAD_CHUNK, host._flowStart);
		const newStart = host._flowStart - loadCount;
		const oldHeight = host.logList.scrollHeight;

		let html = '';
		for (let i = newStart; i < host._flowStart; i++) {
			const log = getLogAtDisplayIndex(host, i);
			if (!log) continue;
			html += `<entry class="${log.priority}${log._lifecycle ? ' lifecycle-entry lifecycle-' + log._lifecycle : ''}" data-buf-idx="${getBufferIndexForDisplayIndex(host, i)}">${entryHTML(host, log, getBufferIndexForDisplayIndex(host, i))}</entry>`;
		}
		host.viewport.insertAdjacentHTML('afterbegin', html);
		host._flowStart = newStart;

		const heightDiff = host.logList.scrollHeight - oldHeight;
		host.logList.scrollTop += heightDiff;
	}

	function exitFlowMode(host) {
		host.viewport.innerHTML = '';
		host._renderedEntries.clear();
		host._pool = [];
		updateVirtualHeight(host);
		renderVisibleRows(host);

		if (host.autoScroll) host.logList.scrollTop = host.logList.scrollHeight;
	}

	function toggleViewMode(host) {
		host.viewMode = host.viewMode === 'standard' ? 'compact' : 'standard';
		const isCompact = host.viewMode === 'compact';
		host.logList.classList.toggle('compact', isCompact);
		host.colHeader.classList.toggle('compact', isCompact);
		host.viewModeBtn.classList.toggle('active', isCompact);
	}

	return {
		entryHTML,
		getBufferIndexForDisplayIndex,
		getDisplayCount,
		getLogAtDisplayIndex,
		getMiddleDisplayIndex,
		invalidateAllRows,
		loadOlderEntries,
		renderVisibleRows,
		scrollToBottom,
		scrollToDisplayIndex,
		scrollToTop,
		toggleSoftWrap,
		toggleViewMode,
		updateEntry,
		updateScrollButtons,
		updateVirtualHeight,
		enterFlowMode,
		exitFlowMode,
	};
});
