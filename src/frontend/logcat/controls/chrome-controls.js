(function (root, factory) {
	if (typeof module === 'object' && module.exports) module.exports = factory();
	else root.LogViewUniversalChromeControls = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
	function togglePausePlay(host) {
		if (host.isPaused) host.resume();
		else if (host.isPlaying) host.pause();
	}

	function statusAction(host) {
		switch (host.state) {
			case 'idle': host.start(); break;
			case 'streaming': host.stop(); break;
			case 'paused': host.resume(); break;
		}
	}

	function updatePlayButton(host) {
		if (!host.isPlaying) {
			host.pausePlayButton.className = 'ic play';
			host.pausePlayButton.dataset.tooltip = 'Pause';
			host.pausePlayButton.disabled = true;
		} else if (host.isPaused) {
			host.pausePlayButton.className = 'ic play';
			host.pausePlayButton.dataset.tooltip = 'Resume';
			host.pausePlayButton.disabled = false;
		} else {
			host.pausePlayButton.className = 'ic pause';
			host.pausePlayButton.dataset.tooltip = 'Pause';
			host.pausePlayButton.disabled = false;
		}
	}

	function updateStatus(host) {
		let text = 'Not Started';
		switch (host.state) {
			case 'streaming':
				text = 'Streaming';
				host.statusActionBtn.className = 'ic stop';
				host.statusActionBtn.dataset.tooltip = 'Stop';
				break;
			case 'paused':
				text = 'Paused';
				host.statusActionBtn.className = 'ic play';
				host.statusActionBtn.dataset.tooltip = 'Resume';
				break;
			default:
				host.statusActionBtn.className = 'ic play';
				host.statusActionBtn.dataset.tooltip = 'Start';
				break;
		}
		host.statusText.textContent = text;
		host.pauseBanner.style.display = host.state === 'paused' ? '' : 'none';
	}

	function refreshDevices(host, UI_MESSAGES) {
		host.toggleLoading(true);
		host.postMessage({ type: UI_MESSAGES.DEVICES, data: { source: host.source } });
	}

	function setDevices(host, SOURCES, devices) {
		const prevValue = host.deviceSelect.value;
		host.deviceSelect.innerHTML = devices.length
			? devices.map(d => {
				const status = d.status && d.status !== 'online' ? ` (${d.status})` : '';
				const disabled = d.status && d.status !== 'online' ? ' disabled' : '';
				const kind = d.kind ? ` data-kind="${host.escapeAttr(d.kind)}"` : '';
				const label = `${d.model}${status}`;
				return `<option value="${host.escapeAttr(d.id)}"${kind}${disabled} title="${host.escapeAttr(label)}">${host.escapeHtml(label)}</option>`;
			}).join('')
			: `<option value="">No ${host.source === SOURCES.DEBUG ? 'debug sessions' : host.source === SOURCES.IOS ? 'iOS devices' : 'Android devices'} found</option>`;

		if (prevValue && [...host.deviceSelect.options].some(o => o.value === prevValue && !o.disabled)) {
			host.deviceSelect.value = prevValue;
		}
		if (devices.length && devices.some(d => d.status === 'online')) {
			host.fetchPackages();
			host.fetchTags();
		}
	}

	function initTooltips(host) {
		let tip = null;
		let timer = null;
		let lastEvent = null;

		const show = () => {
			if (!lastEvent) return;
			const el = lastEvent.target.closest('[data-tooltip]');
			if (!el) return;
			const text = el.dataset.tooltip;
			if (!text) return;
			if (!tip) {
				tip = document.createElement('div');
				tip.className = 'tooltip';
				host.appendChild(tip);
			}
			tip.textContent = text;
			tip.style.display = 'block';
			const tipW = tip.offsetWidth;
			const pageW = document.documentElement.clientWidth;
			let left = lastEvent.pageX + 12;
			if (left + tipW > pageW - 8) {
				left = lastEvent.pageX - tipW - 8;
			}
			tip.style.left = Math.max(4, left) + 'px';
			tip.style.top = (lastEvent.pageY + 16) + 'px';
		};

		const hide = () => {
			clearTimeout(timer);
			timer = null;
			if (tip) tip.style.display = 'none';
		};

		host.addEventListener('mouseover', (e) => {
			const el = e.target.closest('[data-tooltip]');
			if (!el) { hide(); return; }
			lastEvent = e;
			clearTimeout(timer);
			timer = setTimeout(() => show(), 400);
		});

		host.addEventListener('mouseout', (e) => {
			const el = e.target.closest('[data-tooltip]');
			if (el) hide();
		});
	}

	function initColumnResize(host) {
		const cols = { timestamp: 160, tag: 180, pkg: 160, pid: 55, badge: 36 };
		const applyWidths = () => {
			const root = host.style;
			for (const [col, w] of Object.entries(cols)) {
				root.setProperty(`--col-${col}`, `${w}px`);
			}
		};
		applyWidths();

		host.colHeader.querySelectorAll('.col-resize').forEach(handle => {
			handle.addEventListener('mousedown', (e) => {
				e.preventDefault();
				const col = handle.dataset.col;
				const startX = e.clientX;
				const startW = cols[col];

				const onMove = (e) => {
					cols[col] = Math.max(30, startW + (e.clientX - startX));
					applyWidths();
				};
				const onUp = () => {
					document.removeEventListener('mousemove', onMove);
					document.removeEventListener('mouseup', onUp);
				};
				document.addEventListener('mousemove', onMove);
				document.addEventListener('mouseup', onUp);
			});
		});
	}

	function copyLogLine(host, UI_MESSAGES, event) {
		const entry = event.target.closest('entry');
		if (!entry) return;
		window.getSelection()?.removeAllRanges();
		const c = entry.children;
		const text = `${c[0]?.textContent || ''} ${c[1]?.textContent || ''} ${c[2]?.textContent || ''} ${c[3]?.textContent || ''} ${c[4]?.textContent || ''} ${c[5]?.textContent || ''}`.replace(/\s+/g, ' ').trim();
		host.postMessage({ type: UI_MESSAGES.COPY, data: { text } });
	}

	function exportLogs(host, UI_MESSAGES) {
		const count = host.getDisplayCount();
		const lines = [];
		for (let i = 0; i < count; i++) {
			const log = host.getLogAtDisplayIndex(i);
			lines.push(`${log.timestamp} ${log.pid || ''} ${log.tid || ''} ${log.priority} ${log.tag}: ${log.message}`);
		}
		host.postMessage({ type: UI_MESSAGES.EXPORT, data: { logs: lines.join('\n') } });
	}

	function toggleLoading(host, force) {
		host.loadingBar.style.display = force ? '' : 'none';
	}

	return {
		copyLogLine,
		exportLogs,
		initColumnResize,
		initTooltips,
		refreshDevices,
		setDevices,
		statusAction,
		toggleLoading,
		togglePausePlay,
		updatePlayButton,
		updateStatus,
	};
});
