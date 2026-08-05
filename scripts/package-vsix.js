#!/usr/bin/env node

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const packageJsonPath = path.join(repoRoot, 'package.json');
const TIMESTAMP_PART_LENGTH = 2;

function main() {
	const options = packageOptions(process.argv.slice(2));
	if (options.help) {
		printHelp();
		return;
	}

	const manifest = readManifest();
	const artifactVersion = artifactVersionFor(manifest.version, options.mode);
	const packageDisplayName = packageDisplayNameFor(manifest.displayName, options.mode);
	const out = options.out
		? path.resolve(repoRoot, options.out)
		: path.join(repoRoot, `${manifest.name}-${artifactVersion}.vsix`);

	withPackagedManifest({ version: artifactVersion, displayName: packageDisplayName }, () => packageVsix(out));
	if (options.createTag) {
		createGitTag(`v${artifactVersion}`);
	}
}

function packageOptions(args) {
	let mode = 'timestamped';
	let createTag = false;
	let help = false;
	let out = '';

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if ((arg === '--help' || arg === '-h') && !help) {
			help = true;
			continue;
		}
		if (isPackageMode(arg) && mode === 'timestamped') {
			mode = arg;
			continue;
		}
		if (arg === '--tag' && !createTag) {
			createTag = true;
			continue;
		}
		if (arg === '--out' && !out) {
			const value = args[index + 1];
			if (!value) {
				throw new Error('Missing value for --out.');
			}
			out = value;
			index += 1;
			continue;
		}
		throw new Error('Usage: npm run vsix -- [experimental|release] [--tag] [--out <file>] [--help]');
	}

	return { mode, createTag, help, out };
}

function isPackageMode(value) {
	return value === 'experimental' || value === 'release';
}

function artifactVersionFor(baseVersion, mode, date = new Date()) {
	if (mode === 'release') {
		return baseVersion;
	}

	const suffix = timestampSuffix(date);
	return mode === 'experimental'
		? `${baseVersion}-experimental-${suffix}`
		: `${baseVersion}-${suffix}`;
}

function packageDisplayNameFor(baseDisplayName, mode) {
	return mode === 'experimental'
		? `${baseDisplayName} Experimental`
		: baseDisplayName;
}

function printHelp() {
	process.stdout.write(`Usage:
  npm run vsix -- [experimental|release] [--tag] [--out <file>]

Modes:
  default        Package to logcat-universal-<current>-YYYYMMDDhhmmss.vsix.
  experimental  Package to logcat-universal-<current>-experimental-YYYYMMDDhhmmss.vsix and display name "Logcat Universal Experimental".
  release       Package with the current package.json version unchanged.

Options:
  --tag          After a successful package, create git tag v<artifact-version>.
  --out <file>   Write the VSIX to a specific file path.
  -h, --help     Show this help.
`);
}

function timestampSuffix(date) {
	const pad = (value) => value.toString().padStart(TIMESTAMP_PART_LENGTH, '0');
	return [
		date.getFullYear().toString(),
		pad(date.getMonth() + 1),
		pad(date.getDate()),
		pad(date.getHours()),
		pad(date.getMinutes()),
		pad(date.getSeconds()),
	].join('');
}

function packageVsix(out) {
	fs.mkdirSync(path.dirname(out), { recursive: true });

	const command = process.env.LOGCAT_LENS_VSCE_CLI;
	const args = [
		'package',
		'--no-dependencies',
		'--allow-missing-repository',
		'--no-rewrite-relative-links',
		'--out',
		out,
	];

	if (command) {
		const invocation = executableInvocation(command, args);
		childProcess.execFileSync(invocation.command, invocation.args, {
			cwd: repoRoot,
			stdio: 'inherit',
		});
		return;
	}

	childProcess.execFileSync(process.execPath, [vsceCliPath(), ...args], {
		cwd: repoRoot,
		stdio: 'inherit',
	});
}

function executableInvocation(command, args) {
	return path.extname(command).toLowerCase() === '.js'
		? { command: process.execPath, args: [command, ...args] }
		: { command, args };
}

function withPackagedManifest(overrides, run) {
	const originalPackageJson = fs.readFileSync(packageJsonPath, 'utf8');
	try {
		const packageJson = parseManifestRecord(originalPackageJson);
		fs.writeFileSync(packageJsonPath, `${JSON.stringify({ ...packageJson, ...overrides }, null, 2)}\n`);
		run();
	} finally {
		fs.writeFileSync(packageJsonPath, originalPackageJson);
	}
}

function vsceCliPath() {
	return require.resolve('@vscode/vsce/vsce');
}

function createGitTag(tagName) {
	childProcess.execFileSync(gitCliPath(), ['tag', tagName], {
		cwd: repoRoot,
		stdio: 'inherit',
	});
}

function gitCliPath() {
	return process.env.LOGCAT_LENS_GIT_CLI || 'git';
}

function readManifest() {
	const value = parseManifestRecord(fs.readFileSync(packageJsonPath, 'utf8'));
	if (typeof value.name !== 'string' || typeof value.displayName !== 'string' || typeof value.version !== 'string') {
		throw new Error('package.json must contain string name, displayName, and version fields.');
	}

	return {
		name: value.name,
		displayName: value.displayName,
		version: value.version,
	};
}

function parseManifestRecord(raw) {
	const value = JSON.parse(raw);
	if (!isRecord(value)) {
		throw new Error('package.json must contain a JSON object.');
	}
	return value;
}

function isRecord(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

if (require.main === module) {
	try {
		main();
	} catch (error) {
		console.error(error);
		process.exitCode = 1;
	}
}

module.exports = {
	artifactVersionFor,
	executableInvocation,
	packageDisplayNameFor,
	packageOptions,
	timestampSuffix,
};
