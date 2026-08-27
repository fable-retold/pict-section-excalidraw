/**
 * PictView-Excalidraw-React — React-mount embedding of Excalidraw.
 *
 * Mirrors the pict-section-code <-> CodeJar pattern: a wrapper script is loaded
 * via <script> tag in the HTML shell that puts React, ReactDOM, and Excalidraw
 * on the window as PictSectionExcalidrawVendor.  This view picks those up at
 * onAfterInitialRender, calls ReactDOM.createRoot on the destination div, and
 * mounts <Excalidraw> with our merged props.
 *
 * Lifecycle:
 *   onBeforeInitialize  -> seed instance fields
 *   onAfterRender       -> inject CSS, run initial-render hook once
 *   onAfterInitialRender-> resolve vendor globals, mount root, fire OnLoad
 *   destroy             -> unmount root, drop references
 *
 * AppData binding mirrors pict-section-code: if DrawingDataAddress is set we
 * read it on load and write it on change (via the OnChange throttle).
 */

const libPictViewClass = require('pict-view');
const _DefaultConfiguration = require('../Pict-Section-Excalidraw-DefaultConfiguration.js');
const { buildFormFactorResolver } = require('../utils/Excalidraw-Form-Factor.js');

class PictViewExcalidrawReact extends libPictViewClass
{
	constructor(pFable, pOptions, pServiceHash)
	{
		let tmpOptions = Object.assign({}, _DefaultConfiguration, pOptions);
		super(pFable, tmpOptions, pServiceHash);

		this.initialRenderComplete = false;

		// Vendor globals are resolved lazily on first render so the consumer
		// can either load them via a <script> tag (preferred) or hand them in
		// explicitly via connectExcalidrawGlobal().
		this._vendor = null;

		// React root + the live Excalidraw API handle, both populated on mount.
		this._reactRoot       = null;
		this._excalidrawAPI   = null;
		this.targetElement    = false;
		this._wrapElement     = null;
		this._mountElement    = null;
		this._statusElement   = null;

		// Throttle bookkeeping for the OnChange callback.
		this._onChangeThrottleHandle = null;
		this._lastSeenChangeSnapshot = null;

		// Set when InitialData isn't directly available and we want OnLoad
		// to fire once the excalidrawAPI callback runs.
		this._pendingDeferredLoad = false;

		// Set true by destroy(); gates public methods that touch DOM/React.
		this._destroyed = false;

		// Current theme mirror.  Updated by setTheme() so re-mounts on resize
		// pick the most recent value rather than the original option.
		this._currentTheme = this.options.Theme || 'light';
	}

	onBeforeInitialize()
	{
		super.onBeforeInitialize();
		return super.onBeforeInitialize();
	}

	/**
	 * Connect the vendor globals explicitly.  If not called, the view will
	 * look for window.PictSectionExcalidrawVendor at first render.
	 *
	 * @param {{ React: any, ReactDOM: any, Excalidraw: any,
	 *           exportToSvg?: Function, exportToBlob?: Function,
	 *           serializeAsJSON?: Function }} pVendor
	 */
	connectExcalidrawGlobal(pVendor)
	{
		if (pVendor && pVendor.Excalidraw && pVendor.React && pVendor.ReactDOM)
		{
			this._vendor = pVendor;
			return true;
		}
		return false;
	}

	_resolveVendor()
	{
		if (this._vendor) return this._vendor;
		if (typeof window !== 'undefined' && window.PictSectionExcalidrawVendor)
		{
			let tmpV = window.PictSectionExcalidrawVendor;
			if (tmpV.Excalidraw && tmpV.React && tmpV.ReactDOM)
			{
				this._vendor = tmpV;
				return tmpV;
			}
		}
		return null;
	}

	onAfterRender(pRenderable, pAddress, pRecord, pContent)
	{
		this.pict.CSSMap.injectCSS();

		if (!this.initialRenderComplete)
		{
			this.onAfterInitialRender();
			this.initialRenderComplete = true;
		}

		return super.onAfterRender(pRenderable, pAddress, pRecord, pContent);
	}

	onAfterInitialRender()
	{
		// Locate the container.  We expect the consumer to have placed a div
		// at TargetElementAddress that we own from here on.
		let tmpTargetSet = this.pict.ContentAssignment.getElement(this.options.TargetElementAddress);
		if (!tmpTargetSet || tmpTargetSet.length < 1)
		{
			this.log.error(`PICT-Excalidraw could not find target element [${this.options.TargetElementAddress}].`);
			return false;
		}
		this.targetElement = tmpTargetSet[0];

		this._buildContainerDOM();

		let tmpVendor = this._resolveVendor();
		if (tmpVendor)
		{
			this._mountReact(tmpVendor);
			return;
		}

		// No vendor globals on the page yet.  If lazy-load URLs are configured,
		// inject the scripts on demand; otherwise fail loudly with a status
		// message and a console error so the developer knows what's missing.
		if (this.options.LazyLoadWrapperURL)
		{
			this._renderStatus('Loading Excalidraw…', /* isError */ false);
			this._lazyLoadVendor().then(() =>
			{
				if (this._destroyed) return;
				let tmpReVendor = this._resolveVendor();
				if (tmpReVendor)
				{
					this._mountReact(tmpReVendor);
				}
				else
				{
					this._renderStatus(
						'Excalidraw failed to lazy-load.  Check the network tab for ' +
						'<code>excalidraw-wrapper.min.js</code>.',
						/* isError */ true
					);
				}
			}).catch((pErr) =>
			{
				this.log.error(`PICT-Excalidraw lazy-load failed: ${pErr && pErr.message}`);
				this._renderStatus('Excalidraw lazy-load failed: <code>' +
					((pErr && pErr.message) || 'unknown error') + '</code>',
					/* isError */ true);
			});
			return;
		}

		this._renderStatus(
			'Excalidraw wrapper bundle not loaded.  Include ' +
			'<code>excalidraw-wrapper.min.js</code> via a script tag, set ' +
			'<code>LazyLoadWrapperURL</code> in the view options, or call ' +
			'<code>connectExcalidrawGlobal({React, ReactDOM, Excalidraw})</code>.',
			/* isError */ true
		);
		this.log.error('PICT-Excalidraw vendor bundle not found; cannot mount.');
		return false;
	}

	/**
	 * Inject the configured react-vendor + wrapper scripts and resolve once
	 * window.PictSectionExcalidrawVendor exists.  Idempotent — multiple
	 * views mounting at the same time share a single in-flight load.
	 */
	_lazyLoadVendor()
	{
		if (typeof window === 'undefined') return Promise.reject(new Error('no window'));

		// Already loaded (a previous view kicked it off and it finished).
		if (window.PictSectionExcalidrawVendor) return Promise.resolve();

		// Shared in-flight load.  Stash the promise on window so concurrent
		// view mounts reuse it instead of injecting duplicate <script> tags.
		if (window.__pictExcalidrawLazyLoadPromise)
		{
			return window.__pictExcalidrawLazyLoadPromise;
		}

		let tmpReactURL   = this.options.LazyLoadReactVendorURL;
		let tmpWrapperURL = this.options.LazyLoadWrapperURL;

		let tmpInjectScript = (pUrl) => new Promise((fResolve, fReject) =>
		{
			let tmpScript = document.createElement('script');
			tmpScript.src   = pUrl;
			tmpScript.async = false;
			tmpScript.onload  = () => fResolve();
			tmpScript.onerror = () => fReject(new Error('failed to load ' + pUrl));
			document.head.appendChild(tmpScript);
		});

		let tmpChain = Promise.resolve();
		if (tmpReactURL && !window.React)
		{
			tmpChain = tmpChain.then(() => tmpInjectScript(tmpReactURL));
		}
		tmpChain = tmpChain.then(() => tmpInjectScript(tmpWrapperURL));
		tmpChain = tmpChain.then(() =>
		{
			if (!window.PictSectionExcalidrawVendor)
			{
				throw new Error('wrapper loaded but window.PictSectionExcalidrawVendor was not set');
			}
		}).finally(() =>
		{
			// Clear the in-flight handle whether we succeeded or failed —
			// subsequent retries get a fresh attempt instead of latching on
			// to a rejected promise.
			window.__pictExcalidrawLazyLoadPromise = null;
		});

		window.__pictExcalidrawLazyLoadPromise = tmpChain;
		return tmpChain;
	}

	_buildContainerDOM()
	{
		this.targetElement.innerHTML = '';

		let tmpWrap = document.createElement('div');
		tmpWrap.className = 'pict-excalidraw-wrap pict-excalidraw-wrap-react';

		let tmpMount = document.createElement('div');
		tmpMount.className = 'pict-excalidraw-mount';
		tmpWrap.appendChild(tmpMount);

		let tmpStatus = document.createElement('div');
		tmpStatus.className = 'pict-excalidraw-status';
		tmpStatus.style.display = 'none';
		tmpWrap.appendChild(tmpStatus);

		this.targetElement.appendChild(tmpWrap);

		this._wrapElement   = tmpWrap;
		this._mountElement  = tmpMount;
		this._statusElement = tmpStatus;
	}

	_renderStatus(pMessageHTML, pIsError)
	{
		if (!this._statusElement) return;
		this._statusElement.style.display = 'flex';
		this._statusElement.classList.toggle('error', !!pIsError);
		this._statusElement.innerHTML = pMessageHTML;
	}

	_hideStatus()
	{
		if (!this._statusElement) return;
		this._statusElement.style.display = 'none';
	}

	/**
	 * UIOptions as handed to <Excalidraw>, with our FormFactor override folded in when one is
	 * configured.  Excalidraw deliberately excludes getFormFactor from its props memo, so passing a
	 * fresh function per render is safe.
	 *
	 * @return {Object} The UIOptions object.
	 */
	_buildUIOptions()
	{
		let tmpUIOptions = Object.assign({}, this.options.UIOptions || {});
		if (!tmpUIOptions.getFormFactor)
		{
			let tmpResolver = buildFormFactorResolver(this.options.FormFactor);
			if (tmpResolver) tmpUIOptions.getFormFactor = tmpResolver;
		}
		return tmpUIOptions;
	}

	_mountReact(pVendor)
	{
		let tmpReact     = pVendor.React;
		let tmpReactDOM  = pVendor.ReactDOM;
		let tmpExcalidraw = pVendor.Excalidraw;

		let tmpInitialData = this._resolveInitialData();

		// Resolve theme — 'auto' follows the pict theme provider if present.
		let tmpResolvedTheme = this._resolveTheme(this._currentTheme);

		let tmpProps =
		{
			initialData:     tmpInitialData,
			theme:           tmpResolvedTheme,
			langCode:        this.options.LangCode || 'en',
			viewModeEnabled: !!this.options.ViewModeEnabled,
			zenModeEnabled:  !!this.options.ZenModeEnabled,
			gridModeEnabled: !!this.options.GridModeEnabled,
			UIOptions:       this._buildUIOptions(),
			// NOTE: the public prop in @excalidraw/excalidraw is
			// `onExcalidrawAPI` (despite some older docs / community
			// wrappers referring to `excalidrawAPI`).  See
			// packages/excalidraw/index.tsx — `excalidrawAPI` is just the
			// shape of the mountPayload object passed through the context.
			onExcalidrawAPI: (pApi) =>
			{
				this._excalidrawAPI = pApi;
				// Now that the API exists, we can satisfy any deferred load.
				if (this._pendingDeferredLoad)
				{
					this._pendingDeferredLoad = false;
					this.load();
				}
			},
			onChange: (pElements, pAppState, pFiles) =>
			{
				this._handleChange(pElements, pAppState, pFiles);
			}
		};

		// Set the EXCALIDRAW_ASSET_PATH global if the bundle hasn't already.
		// Excalidraw uses this to locate fonts + locale chunks.
		if (typeof window !== 'undefined' && this.options.AssetBaseURL && !window.EXCALIDRAW_ASSET_PATH)
		{
			window.EXCALIDRAW_ASSET_PATH = this.options.AssetBaseURL;
		}

		try
		{
			this._reactRoot = tmpReactDOM.createRoot(this._mountElement);
			this._reactRoot.render(
				tmpReact.createElement(tmpExcalidraw, tmpProps)
			);
			this._hideStatus();
		}
		catch (pErr)
		{
			this.log.error(`PICT-Excalidraw mount failed: ${pErr && pErr.message}`);
			this._renderStatus('Excalidraw failed to mount: <code>' +
				(pErr && pErr.message ? pErr.message : 'unknown error') +
				'</code>', /* isError */ true);
		}
	}

	_resolveInitialData()
	{
		// 1. Explicit InitialData in options wins for the synchronous mount.
		//    OnLoad fires asynchronously and replaces the scene via setScene
		//    once it resolves.
		// 2. DrawingDataAddress in AppData is read synchronously.
		// 3. The default empty scene falls through otherwise.
		if (this.options.DrawingDataAddress)
		{
			let tmpFromAppData = this._readAppData(this.options.DrawingDataAddress);
			if (tmpFromAppData && tmpFromAppData.elements)
			{
				return tmpFromAppData;
			}
		}

		// Defer OnLoad call until after the API resolves.  We don't have a
		// scene to push synchronously here, so use the InitialData fallback.
		if (typeof this.options.OnLoad === 'function')
		{
			this._pendingDeferredLoad = true;
		}

		return this.options.InitialData ||
			{ elements: [], appState: {}, files: {} };
	}

	_resolveTheme(pTheme)
	{
		if (pTheme === 'auto')
		{
			// Try pict-section-theme's mode (if installed).  The theme
			// provider exposes a current mode via either a provider service
			// or as a CSS class on documentElement — both are tolerated.
			if (typeof document !== 'undefined' && document.documentElement)
			{
				let tmpRoot = document.documentElement;
				if (tmpRoot.classList && tmpRoot.classList.contains('theme-mode-dark'))
				{
					return 'dark';
				}
			}
			let tmpThemeProvider = this.pict && this.pict.providers && this.pict.providers.ThemeSection;
			if (tmpThemeProvider && tmpThemeProvider.getCurrentMode)
			{
				let tmpMode = tmpThemeProvider.getCurrentMode();
				if (tmpMode === 'dark') return 'dark';
				if (tmpMode === 'light') return 'light';
			}
			return 'light';
		}
		return (pTheme === 'dark') ? 'dark' : 'light';
	}

	_handleChange(pElements, pAppState, pFiles)
	{
		// Guard: if we've been torn down, drop the change on the floor.
		// React can fire onChange briefly after unmount in dev mode + once
		// or twice in production during the final flush.
		if (this._destroyed) return;

		// Excalidraw fires onChange on every pointer move.  We throttle the
		// downstream callback + AppData write so consumers see a steady,
		// reasonable rate.
		this._lastSeenChangeSnapshot = { elements: pElements, appState: pAppState, files: pFiles };

		if (this._onChangeThrottleHandle) return;

		let tmpDelay = this.options.OnChangeThrottleMs || 250;
		this._onChangeThrottleHandle = setTimeout(() =>
		{
			this._onChangeThrottleHandle = null;
			if (this._destroyed) return;
			let tmpSnap = this._lastSeenChangeSnapshot;
			if (!tmpSnap) return;

			// Write to AppData if bound
			if (this.options.DrawingDataAddress)
			{
				this._writeAppData(this.options.DrawingDataAddress, this._cloneScene(tmpSnap));
			}

			// Notify consumer
			if (typeof this.options.OnChange === 'function')
			{
				try { this.options.OnChange(this, this._cloneScene(tmpSnap)); }
				catch (pErr) { this.log.error(`PICT-Excalidraw OnChange threw: ${pErr && pErr.message}`); }
			}
		}, tmpDelay);
	}

	_cloneScene(pSnap)
	{
		// Excalidraw exposes the live arrays — we shallow-clone the shape so
		// consumers can stash a snapshot without seeing it mutate.
		return {
			elements: pSnap.elements ? pSnap.elements.slice() : [],
			appState: pSnap.appState ? Object.assign({}, pSnap.appState) : {},
			files:    pSnap.files    ? Object.assign({}, pSnap.files)    : {}
		};
	}

	_readAppData(pAddress)
	{
		if (!pAddress) return null;
		try
		{
			// Strip the AppData. prefix so the address is relative to the
			// AppData object that we (or fable.manifest) walk into.  Passing
			// "AppData.Drawing" directly with pict.AppData as base would
			// resolve to pict.AppData.AppData.Drawing, which is wrong.
			let tmpRelative = pAddress.replace(/^AppData\./, '');
			if (this.fable && this.fable.manifest && this.fable.manifest.getValueByHash)
			{
				return this.fable.manifest.getValueByHash(this.pict.AppData, tmpRelative);
			}
			let tmpParts = tmpRelative.split('.');
			let tmpCursor = this.pict.AppData;
			for (let i = 0; i < tmpParts.length; i++)
			{
				if (tmpCursor == null) return null;
				tmpCursor = tmpCursor[tmpParts[i]];
			}
			return tmpCursor;
		}
		catch (pErr)
		{
			this.log.error(`PICT-Excalidraw read AppData failed: ${pErr && pErr.message}`);
			return null;
		}
	}

	_writeAppData(pAddress, pValue)
	{
		if (!pAddress) return false;
		try
		{
			let tmpRelative = pAddress.replace(/^AppData\./, '');
			if (this.fable && this.fable.manifest && this.fable.manifest.setValueByHash)
			{
				this.fable.manifest.setValueByHash(this.pict.AppData, tmpRelative, pValue);
				return true;
			}
			let tmpParts = tmpRelative.split('.');
			let tmpCursor = this.pict.AppData;
			for (let i = 0; i < tmpParts.length - 1; i++)
			{
				if (tmpCursor[tmpParts[i]] == null) tmpCursor[tmpParts[i]] = {};
				tmpCursor = tmpCursor[tmpParts[i]];
			}
			tmpCursor[tmpParts[tmpParts.length - 1]] = pValue;
			return true;
		}
		catch (pErr)
		{
			this.log.error(`PICT-Excalidraw write AppData failed: ${pErr && pErr.message}`);
			return false;
		}
	}

	// ---- Public API ---------------------------------------------------------

	/** Return the live Excalidraw imperative API (or null if not yet mounted). */
	getApi()
	{
		return this._excalidrawAPI;
	}

	/** Return the current scene as a plain { elements, appState, files } object. */
	getScene()
	{
		if (!this._excalidrawAPI) return null;
		return {
			elements: this._excalidrawAPI.getSceneElements(),
			appState: this._excalidrawAPI.getAppState(),
			files:    this._excalidrawAPI.getFiles ? this._excalidrawAPI.getFiles() : {}
		};
	}

	/**
	 * Replace the current scene with the supplied data.  Accepts either the
	 * full { elements, appState, files } object or just an elements array.
	 */
	setScene(pSceneData)
	{
		if (!this._excalidrawAPI) return false;
		if (!pSceneData) return false;

		let tmpScene = Array.isArray(pSceneData)
			? { elements: pSceneData, appState: {}, files: {} }
			: pSceneData;

		this._excalidrawAPI.updateScene({
			elements: tmpScene.elements || [],
			appState: tmpScene.appState || {},
			collaborators: new Map()
		});
		if (tmpScene.files && this._excalidrawAPI.addFiles)
		{
			let tmpFilesArr = [];
			let tmpKeys = Object.keys(tmpScene.files);
			for (let i = 0; i < tmpKeys.length; i++) tmpFilesArr.push(tmpScene.files[tmpKeys[i]]);
			if (tmpFilesArr.length) this._excalidrawAPI.addFiles(tmpFilesArr);
		}
		return true;
	}

	/**
	 * Export the current scene as an SVGElement.  Returns a Promise.
	 *
	 * Per-export overrides accept both top-level keys (passed through to
	 * Excalidraw's exportToSvg opts) and the appState-resident export flags
	 * that Excalidraw expects to find on appState (exportEmbedScene,
	 * exportBackground, exportPadding, exportScale, exportWithDarkMode).
	 * We auto-promote the appState ones so callers can write
	 * `view.exportSvg({ exportEmbedScene: true })` without remembering
	 * which key lives where.
	 */
	exportSvg(pOpts)
	{
		let tmpVendor = this._resolveVendor();
		if (!tmpVendor || !tmpVendor.exportToSvg) return Promise.reject(new Error('exportToSvg unavailable'));
		let tmpScene = this.getScene();
		if (!tmpScene) return Promise.reject(new Error('Excalidraw not mounted'));
		let tmpOpts = pOpts || {};
		let tmpAppStateOverrides = this._promoteAppStateExportKeys(tmpOpts);
		return tmpVendor.exportToSvg(Object.assign({
			elements: tmpScene.elements,
			appState: Object.assign({}, tmpScene.appState, tmpAppStateOverrides),
			files:    tmpScene.files
		}, tmpOpts));
	}

	/** Export the current scene as a PNG blob.  Returns a Promise. */
	exportBlob(pOpts)
	{
		let tmpVendor = this._resolveVendor();
		if (!tmpVendor || !tmpVendor.exportToBlob) return Promise.reject(new Error('exportToBlob unavailable'));
		let tmpScene = this.getScene();
		if (!tmpScene) return Promise.reject(new Error('Excalidraw not mounted'));
		let tmpOpts = pOpts || {};
		let tmpAppStateOverrides = this._promoteAppStateExportKeys(tmpOpts);
		return tmpVendor.exportToBlob(Object.assign({
			elements: tmpScene.elements,
			appState: Object.assign({}, tmpScene.appState, tmpAppStateOverrides),
			files:    tmpScene.files,
			mimeType: 'image/png'
		}, tmpOpts));
	}

	/**
	 * Pull out the export-control flags that Excalidraw expects on
	 * appState and return them as a separate object.  Mutates the input
	 * to remove the promoted keys (so they don't double-apply at top level).
	 */
	_promoteAppStateExportKeys(pOpts)
	{
		let tmpKeys = [
			'exportEmbedScene', 'exportBackground', 'exportPadding',
			'exportScale', 'exportWithDarkMode'
		];
		let tmpOut = {};
		for (let i = 0; i < tmpKeys.length; i++)
		{
			if (Object.prototype.hasOwnProperty.call(pOpts, tmpKeys[i]))
			{
				tmpOut[tmpKeys[i]] = pOpts[tmpKeys[i]];
				delete pOpts[tmpKeys[i]];
			}
		}
		return tmpOut;
	}

	/**
	 * Convert a mermaid diagram source string into Excalidraw scene elements,
	 * optionally applying them to the live canvas.
	 *
	 * Uses Excalidraw's bundled @excalidraw/mermaid-to-excalidraw +
	 * convertToExcalidrawElements helpers via the wrapper bundle.
	 *
	 * @param {string} pMermaid - Mermaid source (flowchart, sequence, class, …)
	 * @param {object} [pOpts]
	 * @param {boolean} [pOpts.apply=true] - When true, replaces the current scene
	 *                                        with the converted elements via
	 *                                        setScene().  When false, just
	 *                                        returns the elements without
	 *                                        touching the canvas.
	 * @param {object}  [pOpts.mermaidOptions] - Forwarded to parseMermaidToExcalidraw
	 *                                            (e.g. { fontSize: 16 }).
	 * @returns {Promise<{elements: any[], files: object}>}
	 */
	convertMermaidToExcalidraw(pMermaid, pOpts)
	{
		let tmpOpts = pOpts || {};
		let tmpApply = (tmpOpts.apply !== false);
		let tmpVendor = this._resolveVendor();
		if (!tmpVendor || !tmpVendor.parseMermaidToExcalidraw || !tmpVendor.convertToExcalidrawElements)
		{
			return Promise.reject(new Error('mermaid helpers not available — wrapper bundle out of date?'));
		}
		return tmpVendor.parseMermaidToExcalidraw(pMermaid, tmpOpts.mermaidOptions || {}).then((pParsed) =>
		{
			let tmpSkeleton = (pParsed && pParsed.elements) || [];
			let tmpFiles    = (pParsed && pParsed.files)    || {};
			let tmpElements = tmpVendor.convertToExcalidrawElements(tmpSkeleton);
			if (tmpApply)
			{
				this.setScene({ elements: tmpElements, appState: {}, files: tmpFiles });
			}
			return { elements: tmpElements, files: tmpFiles };
		});
	}

	/** Serialize the current scene as a JSON string compatible with .excalidraw files. */
	serialize()
	{
		let tmpVendor = this._resolveVendor();
		let tmpScene = this.getScene();
		if (!tmpScene) return null;
		if (tmpVendor && tmpVendor.serializeAsJSON)
		{
			return tmpVendor.serializeAsJSON(tmpScene.elements, tmpScene.appState, tmpScene.files, 'local');
		}
		return JSON.stringify({
			type: 'excalidraw',
			version: 2,
			source: 'pict-section-excalidraw',
			elements: tmpScene.elements,
			appState: tmpScene.appState,
			files:    tmpScene.files
		});
	}

	/**
	 * Switch theme.  Accepts 'light', 'dark', or 'auto'.  Re-mounts the React
	 * tree with the new theme prop — Excalidraw doesn't expose a runtime
	 * theme switch on the API.
	 */
	setTheme(pTheme)
	{
		this._currentTheme = pTheme || 'light';
		if (this._excalidrawAPI && this._excalidrawAPI.updateScene)
		{
			let tmpResolved = this._resolveTheme(this._currentTheme);
			this._excalidrawAPI.updateScene({ appState: { theme: tmpResolved } });
		}
	}

	/** Toggle the Excalidraw view-mode flag (read-only). */
	setReadOnly(pReadOnly)
	{
		this.options.ViewModeEnabled = !!pReadOnly;
		if (this._excalidrawAPI && this._excalidrawAPI.updateScene)
		{
			this._excalidrawAPI.updateScene({ appState: { viewModeEnabled: !!pReadOnly } });
		}
	}

	/**
	 * Invoke OnLoad if registered, or read from DrawingDataAddress otherwise,
	 * and apply the result.
	 */
	load()
	{
		if (typeof this.options.OnLoad === 'function')
		{
			this.options.OnLoad(this, (pErr, pSceneData) =>
			{
				if (pErr)
				{
					this.log.error(`PICT-Excalidraw OnLoad error: ${pErr.message || pErr}`);
					return;
				}
				if (pSceneData)
				{
					this.setScene(pSceneData);
				}
			});
			return;
		}
		if (this.options.DrawingDataAddress)
		{
			let tmpScene = this._readAppData(this.options.DrawingDataAddress);
			if (tmpScene) this.setScene(tmpScene);
		}
	}

	/** Invoke OnSave with the current scene, or just write to AppData. */
	save()
	{
		let tmpScene = this.getScene();
		if (!tmpScene) return;
		if (typeof this.options.OnSave === 'function')
		{
			this.options.OnSave(this, tmpScene, (pErr) =>
			{
				if (pErr) this.log.error(`PICT-Excalidraw OnSave error: ${pErr.message || pErr}`);
			});
			return;
		}
		if (this.options.DrawingDataAddress)
		{
			this._writeAppData(this.options.DrawingDataAddress, this._cloneScene(tmpScene));
		}
	}

	/**
	 * Tear down React root + flush pending throttles + clear the destination
	 * DOM.  Idempotent — safe to call twice.  After destroy(), public API
	 * methods that touch DOM/React (getScene, setScene, exportSvg, save,
	 * load, setTheme, setReadOnly) become no-ops via the _destroyed gate.
	 */
	destroy()
	{
		if (this._destroyed) return;
		this._destroyed = true;

		if (this._onChangeThrottleHandle)
		{
			clearTimeout(this._onChangeThrottleHandle);
			this._onChangeThrottleHandle = null;
		}
		this._lastSeenChangeSnapshot = null;
		this._pendingDeferredLoad = false;

		if (this._reactRoot)
		{
			try { this._reactRoot.unmount(); }
			catch (pErr) { this.log.error(`PICT-Excalidraw unmount failed: ${pErr && pErr.message}`); }
			this._reactRoot = null;
		}

		// Clear the destination so a subsequent re-render starts clean.  We
		// own the contents of targetElement from onAfterInitialRender on.
		if (this.targetElement && this.targetElement.innerHTML !== undefined)
		{
			try { this.targetElement.innerHTML = ''; }
			catch (pErr) { /* ignore */ }
		}

		this._excalidrawAPI = null;
		this._wrapElement   = null;
		this._mountElement  = null;
		this._statusElement = null;
		this.targetElement  = false;
		this._vendor        = null;
		this.initialRenderComplete = false;
	}

	/** Whether destroy() has been called. */
	isDestroyed()
	{
		return !!this._destroyed;
	}
}

module.exports = PictViewExcalidrawReact;
module.exports.default_configuration = _DefaultConfiguration;
