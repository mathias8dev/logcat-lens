(function (root, factory) {
	if (typeof module === 'object' && module.exports) module.exports = factory();
	else root.LogViewUniversalTagControls = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
	function initTagInput(host) {
		const input = host.tagTextInput;
		const dropdown = host.tagDropdown;

		input.addEventListener('keydown', (e) => {
			const items = dropdown.querySelectorAll('.tag-item');
			const active = dropdown.querySelector('.tag-item.active');

			if (e.key === 'Enter') {
				e.preventDefault();
				const val = (active ? active.textContent : input.value).trim();
				if (val && !host.tags.includes(val)) {
					host.tags.push(val);
					host.renderTags();
				}
				input.value = '';
				host.hideTagDropdown();
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
				host.hideTagDropdown();
			} else if (e.key === 'Backspace' && !input.value && host.tags.length) {
				host.tags.pop();
				host.activeTagGroup = null;
				host.tagGroupExpanded = false;
				host.renderTags();
			}
		});

		input.addEventListener('input', () => host.showTagDropdown(input.value));

		input.addEventListener('focus', () => {
			if (input.value) host.showTagDropdown(input.value);
		});

		document.addEventListener('click', (e) => {
			if (!input.contains(e.target) && !dropdown.contains(e.target)) {
				host.hideTagDropdown();
			}
			const menu = host.tagGroupMenu;
			if (menu && menu.style.display === 'block' && !menu.contains(e.target) && !e.target.closest('.tag-group-btn')) {
				menu.style.display = 'none';
			}
		});
	}

	function showTagDropdown(host, filter) {
		const dropdown = host.tagDropdown;
		const query = (filter || '').toLowerCase();
		if (!query) { host.hideTagDropdown(); return; }

		const filtered = [...host.knownTags]
			.filter(t => t.toLowerCase().includes(query) && !host.tags.includes(t))
			.sort()
			.slice(0, 50);

		if (!filtered.length) { host.hideTagDropdown(); return; }

		dropdown.innerHTML = filtered.map(t =>
			`<div class="tag-item" onmousedown="${host.handle}.selectTag('${t.replace(/'/g, "\\'")}')">${t}</div>`
		).join('');
		dropdown.style.display = 'block';
	}

	function selectTag(host, tag) {
		if (!host.tags.includes(tag)) {
			host.tags.push(tag);
			host.activeTagGroup = null;
			host.tagGroupExpanded = false;
			host.renderTags();
		}
		host.tagTextInput.value = '';
		host.hideTagDropdown();
	}

	function hideTagDropdown(host) {
		host.tagDropdown.style.display = 'none';
	}

	function renderTags(host) {
		if (host.activeTagGroup && !host.tagGroupExpanded) {
			host.tagChips.innerHTML = `<span class="tag-chip tag-group-active">
				<span class="tag-group-name" onclick="${host.handle}.toggleTagGroupExpand()">${host.activeTagGroup} (${host.tags.length})</span>
				<span class="tag-remove" onclick="${host.handle}.clearActiveTagGroup()">\u00d7</span>
			</span>`;
		} else {
			let prefix = '';
			if (host.activeTagGroup && host.tagGroupExpanded) {
				prefix = `<span class="tag-chip tag-group-active">
					<span class="tag-group-name" onclick="${host.handle}.toggleTagGroupExpand()">${host.activeTagGroup} ▾</span>
				</span>`;
			}
			host.tagChips.innerHTML = prefix + host.tags.map((t, i) =>
				`<span class="tag-chip">${t}<span class="tag-remove" onclick="${host.handle}.removeTag(${i})">\u00d7</span></span>`
			).join('');
		}
		host.rebuildFilteredIndices();
	}

	function removeTag(host, index) {
		host.tags.splice(index, 1);
		host.activeTagGroup = null;
		host.tagGroupExpanded = false;
		host.renderTags();
	}

	function toggleTagGroupExpand(host) {
		host.tagGroupExpanded = !host.tagGroupExpanded;
		host.renderTags();
	}

	function clearActiveTagGroup(host) {
		host.tags = [];
		host.activeTagGroup = null;
		host.tagGroupExpanded = false;
		host.renderTags();
	}

	function showTagGroupMenu(host) {
		const menu = host.tagGroupMenu;
		if (menu.style.display === 'block') { menu.style.display = 'none'; return; }

		const names = Object.keys(host.tagGroups);
		let html = '';
		if (host.tags.length > 0) {
			html += `<div class="tag-group-save">
				<span class="tag-group-save-label">Save current tags as group</span>
				<input type="text" id="tag-group-name-input" placeholder="Enter group name..." oninput="${host.handle}._updateSaveBtn()">
				<button id="tag-group-save-btn" onclick="${host.handle}.saveCurrentTagGroup()" disabled>Save Group</button>
			</div>`;
		}
		if (names.length) {
			html += '<div class="tag-group-list-header">Saved Groups</div><div class="tag-group-list">';
			names.forEach(name => {
				const tags = host.tagGroups[name];
				const esc = name.replace(/'/g, "\\'");
				html += `<div class="tag-group-item">
					<div class="tag-group-item-info" onclick="${host.handle}.loadTagGroup('${esc}')">
						<span class="tag-group-item-name">${name}</span>
						<span class="tag-group-item-tags">${tags.join(', ')}</span>
					</div>
					<span class="tag-group-item-delete" onclick="${host.handle}.deleteTagGroup('${esc}')" title="Delete group">&times;</span>
				</div>`;
			});
			html += '</div>';
		} else if (host.tags.length === 0) {
			html += '<div class="tag-group-empty">Add tags first, then save as a group</div>';
		}
		menu.innerHTML = html;
		menu.style.display = 'block';
		const input = host.querySelector('#tag-group-name-input');
		if (input) setTimeout(() => input.focus(), 50);
	}

	function updateSaveBtn(host) {
		const input = host.querySelector('#tag-group-name-input');
		const btn = host.querySelector('#tag-group-save-btn');
		if (btn) btn.disabled = !input?.value?.trim();
	}

	function saveCurrentTagGroup(host, UI_MESSAGES) {
		const input = host.querySelector('#tag-group-name-input');
		const name = input?.value?.trim();
		if (!name || !host.tags.length) return;
		host.postMessage({ type: UI_MESSAGES.SAVE_TAG_GROUP, data: { name, tags: [...host.tags] } });
		host.activeTagGroup = name;
		host.tagGroupExpanded = false;
		host.renderTags();
		host.tagGroupMenu.style.display = 'none';
	}

	function loadTagGroup(host, name) {
		const group = host.tagGroups[name];
		if (!group) return;
		host.tags = [...group];
		host.activeTagGroup = name;
		host.tagGroupExpanded = false;
		host.renderTags();
		host.tagGroupMenu.style.display = 'none';
	}

	function deleteTagGroup(host, UI_MESSAGES, name) {
		host.postMessage({ type: UI_MESSAGES.DELETE_TAG_GROUP, data: { name } });
	}

	return {
		clearActiveTagGroup,
		deleteTagGroup,
		hideTagDropdown,
		initTagInput,
		loadTagGroup,
		removeTag,
		renderTags,
		saveCurrentTagGroup,
		selectTag,
		showTagDropdown,
		showTagGroupMenu,
		toggleTagGroupExpand,
		updateSaveBtn,
	};
});
