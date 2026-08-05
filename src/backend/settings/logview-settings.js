const SETTINGS_SECTION = 'logviewUniversal';
const LEGACY_SETTINGS_SECTION = 'logcatLens';

function configuration(workspace, section = SETTINGS_SECTION) {
	return workspace.getConfiguration(section);
}

function configuredAdbPath(workspace) {
	const configured = configuration(workspace).get('adbPath');
	if (configured) return configured;
	return configuration(workspace, LEGACY_SETTINGS_SECTION).get('adbPath');
}

function savedTagGroups(workspace) {
	return {
		...configuration(workspace, LEGACY_SETTINGS_SECTION).get('tagGroups', {}),
		...configuration(workspace).get('tagGroups', {}),
	};
}

function stripAnsiOnExport(workspace) {
	return configuration(workspace).get('stripAnsiOnExport', true);
}

async function updateAdbPath(workspace, target, adbPath) {
	await configuration(workspace).update('adbPath', adbPath, target);
}

async function saveTagGroup(workspace, target, name, tags) {
	const groups = savedTagGroups(workspace);
	groups[name] = tags;
	await configuration(workspace).update('tagGroups', groups, target);
	return groups;
}

async function deleteTagGroup(workspace, target, name) {
	const groups = savedTagGroups(workspace);
	delete groups[name];
	await configuration(workspace).update('tagGroups', groups, target);
	await configuration(workspace, LEGACY_SETTINGS_SECTION).update('tagGroups', groups, target);
	return groups;
}

function adbPathSettingId() {
	return `${SETTINGS_SECTION}.adbPath`;
}

function affectsAdbPath(event) {
	return event.affectsConfiguration(adbPathSettingId())
		|| event.affectsConfiguration(`${LEGACY_SETTINGS_SECTION}.adbPath`);
}

module.exports = {
	LEGACY_SETTINGS_SECTION,
	SETTINGS_SECTION,
	adbPathSettingId,
	affectsAdbPath,
	configuredAdbPath,
	deleteTagGroup,
	saveTagGroup,
	savedTagGroups,
	stripAnsiOnExport,
	updateAdbPath,
};
