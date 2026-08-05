const test = require('node:test');
const assert = require('node:assert/strict');

const settings = require('../src/backend/settings/logview-settings');

function workspace(initial = {}) {
	const store = new Map(Object.entries(initial).map(([section, value]) => [section, { ...value }]));
	const updates = [];

	return {
		updates,
		getConfiguration(section) {
			if (!store.has(section)) store.set(section, {});
			return {
				get(key, fallback) {
					return Object.hasOwn(store.get(section), key) ? store.get(section)[key] : fallback;
				},
				async update(key, value, target) {
					store.get(section)[key] = value;
					updates.push({ section, key, value, target });
				},
			};
		},
	};
}

test('reads new adb setting before legacy setting', () => {
	assert.equal(settings.configuredAdbPath(workspace({
		logviewUniversal: { adbPath: '/new/adb' },
		logcatLens: { adbPath: '/old/adb' },
	})), '/new/adb');

	assert.equal(settings.configuredAdbPath(workspace({
		logcatLens: { adbPath: '/old/adb' },
	})), '/old/adb');
});

test('merges legacy and new tag groups with new values taking priority', () => {
	assert.deepEqual(settings.savedTagGroups(workspace({
		logcatLens: { tagGroups: { api: ['legacy'], db: ['db'] } },
		logviewUniversal: { tagGroups: { api: ['new'] } },
	})), {
		api: ['new'],
		db: ['db'],
	});
});

test('deletes tag groups from new and legacy sections', async () => {
	const ws = workspace({
		logcatLens: { tagGroups: { api: ['legacy'], db: ['db'] } },
		logviewUniversal: { tagGroups: { api: ['new'] } },
	});

	const groups = await settings.deleteTagGroup(ws, 'global', 'api');

	assert.deepEqual(groups, { db: ['db'] });
	assert.deepEqual(ws.updates.map(update => [update.section, update.key, update.value]), [
		['logviewUniversal', 'tagGroups', { db: ['db'] }],
		['logcatLens', 'tagGroups', { db: ['db'] }],
	]);
});

test('detects adb path setting changes in current and legacy sections', () => {
	const changed = new Set(['logcatLens.adbPath']);
	const event = { affectsConfiguration: key => changed.has(key) };

	assert.equal(settings.affectsAdbPath(event), true);
	changed.clear();
	changed.add('logviewUniversal.adbPath');
	assert.equal(settings.affectsAdbPath(event), true);
	changed.clear();
	changed.add('logviewUniversal.tagGroups');
	assert.equal(settings.affectsAdbPath(event), false);
});
