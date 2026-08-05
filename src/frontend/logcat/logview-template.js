(function (root, factory) {
	if (typeof module === 'object' && module.exports) module.exports = factory();
	else root.LogViewUniversalTemplate = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
	function renderLogViewTemplate({ handle, UI_MESSAGES }) {
		return `
			<loading id="loading-bar" class="progress" style="display: none;"></loading>

			<div id="adb-missing-overlay" class="adb-missing-overlay" style="display:none;">
				<div class="adb-missing-content">
					<div class="adb-missing-icon" aria-hidden="true"></div>
					<h3>ADB Not Found</h3>
					<p>Android Debug Bridge (ADB) is required to stream device logs.</p>
					<div class="adb-missing-actions">
						<button id="adb-install-btn" class="adb-btn primary" onclick="${handle}.postMessage({type:'${UI_MESSAGES.INSTALL_ADB}'});this.disabled=true;this.textContent='Installing...';">Install ADB</button>
						<button class="adb-btn" onclick="${handle}.postMessage({type:'${UI_MESSAGES.OPEN_ADB_DOWNLOAD}'})">Download Page</button>
						<button class="adb-btn" onclick="${handle}.postMessage({type:'${UI_MESSAGES.OPEN_ADB_SETTINGS}'})">Set Path</button>
						<button class="adb-btn" onclick="${handle}.setLogSource('ios')">Use iOS</button>
					</div>
					<p class="adb-missing-hint">Already installed? Set the path in Settings &gt; LogView Universal &gt; Adb Path</p>
				</div>
			</div>

			<sidebar>
				<button id="pause-play-button" class="ic play" data-tooltip="Pause" onclick="${handle}.togglePausePlay()" disabled></button>
				<div class="separator"></div>
				<button class="ic clear" data-tooltip="Clear Logs" onclick="${handle}.clear()"></button>
				<button class="ic scroll-top" data-tooltip="Scroll to Top" onclick="${handle}.scrollToTop()"></button>
				<button id="scroll-bottom-btn" class="ic scroll-bottom active" data-tooltip="Scroll to Bottom" onclick="${handle}.scrollToBottom()"></button>
				<button id="soft-wrap-btn" class="ic soft-wrap" data-tooltip="Soft Wrap" onclick="${handle}.toggleSoftWrap()"></button>
				<button id="view-mode-btn" class="ic view-mode" data-tooltip="Compact View" onclick="${handle}.toggleViewMode()"></button>
				<div class="separator"></div>
				<button class="ic export" data-tooltip="Export Logs" onclick="${handle}.exportLogs()"></button>
			</sidebar>

			<div class="content">
				<status-bar>
					<span id="status-text">Not Started</span>
					<button id="status-action-btn" class="ic play" data-tooltip="Start" onclick="${handle}.statusAction()"></button>
					<span id="lifecycle-status" class="lifecycle-badge" style="display:none;"></span>
					<span id="lifecycle-actions" class="lifecycle-actions" style="display:none;"></span>
				</status-bar>

				<filter-bar>
					<div class="filter-group source-group">
						<select id="log-source-select">
							<option value="android">Android</option>
							<option value="ios">iOS</option>
							<option value="debug">Debug</option>
						</select>
					</div>

					<div class="filter-group device-group">
						<select id="device-select">
							<option value="">Select a device...</option>
						</select>
						<button class="ic refresh" data-tooltip="Refresh Devices" onclick="${handle}.refreshDevices()"></button>
					</div>

					<div class="filter-group parser-group">
						<select id="parser-select">
							<option value="android-logcat">Logcat</option>
						</select>
					</div>

					<div class="filter-group tag-group">
						<div id="tag-chips" class="tag-chips"></div>
						<input type="text" id="tag-text-input" placeholder="Tags" autocomplete="off">
						<div id="tag-dropdown" class="autocomplete-dropdown" style="display:none;"></div>
						<button class="ic tag-group-btn" data-tooltip="Tag Groups" onclick="${handle}.showTagGroupMenu()"></button>
						<div id="tag-group-menu" class="tag-group-menu" style="display:none;"></div>
					</div>

					<div class="filter-group package-group">
						<div class="pkg-chips-scroll"><div id="package-chips" class="tag-chips"></div></div>
						<input type="text" id="package-input" placeholder="Package" autocomplete="off">
						<div id="package-dropdown" class="autocomplete-dropdown" style="display:none;"></div>
					</div>

					<div id="level-chips" class="level-chips"></div>

					<div class="filter-group search-group">
						<input type="search" id="search-input" onsearch="${handle}.search('next')" placeholder="Search logs...">
						<span id="search-matches"></span>
						<button id="prev-button" class="ic arrow-up" disabled title="Previous" onclick="${handle}.search('prev')"></button>
						<button id="next-button" class="ic arrow-down" disabled title="Next" onclick="${handle}.search('next')"></button>
						<button id="search-filter-btn" class="ic search-filter" data-tooltip="Filter by Search" onclick="${handle}.toggleSearchFilter()"></button>
					</div>
				</filter-bar>

				<column-header id="col-header">
					<span class="col col-timestamp" data-col="timestamp">Timestamp<span class="col-resize" data-col="timestamp"></span></span>
					<span class="col col-tag" data-col="tag"><span id="tag-column-title">Tag</span><span class="col-resize" data-col="tag"></span></span>
					<span class="col col-pkg" data-col="pkg"><span id="pkg-column-title">Package</span><span class="col-resize" data-col="pkg"></span></span>
					<span class="col col-pid" data-col="pid">PID<span class="col-resize" data-col="pid"></span></span>
					<span class="col col-badge" data-col="badge">Lvl<span class="col-resize" data-col="badge"></span></span>
					<span class="col col-message">Message</span>
				</column-header>

				<div id="pause-banner" class="pause-banner" style="display:none;">Logcat is paused</div>
				<div class="log-body">
					<main id="log-list" ondblclick="${handle}.copyLogLine(event)">
						<div id="viewport"></div>
					</main>

					<div id="log-detail-pane" class="log-detail-pane" style="display:none;">
						<div id="log-detail-resize" class="log-detail-resize" title="Drag to resize"></div>
						<div class="log-detail-header">
							<span id="log-detail-title">Details</span>
							<button id="log-detail-copy" class="log-detail-btn ic-only copy" data-tooltip="Copy" title="Copy" aria-label="Copy"></button>
							<button id="log-detail-close" class="log-detail-btn ic-only close" data-tooltip="Close" title="Close" aria-label="Close"></button>
						</div>
						<div id="log-detail-body" class="log-detail-body"></div>
					</div>
				</div>
			</div>

		`;
	}

	return {
		renderLogViewTemplate,
	};
});
