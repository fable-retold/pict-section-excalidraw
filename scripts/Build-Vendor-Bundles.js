#!/usr/bin/env node
/**
 * Build-Vendor-Bundles.js
 *
 * Produces the artifacts in vendor/excalidraw-built/ that the pict-section
 * actually ships:
 *
 *   - react-vendor.min.js          React + ReactDOM only.  Sets
 *                                  window.React + window.ReactDOM.  Apps
 *                                  that already load these globals from
 *                                  another source can skip loading this
 *                                  file entirely.
 *   - excalidraw-wrapper.min.js   Excalidraw + helpers, exposed as
 *                                  window.PictSectionExcalidrawVendor.
 *                                  Reads window.React / window.ReactDOM
 *                                  off the global scope (must be loaded
 *                                  first — either via react-vendor.min.js
 *                                  or whatever React the host already has).
 *   - excalidraw-wrapper.css       The Excalidraw stylesheet (copied from
 *                                  vendor/excalidraw/packages/excalidraw/dist/prod/index.css).
 *   - excalidraw-iframe-host.html  The iframe host page (copied verbatim).
 *   - excalidraw-iframe-host.js    The iframe-host script (copied verbatim).
 *   - assets/                      Fonts + locales (copied from
 *                                  vendor/excalidraw/packages/excalidraw/dist/prod/).
 *
 * Run with `npm run build:vendor`.  Prerequisites:
 *   1. `corepack enable` so yarn is callable.
 *   2. `cd vendor/excalidraw && yarn install`
 *   3. `cd vendor/excalidraw && yarn build:packages`
 *
 * Step 1-3 only need to run once after cloning (or after upstream-merge
 * drift).  This script does the final wrapping.
 */

const libFs   = require('fs');
const libPath = require('path');
const libEsbuild = require('esbuild');

const REPO_ROOT       = libPath.resolve(__dirname, '..');
const VENDOR_SRC      = libPath.join(REPO_ROOT, 'vendor', 'excalidraw');
const PROD_DIST       = libPath.join(VENDOR_SRC, 'packages', 'excalidraw', 'dist', 'prod');
const NODE_MODULES    = libPath.join(VENDOR_SRC, 'node_modules');
const VENDOR_BUILT    = libPath.join(REPO_ROOT, 'vendor', 'excalidraw-built');
const IFRAME_HOST_SRC = libPath.join(REPO_ROOT, 'source', 'iframe-host');

function logStep(pMessage)
{
	process.stdout.write(`[build-vendor] ${pMessage}\n`);
}

function ensureDir(pDir)
{
	libFs.mkdirSync(pDir, { recursive: true });
}

function copyDir(pSrc, pDst)
{
	ensureDir(pDst);
	let tmpEntries = libFs.readdirSync(pSrc, { withFileTypes: true });
	for (let i = 0; i < tmpEntries.length; i++)
	{
		let tmpEntry = tmpEntries[i];
		let tmpFrom  = libPath.join(pSrc, tmpEntry.name);
		let tmpTo    = libPath.join(pDst, tmpEntry.name);
		if (tmpEntry.isDirectory())
		{
			copyDir(tmpFrom, tmpTo);
		}
		else
		{
			libFs.copyFileSync(tmpFrom, tmpTo);
		}
	}
}

function copyFile(pSrc, pDst)
{
	ensureDir(libPath.dirname(pDst));
	libFs.copyFileSync(pSrc, pDst);
}

async function main()
{
	if (!libFs.existsSync(PROD_DIST))
	{
		throw new Error(
			'vendor/excalidraw/packages/excalidraw/dist/prod is missing.  ' +
			'Run `cd vendor/excalidraw && yarn install && yarn build:packages` first.'
		);
	}
	if (!libFs.existsSync(NODE_MODULES))
	{
		throw new Error('vendor/excalidraw/node_modules is missing — run yarn install first.');
	}

	logStep('preparing vendor/excalidraw-built/');
	libFs.rmSync(VENDOR_BUILT, { recursive: true, force: true });
	ensureDir(VENDOR_BUILT);

	// Shared define block — both bundles need the import.meta.env replacements
	// because esbuild can't synthesize import.meta in IIFE output.
	const _DEFINE_BLOCK =
	{
		'process.env.NODE_ENV':             '"production"',
		'import.meta.env':                   '{"MODE":"production","DEV":false,"PROD":true,"BASE_URL":"/","SSR":false}',
		'import.meta.env.MODE':              '"production"',
		'import.meta.env.DEV':               'false',
		'import.meta.env.PROD':              'true',
		'import.meta.env.BASE_URL':          '"/"',
		'import.meta.env.SSR':               'false',
		'import.meta.env.VITE_APP_DEBUG_ENABLE_TEXT_CONTAINER_BOUNDING_BOX': 'false',
		'import.meta.env.VITE_APP_PLUS_LP':                          '""',
		'import.meta.env.VITE_APP_PLUS_APP':                         '""',
		'import.meta.env.VITE_APP_AI_BACKEND':                       '""',
		'import.meta.env.VITE_APP_INCLUDE_GTAG':                     'false',
		'import.meta.env.VITE_APP_FIREBASE_CONFIG':                  '"{}"',
		'import.meta.env.VITE_APP_GIT_SHA':                          '"vendor-mirror"',
		'import.meta.url':                                           '"about:blank"'
	};

	const _SHARED_LOADER =
	{
		'.svg':   'dataurl',
		'.woff':  'file',
		'.woff2': 'file',
		'.ttf':   'file',
		'.png':   'dataurl'
	};

	// ------------------------------------------------------------------
	// Bundle 1: react-vendor.min.js
	// React + ReactDOM only, exposed as window.React + window.ReactDOM.
	// Apps that already ship React (e.g. via a different vendor bundle)
	// can omit this file entirely — the wrapper just looks for the globals
	// on window.
	// ------------------------------------------------------------------
	// react-dom/client carries createRoot/hydrateRoot; the main react-dom entry carries createPortal,
	// flushSync, and the legacy APIs. The wrapper reads ALL of these off window.ReactDOM (Excalidraw
	// mounts every dialog/modal with createPortal), so window.ReactDOM must be the union of both entries —
	// react-dom/client alone omits createPortal, which surfaces as "createPortal is not a function" the
	// first time any dialog opens, tearing the editor down. Merge them (client wins for createRoot).
	let tmpReactEntrySource =
		`import * as React from 'react';\n` +
		`import * as ReactDOM from 'react-dom';\n` +
		`import * as ReactDOMClient from 'react-dom/client';\n` +
		`const _React    = React.default    || React;\n` +
		`const _ReactDOM = Object.assign({}, ReactDOM.default || ReactDOM, ReactDOMClient.default || ReactDOMClient);\n` +
		`if (typeof window !== 'undefined') {\n` +
		`\twindow.React    = window.React    || _React;\n` +
		`\twindow.ReactDOM = window.ReactDOM || _ReactDOM;\n` +
		`}\n`;

	let tmpReactEntryPath = libPath.join(VENDOR_BUILT, '__react_entry.js');
	libFs.writeFileSync(tmpReactEntryPath, tmpReactEntrySource, 'utf8');

	logStep('bundling react-vendor.min.js via esbuild');
	await libEsbuild.build({
		entryPoints: [ tmpReactEntryPath ],
		bundle: true,
		minify: true,
		format: 'iife',
		platform: 'browser',
		target: [ 'es2020' ],
		outfile: libPath.join(VENDOR_BUILT, 'react-vendor.min.js'),
		conditions: [ 'production', 'browser', 'import', 'default' ],
		define: _DEFINE_BLOCK,
		nodePaths: [ NODE_MODULES ],
		loader: _SHARED_LOADER,
		assetNames: 'assets/[name]-[hash]',
		publicPath: './',
		logLevel: 'info',
		legalComments: 'none'
	});
	libFs.rmSync(tmpReactEntryPath);

	// ------------------------------------------------------------------
	// Bundle 2: excalidraw-wrapper.min.js
	// Excalidraw + helpers + the wrapper's public surface.  Reads React +
	// ReactDOM off window — assumes react-vendor.min.js (or equivalent)
	// has already executed.  Marks `react` / `react-dom` / `react-dom/client`
	// as external so esbuild rewrites the imports to `window.React` /
	// `window.ReactDOM`.
	// ------------------------------------------------------------------
	let tmpEntrySource =
		`// Read React + ReactDOM off the global scope.  react-vendor.min.js\n` +
		`// (or an app's own React) is expected to have set these before we run.\n` +
		`const _React    = (typeof window !== 'undefined' && window.React)    || null;\n` +
		`const _ReactDOM = (typeof window !== 'undefined' && window.ReactDOM) || null;\n` +
		`if (!_React || !_ReactDOM) {\n` +
		`\tconsole.error('[pict-section-excalidraw] React + ReactDOM globals not found. ' +\n` +
		`\t\t'Load react-vendor.min.js (or your own React) before excalidraw-wrapper.min.js.');\n` +
		`}\n` +
		`import * as ExcalidrawModule from '@excalidraw/excalidraw';\n` +
		`// parseMermaidToExcalidraw lives in a separate package — @excalidraw/excalidraw\n` +
		`// doesn't re-export it.  We pull it in directly so vendor.parseMermaidToExcalidraw\n` +
		`// resolves to a real function instead of undefined.\n` +
		`import { parseMermaidToExcalidraw as _parseMermaid } from '@excalidraw/mermaid-to-excalidraw';\n` +
		`\n` +
		`const vendor = {\n` +
		`\tReact:           _React,\n` +
		`\tReactDOM:        _ReactDOM,\n` +
		`\tExcalidraw:      ExcalidrawModule.Excalidraw,\n` +
		`\texportToSvg:     ExcalidrawModule.exportToSvg,\n` +
		`\texportToBlob:    ExcalidrawModule.exportToBlob,\n` +
		`\texportToCanvas:  ExcalidrawModule.exportToCanvas,\n` +
		`\tserializeAsJSON: ExcalidrawModule.serializeAsJSON,\n` +
		`\tloadFromBlob:    ExcalidrawModule.loadFromBlob,\n` +
		`\tloadLibraryFromBlob: ExcalidrawModule.loadLibraryFromBlob,\n` +
		`\tgetSceneVersion: ExcalidrawModule.getSceneVersion,\n` +
		`\tconvertToExcalidrawElements: ExcalidrawModule.convertToExcalidrawElements,\n` +
		`\tparseMermaidToExcalidraw:    _parseMermaid,\n` +
		`\tMIME_TYPES:      ExcalidrawModule.MIME_TYPES,\n` +
		`\tTHEME:           ExcalidrawModule.THEME,\n` +
		`\tversion:         ExcalidrawModule.version || 'unknown'\n` +
		`};\n` +
		`if (typeof window !== 'undefined') {\n` +
		`\twindow.PictSectionExcalidrawVendor = vendor;\n` +
		`}\n` +
		`export default vendor;\n`;

	let tmpEntryPath = libPath.join(VENDOR_BUILT, '__entry.js');
	libFs.writeFileSync(tmpEntryPath, tmpEntrySource, 'utf8');

	// Inline shim plugin: any react / react-dom / react-dom/client / react/jsx-runtime
	// import resolves to a tiny module that re-exports from window.React /
	// window.ReactDOM.  This keeps Excalidraw + its peer deps wired to the
	// host React without bundling a second copy.
	const reactGlobalShimPlugin =
	{
		name: 'react-global-shim',
		setup(pBuild)
		{
			pBuild.onResolve({ filter: /^(react|react-dom)(\/[^?]*)?$/ }, (pArgs) =>
			{
				return { path: pArgs.path, namespace: 'react-global-shim' };
			});
			pBuild.onLoad({ filter: /.*/, namespace: 'react-global-shim' }, (pArgs) =>
			{
				let tmpPath = pArgs.path;
				let tmpContents = '';
				if (tmpPath === 'react' || tmpPath === 'react/jsx-runtime' ||
					tmpPath === 'react/jsx-dev-runtime')
				{
					tmpContents =
						`const R = (typeof window !== "undefined" && window.React) || {};\n` +
						`export default R;\n` +
						`export const Fragment       = R.Fragment;\n` +
						`export const Component      = R.Component;\n` +
						`export const PureComponent  = R.PureComponent;\n` +
						`export const useState       = R.useState;\n` +
						`export const useEffect      = R.useEffect;\n` +
						`export const useLayoutEffect= R.useLayoutEffect;\n` +
						`export const useRef         = R.useRef;\n` +
						`export const useCallback    = R.useCallback;\n` +
						`export const useMemo        = R.useMemo;\n` +
						`export const useContext     = R.useContext;\n` +
						`export const useReducer     = R.useReducer;\n` +
						`export const useImperativeHandle = R.useImperativeHandle;\n` +
						`export const useDebugValue  = R.useDebugValue;\n` +
						`export const useId          = R.useId;\n` +
						`export const useSyncExternalStore = R.useSyncExternalStore;\n` +
						`export const useTransition  = R.useTransition;\n` +
						`export const useDeferredValue = R.useDeferredValue;\n` +
						`export const useInsertionEffect = R.useInsertionEffect;\n` +
						`export const startTransition = R.startTransition;\n` +
						`export const createContext  = R.createContext;\n` +
						`export const createElement  = R.createElement;\n` +
						`export const cloneElement   = R.cloneElement;\n` +
						`export const createRef      = R.createRef;\n` +
						`export const forwardRef     = R.forwardRef;\n` +
						`export const memo           = R.memo;\n` +
						`export const lazy           = R.lazy;\n` +
						`export const Suspense       = R.Suspense;\n` +
						`export const StrictMode     = R.StrictMode;\n` +
						`export const Children       = R.Children;\n` +
						`export const isValidElement = R.isValidElement;\n` +
						`export const version        = R.version;\n` +
						`export const jsx            = (R.jsx || R.createElement);\n` +
						`export const jsxs           = (R.jsxs || R.createElement);\n` +
						`export const jsxDEV         = (R.jsxDEV || R.jsx || R.createElement);\n`;
				}
				else if (tmpPath === 'react-dom' || tmpPath === 'react-dom/client')
				{
					// React 18 removed `unstable_batchedUpdates` from react-dom
					// (batching is automatic now), but Excalidraw still imports
					// it for back-compat.  Provide a no-op stub that just invokes
					// the supplied function — modern React batches internally
					// anyway, so behavior is preserved.
					tmpContents =
						`const RD = (typeof window !== "undefined" && window.ReactDOM) || {};\n` +
						`export default RD;\n` +
						`export const createRoot = RD.createRoot;\n` +
						`export const hydrateRoot = RD.hydrateRoot;\n` +
						`export const render = RD.render;\n` +
						`export const hydrate = RD.hydrate;\n` +
						`export const unmountComponentAtNode = RD.unmountComponentAtNode;\n` +
						`export const findDOMNode = RD.findDOMNode;\n` +
						`export const createPortal = RD.createPortal;\n` +
						`export const flushSync = RD.flushSync || function (fn) { return fn(); };\n` +
						`export const version = RD.version;\n` +
						`export const unstable_batchedUpdates = RD.unstable_batchedUpdates ||\n` +
						`\tfunction (fn, a) { return fn(a); };\n`;
				}
				else
				{
					// Unknown react/react-dom subpath — fall back to default-only
					tmpContents = `export default (typeof window !== "undefined" && (window.React || window.ReactDOM)) || {};\n`;
				}
				return { contents: tmpContents, loader: 'js' };
			});
		}
	};

	logStep('bundling excalidraw-wrapper.min.js via esbuild (React externalized to window globals)');
	await libEsbuild.build({
		entryPoints: [ tmpEntryPath ],
		bundle: true,
		minify: true,
		format: 'iife',
		platform: 'browser',
		target: [ 'es2020' ],
		outfile: libPath.join(VENDOR_BUILT, 'excalidraw-wrapper.min.js'),
		conditions: [ 'production', 'browser', 'import', 'default' ],
		define: _DEFINE_BLOCK,
		nodePaths: [ NODE_MODULES ],
		loader: _SHARED_LOADER,
		plugins: [ reactGlobalShimPlugin ],
		assetNames: 'assets/[name]-[hash]',
		publicPath: './',
		logLevel: 'info',
		legalComments: 'none'
	});

	libFs.rmSync(tmpEntryPath);

	logStep('copying excalidraw-wrapper.css');
	copyFile(libPath.join(PROD_DIST, 'index.css'),
		libPath.join(VENDOR_BUILT, 'excalidraw-wrapper.css'));

	logStep('copying iframe host page + script');
	copyFile(libPath.join(IFRAME_HOST_SRC, 'excalidraw-iframe-host.html'),
		libPath.join(VENDOR_BUILT, 'excalidraw-iframe-host.html'));
	copyFile(libPath.join(IFRAME_HOST_SRC, 'excalidraw-iframe-host.js'),
		libPath.join(VENDOR_BUILT, 'excalidraw-iframe-host.js'));

	logStep('copying fonts + locales (EXCALIDRAW_ASSET_PATH)');
	let tmpAssetSubdirs = [ 'fonts', 'locales' ];
	for (let i = 0; i < tmpAssetSubdirs.length; i++)
	{
		let tmpSrc = libPath.join(PROD_DIST, tmpAssetSubdirs[i]);
		if (libFs.existsSync(tmpSrc))
		{
			copyDir(tmpSrc, libPath.join(VENDOR_BUILT, 'assets', tmpAssetSubdirs[i]));
		}
	}
	// Excalidraw's prod build also emits top-level chunk files that the
	// runtime fetches at use-time (image-blob-reducer etc.).  Mirror them
	// alongside index.css so EXCALIDRAW_ASSET_PATH resolves them.
	let tmpProdEntries = libFs.readdirSync(PROD_DIST, { withFileTypes: true });
	for (let i = 0; i < tmpProdEntries.length; i++)
	{
		let tmpE = tmpProdEntries[i];
		if (tmpE.isFile() && /\.js$/.test(tmpE.name) && /^(chunk|subset)/.test(tmpE.name))
		{
			copyFile(libPath.join(PROD_DIST, tmpE.name),
				libPath.join(VENDOR_BUILT, 'assets', tmpE.name));
		}
	}

	logStep('writing manifest');
	libFs.writeFileSync(libPath.join(VENDOR_BUILT, 'manifest.json'),
		JSON.stringify({
			generated:   new Date().toISOString(),
			source:      'vendor/excalidraw (mirror)',
			outputs:
			[
				'react-vendor.min.js',
				'excalidraw-wrapper.min.js',
				'excalidraw-wrapper.css',
				'excalidraw-iframe-host.html',
				'excalidraw-iframe-host.js',
				'assets/'
			],
			loadOrder: 'Load react-vendor.min.js BEFORE excalidraw-wrapper.min.js. Apps already loading React + ReactDOM as window globals can omit react-vendor.min.js entirely.'
		}, null, 2), 'utf8');

	logStep('done.  artifacts in vendor/excalidraw-built/');
}

main().catch((pErr) =>
{
	process.stderr.write(`[build-vendor] FAILED: ${pErr && pErr.stack || pErr}\n`);
	process.exit(1);
});
