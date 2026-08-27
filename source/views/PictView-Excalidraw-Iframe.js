/**
 * PictView-Excalidraw-Iframe — iframe embedding of Excalidraw.
 *
 * The destination div hosts an <iframe> pointing at our vendored
 * excalidraw-iframe-host.html.  Communication happens through window.postMessage
 * with a small protocol:
 *
 *   parent -> iframe :  { type: 'pict-excalidraw:init',  payload: { initialData, theme, langCode, viewModeEnabled, ... } }
 *   parent -> iframe :  { type: 'pict-excalidraw:setScene',  payload: { elements, appState, files } }
 *   parent -> iframe :  { type: 'pict-excalidraw:setTheme',  payload: 'light' | 'dark' }
 *   parent -> iframe :  { type: 'pict-excalidraw:setReadOnly', payload: bool }
 *   parent -> iframe :  { type: 'pict-excalidraw:setThemeTokens', payload: { '--theme-color-...': '#xxx', ... } }
 *   parent -> iframe :  { type: 'pict-excalidraw:requestScene', requestId }
 *   parent -> iframe :  { type: 'pict-excalidraw:requestSvg',   requestId, exportOptions }
 *
 *   iframe -> parent :  { type: 'pict-excalidraw:ready' }
 *   iframe -> parent :  { type: 'pict-excalidraw:change',     payload: { elements, appState, files } }
 *   iframe -> parent :  { type: 'pict-excalidraw:sceneReply', requestId, payload }
 *   iframe -> parent :  { type: 'pict-excalidraw:svgReply',   requestId, payload }
 *
 * The iframe runs the same wrapper bundle as the React-mount mode — see
 * excalidraw-iframe-host.html.
 */

const libPictViewClass = require('pict-view');
const _DefaultConfiguration = require('../Pict-Section-Excalidraw-DefaultConfiguration.js');

class PictViewExcalidrawIframe extends libPictViewClass
{
	constructor(pFable, pOptions, pServiceHash)
	{
		let tmpOptions = Object.assign({}, _DefaultConfiguration, pOptions);
		super(pFable, tmpOptions, pServiceHash);

		this.initialRenderComplete = false;
		this.targetElement = false;
		this._iframeElement = null;
		this._wrapElement   = null;
		this._statusElement = null;
		this._iframeReady   = false;

		this._pendingRequests   = Object.create(null);
		this._nextRequestId     = 1;
		this._lastSceneSnapshot = null;
		this._messageListener   = null;

		this._onChangeThrottleHandle = null;
		this._lastSeenChangeSnapshot = null;
		this._currentTheme = this.options.Theme || 'light';

		// Set true by destroy(); gates public API methods + the throttle
		// callback against post-teardown state mutations.
		this._destroyed = false;
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
		let tmpTargetSet = this.pict.ContentAssignment.getElement(this.options.TargetElementAddress);
		if (!tmpTargetSet || tmpTargetSet.length < 1)
		{
			this.log.error(`PICT-Excalidraw (iframe) could not find target [${this.options.TargetElementAddress}].`);
			return false;
		}
		this.targetElement = tmpTargetSet[0];

		this._buildContainerDOM();
		this._wireMessageListener();
		this._mountIframe();
	}

	_buildContainerDOM()
	{
		this.targetElement.innerHTML = '';

		let tmpWrap = document.createElement('div');
		tmpWrap.className = 'pict-excalidraw-wrap pict-excalidraw-wrap-iframe';

		let tmpStatus = document.createElement('div');
		tmpStatus.className = 'pict-excalidraw-status';
		tmpStatus.innerHTML = 'Loading Excalidraw…';
		tmpWrap.appendChild(tmpStatus);

		let tmpIframe = document.createElement('iframe');
		tmpIframe.className = 'pict-excalidraw-iframe';
		tmpIframe.setAttribute('title', 'Excalidraw drawing');
		tmpIframe.setAttribute('allow', 'clipboard-read; clipboard-write');
		tmpWrap.appendChild(tmpIframe);

		this.targetElement.appendChild(tmpWrap);

		this._wrapElement   = tmpWrap;
		this._iframeElement = tmpIframe;
		this._statusElement = tmpStatus;
	}

	_wireMessageListener()
	{
		// MessageEvent is one of the few cases where addEventListener is
		// legitimate — window-level events don't have an inline-handler
		// equivalent.  See pict CLAUDE.md "legitimate exceptions".
		this._messageListener = (pEvent) =>
		{
			if (!pEvent || !pEvent.data || typeof pEvent.data !== 'object') return;
			if (pEvent.source !== (this._iframeElement && this._iframeElement.contentWindow)) return;
			this._handleIframeMessage(pEvent.data);
		};
		window.addEventListener('message', this._messageListener);
	}

	_mountIframe()
	{
		let tmpUrl = this.options.IframeHostURL || './excalidraw-iframe-host.html';
		this._iframeElement.src = tmpUrl;
	}

	_postToIframe(pMessage)
	{
		if (!this._iframeElement || !this._iframeElement.contentWindow) return false;
		this._iframeElement.contentWindow.postMessage(pMessage, '*');
		return true;
	}

	_handleIframeMessage(pData)
	{
		switch (pData.type)
		{
			case 'pict-excalidraw:ready':
				this._iframeReady = true;
				if (this._statusElement) this._statusElement.style.display = 'none';
				this._sendInitMessage();
				return;

			case 'pict-excalidraw:change':
				this._handleChange(pData.payload);
				return;

			case 'pict-excalidraw:sceneReply':
			case 'pict-excalidraw:svgReply':
			case 'pict-excalidraw:blobReply':
			{
				let tmpReq = this._pendingRequests[pData.requestId];
				if (tmpReq)
				{
					clearTimeout(tmpReq.timeout);
					delete this._pendingRequests[pData.requestId];
					tmpReq.resolve(pData.payload);
				}
				return;
			}

			case 'pict-excalidraw:error':
			{
				let tmpReq = pData.requestId && this._pendingRequests[pData.requestId];
				if (tmpReq)
				{
					clearTimeout(tmpReq.timeout);
					delete this._pendingRequests[pData.requestId];
					tmpReq.reject(new Error(pData.message || 'iframe error'));
				}
				else
				{
					this.log.error(`PICT-Excalidraw (iframe) error: ${pData.message}`);
				}
				return;
			}

			default:
				// Unknown message — ignored
				return;
		}
	}

	_sendInitMessage()
	{
		let tmpInitial = this._resolveInitialData();
		this._postToIframe({
			type: 'pict-excalidraw:init',
			payload:
			{
				initialData:     tmpInitial,
				theme:           this._resolveTheme(this._currentTheme),
				langCode:        this.options.LangCode || 'en',
				viewModeEnabled: !!this.options.ViewModeEnabled,
				zenModeEnabled:  !!this.options.ZenModeEnabled,
				gridModeEnabled: !!this.options.GridModeEnabled,
				UIOptions:       this.options.UIOptions || {},
				// The MODE STRING, not a resolver: postMessage structured-clones its payload and a
				// function would throw a DataCloneError.  The host rebuilds the hook inside the frame.
				formFactor:      this.options.FormFactor || 'auto',
				assetBaseURL:    this.options.AssetBaseURL
			}
		});

		// Push theme tokens into the iframe so its CSS variables resolve.
		this._pushThemeTokens();

		// Deferred OnLoad fires now that the iframe is ready.
		if (typeof this.options.OnLoad === 'function')
		{
			this.load();
		}
	}

	_pushThemeTokens()
	{
		if (typeof document === 'undefined' || !document.documentElement) return;
		// Snapshot the theme variables off documentElement's computed style.
		// We only forward variables we know Excalidraw consumes (the bridge
		// vars baked into the wrap CSS), not the entire theme catalog.
		let tmpVars = [
			'--theme-color-background-panel',
			'--theme-color-background-primary',
			'--theme-color-background-secondary',
			'--theme-color-background-hover',
			'--theme-color-background-selected',
			'--theme-color-border-default',
			'--theme-color-border-light',
			'--theme-color-text-primary',
			'--theme-color-text-secondary',
			'--theme-color-brand-primary',
			'--theme-color-brand-primary-hover',
			'--theme-color-status-error',
			'--theme-color-shadow-color'
		];
		let tmpStyle = window.getComputedStyle(document.documentElement);
		let tmpPayload = {};
		for (let i = 0; i < tmpVars.length; i++)
		{
			let tmpVal = tmpStyle.getPropertyValue(tmpVars[i]).trim();
			if (tmpVal) tmpPayload[tmpVars[i]] = tmpVal;
		}
		this._postToIframe({ type: 'pict-excalidraw:setThemeTokens', payload: tmpPayload });
	}

	_resolveInitialData()
	{
		if (this.options.DrawingDataAddress)
		{
			let tmpFromAppData = this._readAppData(this.options.DrawingDataAddress);
			if (tmpFromAppData && tmpFromAppData.elements) return tmpFromAppData;
		}
		return this.options.InitialData || { elements: [], appState: {}, files: {} };
	}

	_resolveTheme(pTheme)
	{
		if (pTheme === 'auto')
		{
			if (typeof document !== 'undefined' && document.documentElement)
			{
				if (document.documentElement.classList && document.documentElement.classList.contains('theme-mode-dark'))
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

	_handleChange(pSnap)
	{
		if (this._destroyed) return;
		this._lastSceneSnapshot = pSnap;
		this._lastSeenChangeSnapshot = pSnap;
		if (this._onChangeThrottleHandle) return;

		let tmpDelay = this.options.OnChangeThrottleMs || 250;
		this._onChangeThrottleHandle = setTimeout(() =>
		{
			this._onChangeThrottleHandle = null;
			if (this._destroyed) return;
			let tmpFinal = this._lastSeenChangeSnapshot;
			if (!tmpFinal) return;

			if (this.options.DrawingDataAddress)
			{
				this._writeAppData(this.options.DrawingDataAddress, tmpFinal);
			}
			if (typeof this.options.OnChange === 'function')
			{
				try { this.options.OnChange(this, tmpFinal); }
				catch (pErr) { this.log.error(`PICT-Excalidraw OnChange threw: ${pErr && pErr.message}`); }
			}
		}, tmpDelay);
	}

	_readAppData(pAddress)
	{
		if (!pAddress) return null;
		try
		{
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

	_request(pType, pExtra)
	{
		let tmpId = (this._nextRequestId++);
		return new Promise((fResolve, fReject) =>
		{
			this._pendingRequests[tmpId] = { resolve: fResolve, reject: fReject };
			this._postToIframe(Object.assign({ type: pType, requestId: tmpId }, pExtra || {}));
			// Safety timeout — 30s (cleared on reply / destroy)
			this._pendingRequests[tmpId].timeout = setTimeout(() =>
			{
				if (this._pendingRequests[tmpId])
				{
					delete this._pendingRequests[tmpId];
					fReject(new Error('iframe request timed out'));
				}
			}, 30000);
		});
	}

	// ---- Public API ---------------------------------------------------------

	getApi() { return null; /* iframe mode hides the live API behind postMessage */ }

	/**
	 * Iframe mode returns the most recent change snapshot synchronously, and
	 * the live scene asynchronously via requestScene().  Most callers want the
	 * sync snapshot — for the freshest one, await requestScene().
	 */
	getScene() { return this._lastSceneSnapshot; }

	requestScene() { return this._request('pict-excalidraw:requestScene'); }

	setScene(pSceneData)
	{
		if (!pSceneData) return false;
		this._postToIframe({ type: 'pict-excalidraw:setScene', payload: pSceneData });
		return true;
	}

	exportSvg(pOpts)
	{
		return this._request('pict-excalidraw:requestSvg', { exportOptions: pOpts || {} });
	}

	exportBlob(pOpts)
	{
		return this._request('pict-excalidraw:requestBlob', { exportOptions: pOpts || {} });
	}

	serialize()
	{
		let tmpScene = this._lastSceneSnapshot;
		if (!tmpScene) return null;
		return JSON.stringify({
			type: 'excalidraw',
			version: 2,
			source: 'pict-section-excalidraw',
			elements: tmpScene.elements || [],
			appState: tmpScene.appState || {},
			files:    tmpScene.files    || {}
		});
	}

	setTheme(pTheme)
	{
		this._currentTheme = pTheme || 'light';
		let tmpResolved = this._resolveTheme(this._currentTheme);
		this._postToIframe({ type: 'pict-excalidraw:setTheme', payload: tmpResolved });
		this._pushThemeTokens();
	}

	setReadOnly(pReadOnly)
	{
		this.options.ViewModeEnabled = !!pReadOnly;
		this._postToIframe({ type: 'pict-excalidraw:setReadOnly', payload: !!pReadOnly });
	}

	load()
	{
		if (typeof this.options.OnLoad === 'function')
		{
			this.options.OnLoad(this, (pErr, pSceneData) =>
			{
				if (pErr) { this.log.error(`PICT-Excalidraw OnLoad error: ${pErr.message || pErr}`); return; }
				if (pSceneData) this.setScene(pSceneData);
			});
			return;
		}
		if (this.options.DrawingDataAddress)
		{
			let tmpScene = this._readAppData(this.options.DrawingDataAddress);
			if (tmpScene) this.setScene(tmpScene);
		}
	}

	save()
	{
		// Iframe mode: prefer the snapshot, but freshen via requestScene if we
		// don't have one yet.
		let tmpResolveAndSave = (pScene) =>
		{
			if (!pScene) return;
			if (typeof this.options.OnSave === 'function')
			{
				this.options.OnSave(this, pScene, (pErr) =>
				{
					if (pErr) this.log.error(`PICT-Excalidraw OnSave error: ${pErr.message || pErr}`);
				});
				return;
			}
			if (this.options.DrawingDataAddress)
			{
				this._writeAppData(this.options.DrawingDataAddress, pScene);
			}
		};
		if (this._lastSceneSnapshot)
		{
			tmpResolveAndSave(this._lastSceneSnapshot);
			return;
		}
		this.requestScene().then(tmpResolveAndSave).catch((pErr) =>
		{
			this.log.error(`PICT-Excalidraw save scene fetch failed: ${pErr.message || pErr}`);
		});
	}

	/**
	 * Tear down the iframe + message listener + pending request promises.
	 * Idempotent.  After destroy(), public API methods short-circuit so
	 * post-teardown calls don't crash.
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

		if (this._messageListener)
		{
			try { window.removeEventListener('message', this._messageListener); }
			catch (pErr) { /* ignore */ }
			this._messageListener = null;
		}

		// Reject any in-flight request promises so awaiters get a real
		// error instead of waiting 30s for the safety timeout.
		let tmpReqKeys = Object.keys(this._pendingRequests);
		for (let i = 0; i < tmpReqKeys.length; i++)
		{
			let tmpReq = this._pendingRequests[tmpReqKeys[i]];
			if (tmpReq && typeof tmpReq.reject === 'function')
			{
				clearTimeout(tmpReq.timeout);
					try { tmpReq.reject(new Error('view destroyed')); }
				catch (pErr) { /* ignore */ }
			}
		}
		this._pendingRequests = Object.create(null);

		// Force-stop the iframe.  Navigating to about:blank unmounts the
		// React tree inside it cleanly; just nulling our reference would
		// leave the page running until GC.
		if (this._iframeElement)
		{
			try { this._iframeElement.src = 'about:blank'; }
			catch (pErr) { /* ignore */ }
		}

		// Clear the destination DOM so a subsequent re-render starts clean.
		if (this.targetElement && this.targetElement.innerHTML !== undefined)
		{
			try { this.targetElement.innerHTML = ''; }
			catch (pErr) { /* ignore */ }
		}

		this._iframeReady = false;
		this._lastSceneSnapshot = null;
		this._iframeElement = null;
		this._statusElement = null;
		this._wrapElement = null;
		this.targetElement = false;
		this.initialRenderComplete = false;
	}

	/** Whether destroy() has been called. */
	isDestroyed()
	{
		return !!this._destroyed;
	}
}

module.exports = PictViewExcalidrawIframe;
module.exports.default_configuration = _DefaultConfiguration;
