#!/usr/bin/env node
/**
 * Prepare-Publish.js
 *
 * Runs automatically before `npm publish` (wired as the `prepublishOnly`
 * script in package.json).  It guarantees the tarball ships CORRECT, IN-SYNC
 * vendor artifacts — something a bare `npm publish` does NOT do on its own.
 *
 * Background — why this exists:
 *   The runtime does not load the hand-authored iframe host from
 *   source/iframe-host/.  It loads the COPIES the vendor build drops into
 *   vendor/excalidraw-built/ (consuming apps deploy that whole directory, and
 *   the iframe view fetches ./excalidraw-iframe-host.html next to it).  So the
 *   source is the thing you edit, but the vendor/excalidraw-built/ copy is the
 *   thing that actually ships and runs.  Edit the source, forget to re-run the
 *   vendor build, and `npm publish` faithfully tars up a STALE built copy —
 *   which is exactly how 1.0.4 shipped an old iframe host even though every
 *   file was "bundled."
 *
 * This script does two jobs, both cheap and safe to run on every publish:
 *
 *   1. SYNC the hand-authored iframe host into the shipped mirror.
 *      Copies source/iframe-host/excalidraw-iframe-host.{js,html} over
 *      vendor/excalidraw-built/.  This is the same copy the full vendor build
 *      performs (Build-Vendor-Bundles.js re-uses syncIframeHost() below), so
 *      the shipped copy can never drift behind the source again.
 *
 *   2. VERIFY the heavy committed bundles are present and non-trivial.
 *      excalidraw-wrapper.min.js (~8 MB), react-vendor.min.js, the CSS, the
 *      manifest, and the fonts/locales asset trees are produced by the
 *      one-time `npm run build:vendor` (which needs the yarn toolchain inside
 *      vendor/excalidraw/).  We do NOT rebuild them here — that is a heavy,
 *      occasional step gated on an Excalidraw upstream bump — but we HARD-FAIL
 *      the publish if any are missing or suspiciously small so a half-built
 *      tree can never ship.
 *
 * Run manually any time with `npm run verify:publish` (or `node
 * scripts/Prepare-Publish.js`) to dry-check the tree before publishing.
 */

const libFs   = require('fs');
const libPath = require('path');

const REPO_ROOT       = libPath.resolve(__dirname, '..');
const VENDOR_BUILT    = libPath.join(REPO_ROOT, 'vendor', 'excalidraw-built');
const IFRAME_HOST_SRC = libPath.join(REPO_ROOT, 'source', 'iframe-host');

// The hand-authored iframe host files mirrored verbatim into the shipped
// vendor/excalidraw-built/ directory.
const IFRAME_HOST_FILES =
[
	'excalidraw-iframe-host.html',
	'excalidraw-iframe-host.js'
];

// Heavy artifacts produced by `npm run build:vendor`.  We only check presence
// and a conservative minimum size — enough to catch an empty/failed/absent
// build without asserting anything about the (huge, opaque) contents.  Floors
// sit well under the real sizes (wrapper ~8.4 MB, react ~184 KB, css ~177 KB).
const REQUIRED_FILES =
[
	{ Path: 'excalidraw-wrapper.min.js', MinBytes: 1024 * 1024 },
	{ Path: 'react-vendor.min.js',       MinBytes: 50 * 1024 },
	{ Path: 'excalidraw-wrapper.css',    MinBytes: 10 * 1024 },
	{ Path: 'manifest.json',             MinBytes: 1 }
];

// Asset trees that must exist and contain at least one file.
const REQUIRED_ASSET_DIRS =
[
	'assets/fonts',
	'assets/locales'
];

function logStep(pMessage)
{
	process.stdout.write(`[prepare-publish] ${pMessage}\n`);
}

function ensureDir(pDir)
{
	libFs.mkdirSync(pDir, { recursive: true });
}

// True when the two files exist and are byte-for-byte identical.
function filesMatch(pA, pB)
{
	if (!libFs.existsSync(pA) || !libFs.existsSync(pB))
	{
		return false;
	}
	let tmpA = libFs.readFileSync(pA);
	let tmpB = libFs.readFileSync(pB);
	return tmpA.equals(tmpB);
}

/**
 * Copy source/iframe-host/* into vendor/excalidraw-built/, overwriting the
 * shipped mirror.  Returns the list of filenames that were actually stale
 * (differed before the copy) so callers can warn about an out-of-date tree.
 *
 * Exported so Build-Vendor-Bundles.js performs the identical copy — one source
 * of truth for "which iframe-host files ship and where."
 */
function syncIframeHost(pLog)
{
	let tmpLog = (typeof pLog === 'function') ? pLog : function () {};
	ensureDir(VENDOR_BUILT);

	let tmpStale = [];
	for (let i = 0; i < IFRAME_HOST_FILES.length; i++)
	{
		let tmpName = IFRAME_HOST_FILES[i];
		let tmpFrom = libPath.join(IFRAME_HOST_SRC, tmpName);
		let tmpTo   = libPath.join(VENDOR_BUILT, tmpName);

		if (!libFs.existsSync(tmpFrom))
		{
			throw new Error(`source/iframe-host/${tmpName} is missing — cannot sync the shipped iframe host.`);
		}

		if (!filesMatch(tmpFrom, tmpTo))
		{
			tmpStale.push(tmpName);
		}
		libFs.copyFileSync(tmpFrom, tmpTo);
		tmpLog(`synced iframe host: ${tmpName}`);
	}
	return tmpStale;
}

/**
 * Confirm the heavy committed bundles are present and non-trivial.  Returns an
 * array of human-readable problem strings (empty === all good).
 */
function verifyBuiltArtifacts()
{
	let tmpProblems = [];

	if (!libFs.existsSync(VENDOR_BUILT))
	{
		tmpProblems.push('vendor/excalidraw-built/ does not exist — run `npm run build:vendor`.');
		return tmpProblems;
	}

	for (let i = 0; i < REQUIRED_FILES.length; i++)
	{
		let tmpEntry = REQUIRED_FILES[i];
		let tmpFull  = libPath.join(VENDOR_BUILT, tmpEntry.Path);
		if (!libFs.existsSync(tmpFull))
		{
			tmpProblems.push(`missing vendor/excalidraw-built/${tmpEntry.Path}`);
			continue;
		}
		let tmpSize = libFs.statSync(tmpFull).size;
		if (tmpSize < tmpEntry.MinBytes)
		{
			tmpProblems.push(
				`vendor/excalidraw-built/${tmpEntry.Path} is only ${tmpSize} bytes ` +
				`(expected >= ${tmpEntry.MinBytes}) — build looks incomplete.`);
		}
	}

	for (let i = 0; i < REQUIRED_ASSET_DIRS.length; i++)
	{
		let tmpRel  = REQUIRED_ASSET_DIRS[i];
		let tmpFull = libPath.join(VENDOR_BUILT, tmpRel);
		if (!libFs.existsSync(tmpFull) || !libFs.statSync(tmpFull).isDirectory())
		{
			tmpProblems.push(`missing vendor/excalidraw-built/${tmpRel}/ asset directory`);
			continue;
		}
		if (libFs.readdirSync(tmpFull).length < 1)
		{
			tmpProblems.push(`vendor/excalidraw-built/${tmpRel}/ is empty`);
		}
	}

	// The iframe host must be present too (syncIframeHost() puts it there).
	for (let i = 0; i < IFRAME_HOST_FILES.length; i++)
	{
		let tmpFull = libPath.join(VENDOR_BUILT, IFRAME_HOST_FILES[i]);
		if (!libFs.existsSync(tmpFull))
		{
			tmpProblems.push(`missing vendor/excalidraw-built/${IFRAME_HOST_FILES[i]}`);
		}
	}

	return tmpProblems;
}

function main()
{
	logStep('syncing hand-authored iframe host into vendor/excalidraw-built/');
	let tmpStale = syncIframeHost(logStep);

	if (tmpStale.length > 0)
	{
		process.stdout.write('\n');
		logStep('NOTE: the shipped iframe host was STALE and has been refreshed from source:');
		for (let i = 0; i < tmpStale.length; i++)
		{
			logStep(`        - ${tmpStale[i]}`);
		}
		logStep('      The publish will ship the refreshed copy.  Commit vendor/excalidraw-built/');
		logStep('      so the git tree matches what was published:');
		logStep('        git add vendor/excalidraw-built/ && git commit -m "chore: refresh shipped iframe host"');
		process.stdout.write('\n');
	}

	logStep('verifying heavy vendor bundles are present');
	let tmpProblems = verifyBuiltArtifacts();
	if (tmpProblems.length > 0)
	{
		process.stderr.write('\n[prepare-publish] FAILED — the vendor build is incomplete:\n');
		for (let i = 0; i < tmpProblems.length; i++)
		{
			process.stderr.write(`  - ${tmpProblems[i]}\n`);
		}
		process.stderr.write(
			'\nThese artifacts come from the one-time heavy build:\n' +
			'  corepack enable\n' +
			'  ( cd vendor/excalidraw && yarn install && yarn build:packages )\n' +
			'  npm run build:vendor\n' +
			'Then re-run the publish.\n\n');
		process.exit(1);
	}

	logStep('OK — iframe host synced and all vendor bundles present.');
}

module.exports =
{
	syncIframeHost:        syncIframeHost,
	verifyBuiltArtifacts:  verifyBuiltArtifacts,
	VENDOR_BUILT:          VENDOR_BUILT,
	IFRAME_HOST_SRC:       IFRAME_HOST_SRC,
	IFRAME_HOST_FILES:     IFRAME_HOST_FILES
};

// Only run the gate when invoked directly (node scripts/Prepare-Publish.js or
// via the prepublishOnly hook) — not when require()'d by the vendor build.
if (require.main === module)
{
	main();
}
