(function defineLogDetailPane(root, factory) {
	if (typeof module === 'object' && module.exports) {
		module.exports = factory();
		return;
	}
	root.LogViewUniversalDetailPane = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function createLogDetailPaneModule() {
	function sizeLabel(size) {
		return size >= 1024 ? `${(size / 1024).toFixed(1)} KB` : `${size} B`;
	}

	function logTitle(log, suffix = '') {
		const base = `${log.timestamp}  ${log.priority}  ${(log.tag || '').trim()}  ${log.pkg || ''}  pid=${log.pid || ''}`;
		return suffix ? `${base}  · ${suffix}` : base;
	}

	function selectVisibleEntry({ renderedEntries, viewport }, bufIdx) {
		for (const item of renderedEntries.values()) {
			item.el.classList.remove('selected');
		}
		viewport.querySelectorAll('entry.selected').forEach(entry => entry.classList.remove('selected'));
		if (bufIdx == null) return;
		const visibleEntry = viewport.querySelector(`entry[data-buf-idx="${bufIdx}"]`);
		if (visibleEntry) visibleEntry.classList.add('selected');
	}

	function createLogDetailPane(host) {
		let activeDetailText = '';
		let selectedBufIdx = null;

		function showBinaryDetail(blob, bufIdx) {
			const { pane, body, title } = host.elements();
			if (bufIdx != null) {
				selectedBufIdx = bufIdx;
				selectVisibleEntry(host, bufIdx);
			}

			title.textContent = `${blob.mime}  ·  ${sizeLabel(blob.size)}`;
			body.innerHTML = '';
			const dataUrl = `data:${blob.mime};base64,${host.toBase64(blob.payload, blob.enc)}`;

			if (blob.mime.startsWith('image/')) {
				const img = document.createElement('img');
				img.className = 'log-detail-img';
				img.src = dataUrl;
				body.appendChild(img);
			} else if (blob.mime.startsWith('audio/')) {
				const audio = document.createElement('audio');
				audio.controls = true;
				audio.src = dataUrl;
				body.appendChild(audio);
			} else if (blob.mime.startsWith('video/')) {
				const video = document.createElement('video');
				video.controls = true;
				video.src = dataUrl;
				video.className = 'log-detail-video';
				body.appendChild(video);
			} else {
				const paragraph = document.createElement('p');
				paragraph.textContent = `${blob.mime} — copy data URI to inspect.`;
				body.appendChild(paragraph);
			}

			activeDetailText = dataUrl;
			pane.style.display = '';
		}

		function showTextDetail(log, bufIdx) {
			const { pane, body, title } = host.elements();
			selectedBufIdx = bufIdx;
			selectVisibleEntry(host, bufIdx);
			body.innerHTML = '';

			const media = host.collectMediaBlob(host.buffer, bufIdx);
			if (media && media.payload) {
				showBinaryDetail(media, bufIdx);
				return;
			}

			const stitched = host.collectMultilineJsonBody(host.buffer, bufIdx, log);
			if (stitched) {
				let pretty;
				let parsed = true;
				try {
					pretty = JSON.stringify(JSON.parse(stitched.text), null, 2);
				} catch {
					pretty = host.softPrettyJson(stitched.text);
					parsed = false;
				}
				const suffix = parsed
					? `JSON (${stitched.lineCount} lines joined)`
					: `JSON (${stitched.lineCount} lines · best-effort, parse failed)`;
				title.textContent = logTitle(log, suffix);
				const pre = document.createElement('pre');
				pre.className = 'log-detail-json';
				pre.textContent = pretty;
				body.appendChild(pre);
				activeDetailText = pretty;
			} else {
				title.textContent = logTitle(log);
				const parts = [];
				for (const segment of host.segmentLogMessage(log.message || '')) {
					if (segment.type === 'binary') {
						parts.push(`[${segment.mime} · ${segment.size} bytes]`);
						const chip = document.createElement('span');
						chip.className = 'log-binary-chip';
						chip.dataset.blobId = host.stashBlob(segment);
						chip.textContent = `[${segment.mime} · ${(segment.size / 1024).toFixed(1)} KB · click to preview]`;
						body.appendChild(chip);
						body.appendChild(document.createElement('br'));
					} else {
						const text = segment.type === 'json' ? segment.text : segment.value;
						parts.push(text);
						const span = document.createElement('span');
						span.innerHTML = host.formatAnsiText(text);
						body.appendChild(span);
					}
				}
				activeDetailText = parts.join('');
			}

			pane.style.display = '';
		}

		function init() {
			const { pane, copyBtn, closeBtn, resize } = host.elements();

			closeBtn.addEventListener('click', () => {
				pane.style.display = 'none';
				selectedBufIdx = null;
				selectVisibleEntry(host, null);
			});

			copyBtn.addEventListener('click', () => {
				if (activeDetailText) host.copy(activeDetailText);
			});

			let dragging = false;
			let startY = 0;
			let startHeight = 0;
			resize.addEventListener('mousedown', event => {
				dragging = true;
				startY = event.clientY;
				startHeight = pane.offsetHeight;
				document.body.style.userSelect = 'none';
				event.preventDefault();
			});
			document.addEventListener('mousemove', event => {
				if (!dragging) return;
				const deltaY = startY - event.clientY;
				pane.style.height = `${Math.min(Math.max(startHeight + deltaY, 80), window.innerHeight * 0.8)}px`;
			});
			document.addEventListener('mouseup', () => {
				if (!dragging) return;
				dragging = false;
				document.body.style.userSelect = '';
			});

			host.logList.addEventListener('click', event => {
				const chip = event.target.closest('.log-binary-chip');
				if (!chip) return;
				event.preventDefault();
				event.stopPropagation();
				const blob = host.blobStore()?.get(chip.dataset.blobId);
				if (!blob) return;
				const entry = chip.closest('entry');
				const bufIdx = entry?.dataset.bufIdx != null ? parseInt(entry.dataset.bufIdx, 10) : null;
				const stitched = bufIdx != null ? host.collectMediaBlob(host.buffer, bufIdx) : null;
				showBinaryDetail(stitched || blob, bufIdx);
			});

			host.logList.addEventListener('click', event => {
				if (event.target.closest('a, .log-binary-chip')) return;
				const entry = event.target.closest('entry');
				if (!entry) return;
				const bufIdxAttr = entry.dataset.bufIdx;
				if (bufIdxAttr == null) return;
				const bufIdx = parseInt(bufIdxAttr, 10);
				const log = host.buffer[bufIdx];
				if (log) showTextDetail(log, bufIdx);
			});
		}

		return {
			init,
			showBinaryDetail,
			showTextDetail,
			selectedBufIdx: () => selectedBufIdx,
		};
	}

	return {
		createLogDetailPane,
		logTitle,
		sizeLabel,
	};
});
