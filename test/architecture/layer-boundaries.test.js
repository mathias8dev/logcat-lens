const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync, statSync } = require('node:fs');
const { join, relative } = require('node:path');

const ROOT = join(__dirname, '..', '..');

function filesUnder(relativeDir) {
	const root = join(ROOT, relativeDir);
	const files = [];

	function visit(dir) {
		for (const entry of readdirSync(dir)) {
			const path = join(dir, entry);
			if (entry === 'node_modules') continue;
			if (statSync(path).isDirectory()) visit(path);
			else files.push(path);
		}
	}

	visit(root);
	return files;
}

function readProjectFile(path) {
	return readFileSync(path, 'utf8');
}

function projectPath(path) {
	return relative(ROOT, path);
}

test('protocol layer has no backend, frontend, or vscode dependencies', () => {
	const offenders = filesUnder('src/protocol').filter(file => {
		const source = readProjectFile(file);
		return /require\(['"][^'"]*(backend|frontend)/.test(source)
			|| /from ['"][^'"]*(backend|frontend)/.test(source)
			|| /require\(['"]vscode['"]\)/.test(source);
	});

	assert.deepEqual(offenders.map(projectPath), []);
});

test('frontend layer does not import backend or vscode APIs', () => {
	const offenders = filesUnder('src/frontend').filter(file => {
		const source = readProjectFile(file);
		return /require\(['"][^'"]*backend/.test(source)
			|| /from ['"][^'"]*backend/.test(source)
			|| /require\(['"]vscode['"]\)/.test(source);
	});

	assert.deepEqual(offenders.map(projectPath), []);
});

test('application layer has no vscode or backend dependencies', () => {
	const offenders = filesUnder('src/application').filter(file => {
		const source = readProjectFile(file);
		return /require\(['"]vscode['"]\)/.test(source)
			|| /require\(['"][^'"]*backend/.test(source)
			|| /from ['"][^'"]*backend/.test(source);
	});

	assert.deepEqual(offenders.map(projectPath), []);
});

test('parser modules stay independent of vscode APIs', () => {
	const offenders = filesUnder('src/backend/parsers').filter(file => /require\(['"]vscode['"]\)/.test(readProjectFile(file)));

	assert.deepEqual(offenders.map(projectPath), []);
});

test('legacy shared contracts remains a compatibility shim', () => {
	assert.equal(readProjectFile(join(ROOT, 'src/shared/contracts.js')).trim(), "module.exports = require('../protocol/shared/contracts');");
});
