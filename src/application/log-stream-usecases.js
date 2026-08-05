async function startLogStream({ registry, state, source, data }) {
	state.activeSource = source;
	state.paused = false;
	registry.stopInactive(source);
	await registry.service(source).start(data);
}

async function restartLogStream({ registry, state, source, data }) {
	state.activeSource = source;
	state.paused = false;
	registry.stopInactive(source);
	await registry.service(source).restart(data);
}

function stopLogStream({ registry, state, source }) {
	registry.service(source).stop();
	state.paused = false;
}

function clearLogStream({ registry, source }) {
	registry.service(source).clear();
}

module.exports = {
	clearLogStream,
	restartLogStream,
	startLogStream,
	stopLogStream,
};
