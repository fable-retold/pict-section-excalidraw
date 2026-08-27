/**
 * excalidraw-iframe-host.js — runs inside the iframe.  Talks postMessage to
 * the parent PictView-Excalidraw-Iframe instance.
 *
 * Loaded after excalidraw-wrapper.min.js, so window.PictSectionExcalidrawVendor
 * is already populated with { React, ReactDOM, Excalidraw, exportToSvg, ... }.
 *
 * This file is plain ES5-ish so it doesn't need a build step of its own — the
 * vendor bundle next to it carries the React/Excalidraw payload.
 */

(function ()
{
	if (typeof window === 'undefined') return;

	var STATUS_EL = document.getElementById('status');
	var ROOT_EL   = document.getElementById('root');

	function showStatus(pMessage)
	{
		if (!STATUS_EL) return;
		STATUS_EL.classList.remove('hidden');
		STATUS_EL.textContent = pMessage;
	}
	function hideStatus()
	{
		if (!STATUS_EL) return;
		STATUS_EL.classList.add('hidden');
	}

	function postToParent(pMessage)
	{
		if (window.parent && window.parent !== window)
		{
			window.parent.postMessage(pMessage, '*');
		}
	}

	var vendor = window.PictSectionExcalidrawVendor;
	if (!vendor || !vendor.React || !vendor.ReactDOM || !vendor.Excalidraw)
	{
		showStatus('Excalidraw wrapper bundle did not load.');
		postToParent({ type: 'pict-excalidraw:error', message: 'wrapper bundle missing' });
		return;
	}

	var React      = vendor.React;
	var ReactDOM   = vendor.ReactDOM;
	var Excalidraw = vendor.Excalidraw;

	var excalidrawAPI = null;
	var reactRoot     = null;
	var currentProps  =
	{
		initialData:     { elements: [], appState: {}, files: {} },
		theme:           'light',
		langCode:        'en',
		viewModeEnabled: false,
		zenModeEnabled:  false,
		gridModeEnabled: false,
		UIOptions:       {}
	};
	var changeThrottleHandle = null;
	var lastChangeSnapshot   = null;
	var formFactorMode       = 'auto';

	// Mirror of source/utils/Excalidraw-Form-Factor.js.  It is duplicated rather than required because
	// this file runs inside the iframe with no module loader, and because the parent can only
	// postMessage the MODE STRING (a function is not structured-cloneable).  Keep the two in step.
	//
	// Excalidraw sizes its UI from the CONTAINER's box, so a short embedded canvas reads as a phone and
	// buries the shape properties in a popover.  Returning undefined defers to Excalidraw's own answer.
	function resolveFormFactor()
	{
		var tmpMode = (typeof formFactorMode === 'string') ? formFactorMode.toLowerCase() : 'auto';
		if (tmpMode === 'pointer')
		{
			var tmpCoarse = false;
			try { tmpCoarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); }
			catch (pErr) { tmpCoarse = false; }
			return tmpCoarse ? undefined : 'desktop';
		}
		if (tmpMode === 'desktop' || tmpMode === 'tablet' || tmpMode === 'phone')
		{
			return tmpMode;
		}
		return undefined;
	}

	function buildUIOptions()
	{
		var tmpUIOptions = Object.assign({}, currentProps.UIOptions || {});
		if (!tmpUIOptions.getFormFactor && (formFactorMode !== 'auto'))
		{
			tmpUIOptions.getFormFactor = resolveFormFactor;
		}
		return tmpUIOptions;
	}

	function applyThemeTokens(pTokens)
	{
		if (!pTokens) return;
		var tmpRoot = document.documentElement;
		var tmpKeys = Object.keys(pTokens);
		for (var i = 0; i < tmpKeys.length; i++)
		{
			tmpRoot.style.setProperty(tmpKeys[i], pTokens[tmpKeys[i]]);
		}
	}

	function buildRender()
	{
		var tmpProps = Object.assign({}, currentProps,
		{
			// Rebuilt per render — the resolver has to be re-attached after any props merge.
			UIOptions: buildUIOptions(),
			// Public prop is onExcalidrawAPI, not excalidrawAPI (the latter
			// is just the mountPayload shape inside Excalidraw's own code).
			onExcalidrawAPI: function (pApi) { excalidrawAPI = pApi; },
			onChange: function (pElements, pAppState, pFiles)
			{
				lastChangeSnapshot =
				{
					elements: pElements,
					appState: pAppState,
					files:    pFiles
				};
				if (changeThrottleHandle) return;
				changeThrottleHandle = setTimeout(function ()
				{
					changeThrottleHandle = null;
					var tmpSnap = lastChangeSnapshot;
					if (!tmpSnap) return;
					postToParent({ type: 'pict-excalidraw:change', payload:
					{
						elements: tmpSnap.elements.slice(),
						appState: Object.assign({}, tmpSnap.appState),
						files:    Object.assign({}, tmpSnap.files)
					}});
				}, 150);
			}
		});
		return React.createElement(Excalidraw, tmpProps);
	}

	function mount()
	{
		if (!reactRoot)
		{
			reactRoot = ReactDOM.createRoot(ROOT_EL);
		}
		reactRoot.render(buildRender());
	}

	function getSceneSnapshot()
	{
		if (!excalidrawAPI) return null;
		return {
			elements: excalidrawAPI.getSceneElements(),
			appState: excalidrawAPI.getAppState(),
			files:    excalidrawAPI.getFiles ? excalidrawAPI.getFiles() : {}
		};
	}

	// Excalidraw's exportToSvg/exportToBlob read the export flags (exportEmbedScene, exportBackground,
	// exportWithDarkMode, exportScale) off `appState`, NOT off the top level of the options object.
	// Spreading the caller's options over the scene snapshot therefore dropped those flags silently — most
	// importantly `exportEmbedScene`, without which the exported SVG carries no embedded scene and cannot
	// be re-imported. Re-home the appState-level flags into appState; everything else still passes through.
	var APP_STATE_EXPORT_FLAGS = [ 'exportEmbedScene', 'exportBackground', 'exportWithDarkMode', 'exportScale' ];

	function buildExportOptions(pScene, pOpts)
	{
		var tmpOpts     = Object.assign({}, pOpts || {});
		// Caller-supplied appState wins over the live snapshot, field by field.
		var tmpAppState = Object.assign({}, pScene.appState, tmpOpts.appState || {});
		for (var i = 0; i < APP_STATE_EXPORT_FLAGS.length; i++)
		{
			var tmpFlag = APP_STATE_EXPORT_FLAGS[i];
			if (Object.prototype.hasOwnProperty.call(tmpOpts, tmpFlag))
			{
				tmpAppState[tmpFlag] = tmpOpts[tmpFlag];
				delete tmpOpts[tmpFlag];
			}
		}
		return Object.assign({
			elements: pScene.elements,
			files:    pScene.files
		}, tmpOpts, { appState: tmpAppState });
	}

	function exportSvgScene(pOpts)
	{
		if (!vendor.exportToSvg) return Promise.reject(new Error('exportToSvg unavailable'));
		var tmpScene = getSceneSnapshot();
		if (!tmpScene) return Promise.reject(new Error('Excalidraw not mounted'));
		return vendor.exportToSvg(buildExportOptions(tmpScene, pOpts)).then(function (pSvgEl)
		{
			// Serialize to a string for postMessage (SVG element is not
			// structured-cloneable).
			return new XMLSerializer().serializeToString(pSvgEl);
		});
	}

	function exportBlobScene(pOpts)
	{
		if (!vendor.exportToBlob) return Promise.reject(new Error('exportToBlob unavailable'));
		var tmpScene = getSceneSnapshot();
		if (!tmpScene) return Promise.reject(new Error('Excalidraw not mounted'));
		// mimeType stays a DEFAULT the caller can still override.
		return vendor.exportToBlob(Object.assign(
			{ mimeType: 'image/png' }, buildExportOptions(tmpScene, pOpts)));
	}

	// Seed the mount from a stored SVG when the caller passes one. Reopening a saved diagram needs the
	// scene parsed back out of its SVG, and only this side (inside the iframe) has the Excalidraw vendor
	// that can do it — the embedder cannot in iframe mode. So the caller may hand the raw SVG through as
	// `initialData.svgSource`; if it carries no elements, parse the embedded scene via loadFromBlob and
	// replace initialData BEFORE mount, so Excalidraw boots with the real scene (no setScene race). An SVG
	// with no embedded scene yields no elements and simply mounts blank, as before.
	function seedInitialDataFromSvg(fDone)
	{
		var tmpInitial = currentProps.initialData;
		var tmpSvg     = tmpInitial && tmpInitial.svgSource;
		var tmpHasElements = tmpInitial && tmpInitial.elements && tmpInitial.elements.length;
		if (!tmpSvg || tmpHasElements || !vendor.loadFromBlob || typeof Blob === 'undefined')
		{
			if (tmpInitial) { delete tmpInitial.svgSource; }
			return fDone();
		}
		var tmpSettled = false;
		var tmpFinish = function ()
		{
			if (tmpSettled) return;
			tmpSettled = true;
			if (currentProps.initialData) { delete currentProps.initialData.svgSource; }
			fDone();
		};
		try
		{
			var tmpBlob = new Blob([ tmpSvg ], { type: 'image/svg+xml' });
			Promise.resolve(vendor.loadFromBlob(tmpBlob, null, null)).then(
				function (pScene)
				{
					if (pScene && pScene.elements && pScene.elements.length)
					{
						currentProps.initialData =
						{
							elements: pScene.elements,
							appState: pScene.appState || {},
							files:    pScene.files    || {}
						};
					}
					tmpFinish();
				},
				function () { tmpFinish(); }
			);
		}
		catch (pErr)
		{
			tmpFinish();
		}
	}

	window.addEventListener('message', function (pEvent)
	{
		if (!pEvent.data || typeof pEvent.data !== 'object') return;
		var tmpData = pEvent.data;
		switch (tmpData.type)
		{
			case 'pict-excalidraw:init':
				if (tmpData.payload)
				{
					if (tmpData.payload.assetBaseURL && !window.EXCALIDRAW_ASSET_PATH)
					{
						window.EXCALIDRAW_ASSET_PATH = tmpData.payload.assetBaseURL;
					}
					if (tmpData.payload.formFactor)
					{
						formFactorMode = tmpData.payload.formFactor;
					}
					currentProps = Object.assign(currentProps, tmpData.payload);
				}
				seedInitialDataFromSvg(function ()
				{
					mount();
					hideStatus();
				});
				return;

			case 'pict-excalidraw:setScene':
				if (!excalidrawAPI || !tmpData.payload) return;
				excalidrawAPI.updateScene({
					elements: tmpData.payload.elements || [],
					appState: tmpData.payload.appState || {},
					collaborators: new Map()
				});
				if (tmpData.payload.files && excalidrawAPI.addFiles)
				{
					var tmpKeys = Object.keys(tmpData.payload.files);
					var tmpArr = [];
					for (var i = 0; i < tmpKeys.length; i++) tmpArr.push(tmpData.payload.files[tmpKeys[i]]);
					if (tmpArr.length) excalidrawAPI.addFiles(tmpArr);
				}
				return;

			case 'pict-excalidraw:setTheme':
				currentProps.theme = tmpData.payload || 'light';
				if (excalidrawAPI)
				{
					excalidrawAPI.updateScene({ appState: { theme: currentProps.theme } });
				}
				else
				{
					mount();
				}
				return;

			case 'pict-excalidraw:setReadOnly':
				currentProps.viewModeEnabled = !!tmpData.payload;
				if (excalidrawAPI)
				{
					excalidrawAPI.updateScene({ appState: { viewModeEnabled: !!tmpData.payload } });
				}
				return;

			case 'pict-excalidraw:setThemeTokens':
				applyThemeTokens(tmpData.payload);
				return;

			case 'pict-excalidraw:requestScene':
				postToParent({ type: 'pict-excalidraw:sceneReply', requestId: tmpData.requestId,
					payload: getSceneSnapshot() });
				return;

			case 'pict-excalidraw:requestSvg':
				exportSvgScene(tmpData.exportOptions || {}).then(function (pSvgString)
				{
					postToParent({ type: 'pict-excalidraw:svgReply', requestId: tmpData.requestId,
						payload: pSvgString });
				}).catch(function (pErr)
				{
					postToParent({ type: 'pict-excalidraw:error', requestId: tmpData.requestId,
						message: (pErr && pErr.message) || 'svg export failed' });
				});
				return;

			case 'pict-excalidraw:requestBlob':
				exportBlobScene(tmpData.exportOptions || {}).then(function (pBlob)
				{
					postToParent({ type: 'pict-excalidraw:blobReply', requestId: tmpData.requestId,
						payload: pBlob });
				}).catch(function (pErr)
				{
					postToParent({ type: 'pict-excalidraw:error', requestId: tmpData.requestId,
						message: (pErr && pErr.message) || 'blob export failed' });
				});
				return;

			default:
				return;
		}
	});

	// Tell the parent we're alive.  The parent will respond with an init
	// message and we'll mount then.
	postToParent({ type: 'pict-excalidraw:ready' });
})();
