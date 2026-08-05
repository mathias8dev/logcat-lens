(function (root, factory) {
	if (typeof module === 'object' && module.exports) module.exports = factory();
	else root.LogViewUniversalPackageControls = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
	function fetchPackages(host, UI_MESSAGES) {
		const deviceId = host.deviceSelect.value;
		if (deviceId) host.postMessage({ type: UI_MESSAGES.PACKAGES, data: { source: host.source, deviceId } });
	}

	function fetchTags(host, UI_MESSAGES) {
		const deviceId = host.deviceSelect.value;
		if (deviceId) host.postMessage({ type: UI_MESSAGES.FETCH_TAGS, data: { source: host.source, deviceId } });
	}

	function initPackageAutocomplete(host) {
		const input = host.packageInput;
		const dropdown = host.packageDropdown;

		host.deviceSelect.addEventListener('change', () => {
			host.fetchPackages();
			host.fetchTags();
		});

		input.addEventListener('input', () => host.showPackageDropdown(input.value));

		input.addEventListener('focus', () => {
			if (host.availablePackages.length) host.showPackageDropdown(input.value);
		});

		input.addEventListener('keydown', (e) => {
			const items = dropdown.querySelectorAll('.pkg-item');
			const active = dropdown.querySelector('.pkg-item.active');
			if (e.key === 'Enter') {
				e.preventDefault();
				const val = (active ? active.textContent : input.value).trim();
				if (val && !host.selectedPackages.includes(val)) {
					host.selectedPackages.push(val);
					host.renderPackages();
					host._notifyPackagesChanged();
				}
				input.value = '';
				host.hidePackageDropdown();
			} else if (e.key === 'ArrowDown') {
				e.preventDefault();
				const next = active ? active.nextElementSibling || items[0] : items[0];
				active?.classList.remove('active');
				next?.classList.add('active');
				next?.scrollIntoView({ block: 'nearest' });
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				const prev = active ? active.previousElementSibling || items[items.length - 1] : items[items.length - 1];
				active?.classList.remove('active');
				prev?.classList.add('active');
				prev?.scrollIntoView({ block: 'nearest' });
			} else if (e.key === 'Escape') {
				host.hidePackageDropdown();
			} else if (e.key === 'Backspace' && !input.value && host.selectedPackages.length) {
				host.selectedPackages.pop();
				host.renderPackages();
				host._notifyPackagesChanged();
			}
		});

		document.addEventListener('click', (e) => {
			if (!input.contains(e.target) && !dropdown.contains(e.target)) {
				host.hidePackageDropdown();
			}
		});
	}

	function showPackageDropdown(host, filter) {
		const dropdown = host.packageDropdown;
		const query = (filter || '').toLowerCase();
		const filtered = host.availablePackages
			.filter(p => p.toLowerCase().includes(query) && !host.selectedPackages.includes(p));

		if (!filtered.length) { host.hidePackageDropdown(); return; }

		dropdown.innerHTML = filtered.slice(0, 50).map(p =>
			`<div class="pkg-item" data-pkg="${host.escapeAttr(p)}" onmousedown="${host.handle}.selectPackage(this.dataset.pkg)">${host.escapeHtml(p)}</div>`
		).join('');
		dropdown.style.display = 'block';
	}

	function selectPackage(host, UI_MESSAGES, pkg) {
		if (!host.selectedPackages.includes(pkg)) {
			host.selectedPackages.push(pkg);
			host.renderPackages();
			host._notifyPackagesChanged();
			const deviceId = host.deviceSelect.value;
			if (deviceId) host.postMessage({ type: UI_MESSAGES.PACKAGE_INFO, data: { source: host.source, deviceId, packageName: pkg } });
		}
		host.packageInput.value = '';
		host.hidePackageDropdown();
	}

	function notifyPackagesChanged(host, UI_MESSAGES) {
		host.postMessage({ type: UI_MESSAGES.UPDATE_PACKAGES, data: { source: host.source, packages: host.selectedPackages.slice() } });
	}

	function renderPackages(host) {
		host.packageChips.innerHTML = host.selectedPackages.map((p, i) =>
			`<span class="pkg-chip">${host.escapeHtml(p.split('.').pop())}<span class="pkg-remove" title="${host.escapeAttr(p)}" onclick="${host.handle}.removePackage(${i})">\u00d7</span></span>`
		).join('');
		if (host.selectedPackages.length !== 1) {
			host.lifecycleStatus.style.display = 'none';
			host.lifecycleActions.style.display = 'none';
		}
		host.rebuildFilteredIndices();
	}

	function removePackage(host, index) {
		host.selectedPackages.splice(index, 1);
		host.renderPackages();
		host._notifyPackagesChanged();
	}

	function hidePackageDropdown(host) {
		host.packageDropdown.style.display = 'none';
	}

	function showPackageEvent(host, UI_MESSAGES, message) {
		const prev = host.statusText.textContent;
		host.statusText.textContent = `Package: ${message.substring(0, 60)}`;
		host.statusText.style.color = 'var(--vscode-editorWarning-foreground, #cca700)';
		setTimeout(() => {
			host.statusText.textContent = prev;
			host.statusText.style.color = '';
		}, 4000);
		host.fetchPackages();
		host.selectedPackages.forEach(pkg => {
			host.postMessage({ type: UI_MESSAGES.PACKAGE_INFO, data: { source: host.source, deviceId: host.deviceSelect.value, packageName: pkg } });
		});
	}

	function showLifecycleEvent(host, data) {
		if (host.selectedPackages.length !== 1) return;

		const labels = {
			'started': '▶ App Started',
			'displayed': '▶ App Displayed',
			'foreground': '▶ App in Foreground',
			'resumed': '▶ App Resumed',
			'paused': '⏸ App Paused',
			'background': '⏸ App in Background',
			'not-running': '⏹ App Not Running',
			'stopped': '⏹ App Stopped',
			'killed': '✖ App Killed',
			'died': '✖ App Died',
			'crashed': '💥 App Crashed',
			'anr': '⚠ App Not Responding',
			'force-stopped': '✖ App Force Stopped',
		};
		const label = labels[data.event] || data.event;

		host.lifecycleStatus.textContent = label;
		host.lifecycleStatus.className = `lifecycle-badge lifecycle-${data.event}`;
		host.lifecycleStatus.title = data.detail;
		host.lifecycleStatus.style.display = '';

		const actions = {
			'not-running': `<button class="lifecycle-action" onclick="${host.handle}.appAction('launch')">Launch</button><button class="lifecycle-action" onclick="${host.handle}.appAction('clear-data')">Clear Data</button>`,
			'killed': `<button class="lifecycle-action" onclick="${host.handle}.appAction('launch')">Launch</button>`,
			'died': `<button class="lifecycle-action" onclick="${host.handle}.appAction('launch')">Launch</button>`,
			'crashed': `<button class="lifecycle-action" onclick="${host.handle}.appAction('launch')">Relaunch</button>`,
			'force-stopped': `<button class="lifecycle-action" onclick="${host.handle}.appAction('launch')">Launch</button><button class="lifecycle-action" onclick="${host.handle}.appAction('clear-data')">Clear Data</button>`,
			'background': `<button class="lifecycle-action" onclick="${host.handle}.appAction('launch')">Bring to Front</button><button class="lifecycle-action" onclick="${host.handle}.appAction('force-stop')">Force Stop</button>`,
			'foreground': `<button class="lifecycle-action" onclick="${host.handle}.appAction('force-stop')">Force Stop</button>`,
		};
		const actionHtml = actions[data.event] || '';
		host.lifecycleActions.innerHTML = actionHtml;
		host.lifecycleActions.style.display = actionHtml ? '' : 'none';

		const now = new Date();
		const ts = `${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}.${String(now.getMilliseconds()).padStart(3,'0')}`;
		host.queueLogEntry({
			timestamp: ts,
			pid: '',
			tid: '',
			priority: 'L',
			tag: 'LogView Universal',
			message: label,
			pkg: data.pkg,
			_lifecycle: data.event,
		});
	}

	function appAction(host, UI_MESSAGES, action) {
		if (host.selectedPackages.length !== 1) return;
		const deviceId = host.deviceSelect.value;
		const packageName = host.selectedPackages[0];
		const messageType = {
			launch: UI_MESSAGES.APP_LAUNCH,
			'force-stop': UI_MESSAGES.APP_FORCE_STOP,
			'clear-data': UI_MESSAGES.APP_CLEAR_DATA,
		}[action];
		if (!messageType) return;
		host.postMessage({ type: messageType, data: { source: host.source, deviceId, packageName } });
	}

	function showPackageInfo(host, info) {
		const chips = host.packageChips.querySelectorAll('.pkg-chip');
		chips.forEach(chip => {
			const removeBtn = chip.querySelector('.pkg-remove');
			if (removeBtn && removeBtn.title === info.packageName) {
				chip.dataset.tooltip = `${info.packageName} v${info.version}${info.versionCode ? ' (' + info.versionCode + ')' : ''}`;
			}
		});
	}

	return {
		appAction,
		fetchPackages,
		fetchTags,
		hidePackageDropdown,
		initPackageAutocomplete,
		notifyPackagesChanged,
		removePackage,
		renderPackages,
		selectPackage,
		showLifecycleEvent,
		showPackageDropdown,
		showPackageEvent,
		showPackageInfo,
	};
});
