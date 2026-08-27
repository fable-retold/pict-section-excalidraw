/*
	Unit tests for Pict-Section-Excalidraw
*/

const libBrowserEnv = require('browser-env');
libBrowserEnv();

const Chai = require('chai');
const Expect = Chai.expect;

const libPict = require('pict');

const configureTestPict = (pPict) =>
{
	let tmpPict = (typeof (pPict) == 'undefined') ? new libPict() : pPict;
	tmpPict.TestData = (
		{
			Reads: [],
			Assignments: [],
			Appends: [],
			Gets: []
		});
	tmpPict.ContentAssignment.customReadFunction = (pAddress, pContentType) =>
	{
		tmpPict.TestData.Reads.push(pAddress);
		return '';
	};
	tmpPict.ContentAssignment.customGetElementFunction = (pAddress) =>
	{
		tmpPict.TestData.Gets.push(pAddress);
		return '';
	};
	tmpPict.ContentAssignment.customAppendElementFunction = (pAddress, pContent) =>
	{
		tmpPict.TestData.Appends.push(pAddress);
		return '';
	};
	tmpPict.ContentAssignment.customAssignFunction = (pAddress, pContent) =>
	{
		tmpPict.TestData.Assignments.push(pAddress);
		return '';
	};

	return tmpPict;
};

const libPictSectionExcalidraw = require('../source/Pict-Section-Excalidraw.js');

suite
(
	'PictSectionExcalidraw',
	() =>
	{
		setup(() => { });

		suite
		(
			'Module Exports',
			() =>
			{
				test('Main class should be exported', (fDone) =>
				{
					Expect(libPictSectionExcalidraw).to.be.a('function');
					return fDone();
				});

				test('Default configuration should be exported', (fDone) =>
				{
					Expect(libPictSectionExcalidraw.default_configuration).to.be.an('object');
					Expect(libPictSectionExcalidraw.default_configuration).to.have.property('DefaultRenderable');
					Expect(libPictSectionExcalidraw.default_configuration).to.have.property('EmbedMode');
					Expect(libPictSectionExcalidraw.default_configuration.EmbedMode).to.equal('react');
					return fDone();
				});

				test('ReactView and IframeView should be exported as named statics', (fDone) =>
				{
					Expect(libPictSectionExcalidraw.ReactView).to.be.a('function');
					Expect(libPictSectionExcalidraw.IframeView).to.be.a('function');
					return fDone();
				});

				test('selectImplementation should pick the right class for each mode', (fDone) =>
				{
					Expect(libPictSectionExcalidraw.selectImplementation({ EmbedMode: 'react' }))
						.to.equal(libPictSectionExcalidraw.ReactView);
					Expect(libPictSectionExcalidraw.selectImplementation({ EmbedMode: 'iframe' }))
						.to.equal(libPictSectionExcalidraw.IframeView);
					Expect(libPictSectionExcalidraw.selectImplementation({}))
						.to.equal(libPictSectionExcalidraw.ReactView);
					Expect(libPictSectionExcalidraw.selectImplementation({ EmbedMode: 'IFRAME' }))
						.to.equal(libPictSectionExcalidraw.IframeView);
					return fDone();
				});
			}
		);

		suite
		(
			'Configuration',
			() =>
			{
				test('DefaultConfiguration should declare load/save callback slots', (fDone) =>
				{
					let tmpCfg = libPictSectionExcalidraw.default_configuration;
					Expect(tmpCfg).to.have.property('OnLoad');
					Expect(tmpCfg).to.have.property('OnSave');
					Expect(tmpCfg).to.have.property('OnChange');
					Expect(tmpCfg).to.have.property('DrawingDataAddress');
					Expect(tmpCfg).to.have.property('Theme');
					return fDone();
				});

				test('CSS should reference pict theme tokens (var(--theme-color-*))', (fDone) =>
				{
					let tmpCSS = libPictSectionExcalidraw.default_configuration.CSS;
					Expect(tmpCSS).to.be.a('string');
					Expect(tmpCSS).to.match(/var\(--theme-color-/);
					Expect(tmpCSS).to.match(/--default-bg-color/);
					Expect(tmpCSS).to.match(/--island-bg-color/);
					return fDone();
				});

				test('Templates and Renderables should be defined', (fDone) =>
				{
					let tmpCfg = libPictSectionExcalidraw.default_configuration;
					Expect(tmpCfg.Templates).to.be.an('array');
					Expect(tmpCfg.Renderables).to.be.an('array');
					Expect(tmpCfg.Templates.length).to.be.greaterThan(0);
					Expect(tmpCfg.Renderables.length).to.be.greaterThan(0);
					return fDone();
				});
			}
		);

		suite
		(
			'Instantiation — React mode',
			() =>
			{
				test('Should instantiate and expose the public API methods', (fDone) =>
				{
					let tmpPict = configureTestPict();
					let tmpView = tmpPict.addView(
						'TestExcalidrawReact',
						{ EmbedMode: 'react', ViewIdentifier: 'TestExcalidrawReact' },
						libPictSectionExcalidraw.ReactView
					);
					Expect(tmpView).to.be.an('object');
					Expect(tmpView.getScene).to.be.a('function');
					Expect(tmpView.setScene).to.be.a('function');
					Expect(tmpView.exportSvg).to.be.a('function');
					Expect(tmpView.serialize).to.be.a('function');
					Expect(tmpView.setTheme).to.be.a('function');
					Expect(tmpView.setReadOnly).to.be.a('function');
					Expect(tmpView.load).to.be.a('function');
					Expect(tmpView.save).to.be.a('function');
					Expect(tmpView.destroy).to.be.a('function');
					return fDone();
				});

				test('connectExcalidrawGlobal should accept a vendor object and reject incomplete ones', (fDone) =>
				{
					let tmpPict = configureTestPict();
					let tmpView = tmpPict.addView(
						'TestExcalidrawReact2',
						{ EmbedMode: 'react', ViewIdentifier: 'TestExcalidrawReact2' },
						libPictSectionExcalidraw.ReactView
					);
					Expect(tmpView.connectExcalidrawGlobal({})).to.equal(false);
					Expect(tmpView.connectExcalidrawGlobal({ React: {} })).to.equal(false);
					Expect(tmpView.connectExcalidrawGlobal({ React: {}, ReactDOM: {}, Excalidraw: () => {} })).to.equal(true);
					return fDone();
				});

				test('AppData binding round-trip via fallback path resolver', (fDone) =>
				{
					let tmpPict = configureTestPict();
					tmpPict.AppData = { Scenes: { current: null } };
					let tmpView = tmpPict.addView(
						'TestExcalidrawAppData',
						{
							EmbedMode: 'react',
							ViewIdentifier: 'TestExcalidrawAppData',
							DrawingDataAddress: 'Scenes.current'
						},
						libPictSectionExcalidraw.ReactView
					);
					let tmpPayload = { elements: [{ id: '1' }], appState: {}, files: {} };
					Expect(tmpView._writeAppData('Scenes.current', tmpPayload)).to.equal(true);
					Expect(tmpView._readAppData('Scenes.current')).to.deep.equal(tmpPayload);
					return fDone();
				});
			}
		);

		suite
		(
			'Instantiation — Iframe mode',
			() =>
			{
				test('Iframe view should instantiate and expose the same public API', (fDone) =>
				{
					let tmpPict = configureTestPict();
					let tmpView = tmpPict.addView(
						'TestExcalidrawIframe',
						{ EmbedMode: 'iframe', ViewIdentifier: 'TestExcalidrawIframe' },
						libPictSectionExcalidraw.IframeView
					);
					Expect(tmpView).to.be.an('object');
					Expect(tmpView.getScene).to.be.a('function');
					Expect(tmpView.setScene).to.be.a('function');
					Expect(tmpView.exportSvg).to.be.a('function');
					Expect(tmpView.serialize).to.be.a('function');
					Expect(tmpView.setTheme).to.be.a('function');
					Expect(tmpView.setReadOnly).to.be.a('function');
					Expect(tmpView.load).to.be.a('function');
					Expect(tmpView.save).to.be.a('function');
					Expect(tmpView.destroy).to.be.a('function');
					Expect(tmpView.requestScene).to.be.a('function');
					return fDone();
				});

				test('Iframe getApi() should return null (postMessage hides it)', (fDone) =>
				{
					let tmpPict = configureTestPict();
					let tmpView = tmpPict.addView(
						'TestExcalidrawIframe2',
						{ EmbedMode: 'iframe', ViewIdentifier: 'TestExcalidrawIframe2' },
						libPictSectionExcalidraw.IframeView
					);
					Expect(tmpView.getApi()).to.equal(null);
					return fDone();
				});

					test('Iframe exportBlob() resolves when the host posts a blobReply', (fDone) =>
					{
						let tmpPict = configureTestPict();
						let tmpView = tmpPict.addView(
							'TestExcalidrawIframeBlob',
							{ EmbedMode: 'iframe', ViewIdentifier: 'TestExcalidrawIframeBlob' },
							libPictSectionExcalidraw.IframeView
						);

						let tmpFakeBlob = { __isBlob: true, size: 42 };
						let tmpPromise = tmpView.exportBlob({ mimeType: 'image/png' });

						// exportBlob() registers a pending request keyed by requestId and posts
						// requestBlob to the iframe.  Simulate the host's blobReply: before the
						// fix the parent ignored blobReply, so the promise never resolved.
						let tmpRequestIds = Object.keys(tmpView._pendingRequests);
						Expect(tmpRequestIds.length).to.equal(1);

						tmpView._handleIframeMessage(
							{
								type: 'pict-excalidraw:blobReply',
								requestId: Number(tmpRequestIds[0]),
								payload: tmpFakeBlob
							});

						tmpPromise.then((pResult) =>
						{
							Expect(pResult).to.equal(tmpFakeBlob);
							Expect(Object.keys(tmpView._pendingRequests).length).to.equal(0);
							return fDone();
						}).catch((pErr) => { return fDone(pErr); });
					});
			}
		);

		suite
		(
			'Dispatcher',
			() =>
			{
				test('Dispatcher should instantiate the React impl by default', (fDone) =>
				{
					let tmpPict = configureTestPict();
					let tmpView = tmpPict.addView(
						'TestExcalidrawDispatch',
						{ ViewIdentifier: 'TestExcalidrawDispatch' },
						libPictSectionExcalidraw
					);
					Expect(tmpView._Implementation).to.be.an('object');
					Expect(tmpView._ImplementationClass).to.equal(libPictSectionExcalidraw.ReactView);
					Expect(tmpView.getScene).to.be.a('function');
					return fDone();
				});

				test('Dispatcher should switch to iframe impl on EmbedMode: iframe', (fDone) =>
				{
					let tmpPict = configureTestPict();
					let tmpView = tmpPict.addView(
						'TestExcalidrawDispatchIframe',
						{ ViewIdentifier: 'TestExcalidrawDispatchIframe', EmbedMode: 'iframe' },
						libPictSectionExcalidraw
					);
					Expect(tmpView._ImplementationClass).to.equal(libPictSectionExcalidraw.IframeView);
					return fDone();
				});

				test('Dispatcher forwards methods to the chosen implementation', (fDone) =>
				{
					let tmpPict = configureTestPict();
					tmpPict.AppData = { Drawing: null };
					let tmpView = tmpPict.addView(
						'TestExcalidrawForward',
						{ ViewIdentifier: 'TestExcalidrawForward', DrawingDataAddress: 'Drawing' },
						libPictSectionExcalidraw
					);

					// Force a snapshot on the implementation so getScene resolves through.
					let tmpPayload = { elements: [{ id: 'a' }], appState: {}, files: {} };
					tmpView._Implementation._lastSceneSnapshot = tmpPayload; // iframe-style cache
					tmpView._Implementation._excalidrawAPI = null;            // react impl returns null here

					// React impl's getScene relies on _excalidrawAPI which is null in tests;
					// it returns null safely.  We just verify the forwarder is wired.
					Expect(tmpView.getScene).to.be.a('function');
					Expect(typeof tmpView._Implementation.getScene).to.equal('function');
					return fDone();
				});
			}
		);

		// ----------------------------------------------------------------
		// Regression suite — locks in fixes for two bugs that bit us
		// during the round-trip verification.  Both are easy to silently
		// re-introduce if the affected lines are refactored.
		// ----------------------------------------------------------------
		suite
		(
			'Regressions',
			() =>
			{
				/**
				 * Bug: pict-section-excalidraw initially used `excalidrawAPI`
				 * as the prop name when mounting <Excalidraw>.  That name is
				 * the *shape* of the API object inside Excalidraw, not the
				 * public callback prop.  The actual public prop is
				 * `onExcalidrawAPI` (see vendor/excalidraw/packages/excalidraw/
				 * index.tsx).  When wrong, Excalidraw renders fine but the
				 * API reference never reaches the consumer, so getScene /
				 * setScene / exportSvg silently no-op.  Lock the right prop
				 * name in so a refactor can't quietly undo it.
				 */
				test('React-mount mount uses onExcalidrawAPI (not excalidrawAPI) as the callback prop', (fDone) =>
				{
					let tmpPict = configureTestPict();
					let tmpView = tmpPict.addView(
						'TestExcalidrawPropName',
						{ EmbedMode: 'react', ViewIdentifier: 'TestExcalidrawPropName' },
						libPictSectionExcalidraw.ReactView
					);

					// Stub a vendor that records what props the view feeds
					// React.createElement.  We don't actually mount — we
					// just snapshot the props passed to the Excalidraw
					// component so we can assert prop-name correctness.
					let tmpCapturedProps = null;
					let tmpFakeVendor =
					{
						React:
						{
							createElement: (pComponent, pProps) =>
							{
								if (pComponent === tmpFakeVendor.Excalidraw)
								{
									tmpCapturedProps = pProps;
								}
								return { type: pComponent, props: pProps };
							}
						},
						ReactDOM:
						{
							createRoot: (pEl) =>
							(
								{
									render: () => {},
									unmount: () => {}
								}
							)
						},
						Excalidraw: function ExcalidrawStub() {}
					};
					tmpView.connectExcalidrawGlobal(tmpFakeVendor);

					// Stub out the destination element so _mountReact's DOM
					// touch is harmless under node + browser-env.
					tmpView._mountElement = { style: {}, innerHTML: '' };
					tmpView._statusElement = { style: {}, classList: { toggle: () => {} }, innerHTML: '' };

					tmpView._mountReact(tmpFakeVendor);

					Expect(tmpCapturedProps,
						'_mountReact should have called React.createElement(Excalidraw, props)')
						.to.be.an('object');
					Expect(tmpCapturedProps.onExcalidrawAPI,
						'onExcalidrawAPI prop must be set on the Excalidraw mount — the public API ' +
						'callback prop is named onExcalidrawAPI, NOT excalidrawAPI.')
						.to.be.a('function');
					Expect(tmpCapturedProps.excalidrawAPI,
						'excalidrawAPI must NOT be passed as a prop — it is the shape of the API ' +
						'object internally, not a public prop name.')
						.to.equal(undefined);
					return fDone();
				});

				/**
				 * Bug: _writeAppData / _readAppData were passing the full
				 * absolute address ("AppData.Drawing") to
				 * fable.manifest.setValueByHash() with pict.AppData as the
				 * base.  That resolved to pict.AppData.AppData.Drawing —
				 * the write went one level too deep and reads returned
				 * undefined.  The fix strips the leading "AppData." prefix
				 * before delegating.  Test both views.
				 */
				test('_writeAppData with absolute "AppData.X" address writes to pict.AppData.X (not pict.AppData.AppData.X) — React view', (fDone) =>
				{
					let tmpPict = configureTestPict();
					tmpPict.AppData = {};
					let tmpView = tmpPict.addView(
						'TestExcalidrawAddressReact',
						{ EmbedMode: 'react', ViewIdentifier: 'TestExcalidrawAddressReact' },
						libPictSectionExcalidraw.ReactView
					);
					let tmpPayload = { elements: [{ id: 'r1' }], appState: {}, files: {} };
					tmpView._writeAppData('AppData.Drawing', tmpPayload);

					Expect(tmpPict.AppData.Drawing, 'pict.AppData.Drawing must hold the payload after write').to.deep.equal(tmpPayload);
					Expect(tmpPict.AppData.AppData,  'pict.AppData.AppData must NOT exist — the prefix was stripped').to.equal(undefined);

					let tmpRead = tmpView._readAppData('AppData.Drawing');
					Expect(tmpRead, 'reading the same absolute address must return the payload').to.deep.equal(tmpPayload);
					return fDone();
				});

				test('_writeAppData with absolute "AppData.X" address writes to pict.AppData.X — Iframe view', (fDone) =>
				{
					let tmpPict = configureTestPict();
					tmpPict.AppData = {};
					let tmpView = tmpPict.addView(
						'TestExcalidrawAddressIframe',
						{ EmbedMode: 'iframe', ViewIdentifier: 'TestExcalidrawAddressIframe' },
						libPictSectionExcalidraw.IframeView
					);
					let tmpPayload = { elements: [{ id: 'i1' }], appState: {}, files: {} };
					tmpView._writeAppData('AppData.Drawing', tmpPayload);

					Expect(tmpPict.AppData.Drawing).to.deep.equal(tmpPayload);
					Expect(tmpPict.AppData.AppData).to.equal(undefined);
					Expect(tmpView._readAppData('AppData.Drawing')).to.deep.equal(tmpPayload);
					return fDone();
				});

				test('_writeAppData with a relative (no "AppData.") address still writes to pict.AppData.X — backward-compat', (fDone) =>
				{
					let tmpPict = configureTestPict();
					tmpPict.AppData = {};
					let tmpView = tmpPict.addView(
						'TestExcalidrawAddressRel',
						{ EmbedMode: 'react', ViewIdentifier: 'TestExcalidrawAddressRel' },
						libPictSectionExcalidraw.ReactView
					);
					tmpView._writeAppData('Nested.Path.Value', 'hello');
					Expect(tmpPict.AppData.Nested.Path.Value).to.equal('hello');
					Expect(tmpView._readAppData('Nested.Path.Value')).to.equal('hello');
					return fDone();
				});
			}
		);

		// ----------------------------------------------------------------
		suite
		(
			'Form factor',
			() =>
			{
				test('buildFormFactorResolver: auto opts out, explicit factors pin, pointer follows the device', () =>
				{
					const libFormFactor = require('../source/utils/Excalidraw-Form-Factor.js');

					// 'auto' means "don't install the hook at all" so Excalidraw keeps its own answer.
					Expect(libFormFactor.buildFormFactorResolver('auto')).to.equal(null);
					Expect(libFormFactor.buildFormFactorResolver(undefined)).to.equal(null);
					Expect(libFormFactor.buildFormFactorResolver('nonsense')).to.equal(null);

					Expect(libFormFactor.buildFormFactorResolver('desktop')()).to.equal('desktop');
					Expect(libFormFactor.buildFormFactorResolver('phone')()).to.equal('phone');
					Expect(libFormFactor.buildFormFactorResolver('DESKTOP')()).to.equal('desktop');

					// A fine pointer (or no matchMedia at all) gets desktop chrome...
					let tmpOriginal = window.matchMedia;
					window.matchMedia = () => ({ matches: false });
					Expect(libFormFactor.buildFormFactorResolver('pointer')()).to.equal('desktop');
					// ...and a touch screen defers to Excalidraw, which is better with a finger.
					window.matchMedia = () => ({ matches: true });
					Expect(libFormFactor.buildFormFactorResolver('pointer')()).to.equal(undefined);
					window.matchMedia = tmpOriginal;
				});

				test('React view folds the resolver into UIOptions without clobbering a host-supplied one', () =>
				{
					let tmpPict = configureTestPict();
					let tmpView = tmpPict.addView(
						'TestExcalidrawFormFactor',
						{ EmbedMode: 'react', ViewIdentifier: 'TestExcalidrawFormFactor', FormFactor: 'desktop' },
						libPictSectionExcalidraw.ReactView
					);
					Expect(tmpView._buildUIOptions().getFormFactor()).to.equal('desktop');

					let tmpHostHook = () => 'phone';
					tmpView.options.UIOptions = { getFormFactor: tmpHostHook };
					Expect(tmpView._buildUIOptions().getFormFactor).to.equal(tmpHostHook);

					tmpView.options.UIOptions = {};
					tmpView.options.FormFactor = 'auto';
					Expect(tmpView._buildUIOptions().getFormFactor).to.equal(undefined);
				});

				test('Iframe init payload carries the form factor as a STRING (a function cannot be cloned)', () =>
				{
					let tmpPict = configureTestPict();
					let tmpView = tmpPict.addView(
						'TestExcalidrawFormFactorIframe',
						{ EmbedMode: 'iframe', ViewIdentifier: 'TestExcalidrawFormFactorIframe', FormFactor: 'pointer' },
						libPictSectionExcalidraw.IframeView
					);

					let tmpPosted = [];
					tmpView._postToIframe = (pMessage) => { tmpPosted.push(pMessage); return true; };
					tmpView._sendInitMessage();

					let tmpInit = tmpPosted.filter((pM) => pM.type === 'pict-excalidraw:init')[0];
					Expect(tmpInit).to.be.an('object');
					Expect(tmpInit.payload.formFactor).to.equal('pointer');
					// structuredClone is what postMessage actually does — a function here would throw.
					Expect(() => JSON.stringify(tmpInit.payload.formFactor)).to.not.throw();
				});

				test('the wrap CSS floor is overridable so an embedder can size the control itself', () =>
				{
					let tmpConfiguration = require('../source/Pict-Section-Excalidraw-DefaultConfiguration.js');
					Expect(tmpConfiguration.FormFactor).to.equal('auto');
					Expect(tmpConfiguration.CSS).to.contain('var(--pict-excalidraw-min-height, 320px)');
					Expect(tmpConfiguration.CSS).to.not.contain('min-height: 320px;');
				});
			}
		);
	}
);
