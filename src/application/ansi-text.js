const ANSI_PATTERN = /(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/g;

function stripAnsi(value) {
	return String(value ?? '').replace(ANSI_PATTERN, '');
}

module.exports = {
	stripAnsi,
};
