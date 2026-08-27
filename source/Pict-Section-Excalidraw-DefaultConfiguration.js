/**
 * Default configuration for pict-section-excalidraw.
 *
 * Lives in its own file (mirrors pict-section-code) so the configuration —
 * including the (substantial) CSS — can be reasoned about without scrolling
 * past the view's lifecycle code.
 */

// CSS for the excalidraw wrapper.  All colors flow through pict-section-theme
// CSS custom properties (var(--theme-color-*, fallback)) so the control re-tints
// automatically when the app switches themes.  Layout values are local —
// Excalidraw's own chrome owns its internal sizing.
/* The 320px floor is a var so a host that sizes the control itself (a form field with a resize grip,
   say) can drop below it; without that, the floor silently wins and the control refuses to shrink. */
const _CSS = `.pict-excalidraw-wrap
{
	position: relative;
	display: flex;
	flex-direction: column;
	width: 100%;
	height: 100%;
	min-height: var(--pict-excalidraw-min-height, 320px);
	background: var(--theme-color-background-panel, #FFFFFF);
	border: 1px solid var(--theme-color-border-default, #D0D0D0);
	border-radius: 4px;
	overflow: hidden;
	font-family: var(--theme-typography-family-base, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
	color: var(--theme-color-text-primary, #1A1A1A);
}

/* Theme bridge: forward pict tokens into the variables Excalidraw's own
   stylesheet reads.  See vendor/excalidraw/packages/excalidraw/css/ for the
   token names.  We default to the official light palette so Excalidraw renders
   correctly even before a pict theme overrides anything. */
.pict-excalidraw-wrap
{
	--default-bg-color:       var(--theme-color-background-panel,    #FFFFFF);
	--island-bg-color:        var(--theme-color-background-secondary, #FFFFFF);
	--input-bg-color:         var(--theme-color-background-primary,   #FFFFFF);
	--input-border-color:     var(--theme-color-border-default,       #D0D0D0);
	--text-primary-color:     var(--theme-color-text-primary,         #1A1A1A);
	--color-primary:          var(--theme-color-brand-primary,        #6965DB);
	--color-primary-darker:   var(--theme-color-brand-primary-hover,  #5754C4);
	--color-primary-darkest:  var(--theme-color-brand-primary-hover,  #4642B7);
	--color-on-primary-container: var(--theme-color-background-panel, #FFFFFF);
	--button-hover-bg:        var(--theme-color-background-hover,     #F1F0FF);
	--button-active-bg:       var(--theme-color-background-selected,  #E3E2FE);
	--button-active-border:   var(--theme-color-brand-primary,        #6965DB);
	--popup-bg-color:         var(--theme-color-background-panel,     #FFFFFF);
	--popup-border-color:     var(--theme-color-border-default,       #D0D0D0);
	--icon-fill-color:        var(--theme-color-text-primary,         #1A1A1A);
	--shadow-island:          0 0 0 1px var(--theme-color-border-light, rgba(0,0,0,0.06)), 0 2px 6px 0 var(--theme-color-shadow-color, rgba(0,0,0,0.08));
}

/* iframe mode: the iframe element itself owns the entire wrap surface */
.pict-excalidraw-iframe
{
	flex: 1 1 auto;
	width: 100%;
	height: 100%;
	min-height: var(--pict-excalidraw-min-height, 320px);
	border: 0;
	background: var(--theme-color-background-panel, #FFFFFF);
}

/* react mode: a single inner div that Excalidraw mounts into via createRoot */
.pict-excalidraw-mount
{
	flex: 1 1 auto;
	width: 100%;
	height: 100%;
	min-height: var(--pict-excalidraw-min-height, 320px);
	position: relative;
}

/* Status / error overlay used by both modes before the third-party lib is
   wired up, or when bundling failed. */
.pict-excalidraw-status
{
	position: absolute;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	flex-direction: column;
	gap: 8px;
	padding: 16px;
	background: var(--theme-color-background-panel, #FFFFFF);
	color: var(--theme-color-text-secondary, #4A4A4A);
	text-align: center;
	font-size: 14px;
	line-height: 1.4;
	z-index: 1;
}
.pict-excalidraw-status code
{
	font-family: var(--theme-typography-family-mono, 'SFMono-Regular', 'SF Mono', 'Menlo', 'Consolas', monospace);
	font-size: 12px;
	padding: 2px 6px;
	background: var(--theme-color-background-secondary, #F4F4F4);
	border: 1px solid var(--theme-color-border-light, rgba(0,0,0,0.06));
	border-radius: 3px;
}
.pict-excalidraw-status.error
{
	color: var(--theme-color-status-error, #B43B3B);
}
`;

module.exports = ({
	"RenderOnLoad": true,

	"DefaultRenderable": "Excalidraw-Wrap",
	"DefaultDestinationAddress": "#Excalidraw-Container-Div",
	"TargetElementAddress": "#Excalidraw-Container-Div",

	// 'react' or 'iframe'.  React is cleanest for theme conformance; iframe is
	// the right choice if the host app's global CSS is aggressive enough to
	// bleed into Excalidraw and you'd rather pay the postMessage tax than fight
	// it.
	"EmbedMode": "react",

	// Address in AppData (dot-notation) to two-way bind the scene JSON into.
	// Set to false to opt out.
	"DrawingDataAddress": false,

	// 'light' | 'dark' | 'auto'.  'auto' follows the pict-section-theme mode
	// when the provider is present.
	"Theme": "light",

	// How Excalidraw should classify the editor for UI density.  Excalidraw's own answer comes from
	// the CONTAINER's box, which misreads a small embed on a large desktop as a phone and hides the
	// shape properties behind a popover.
	//   'auto'    - Excalidraw decides (its stock behavior)
	//   'pointer' - desktop chrome for a mouse; Excalidraw's own answer on a touch screen
	//   'desktop' | 'tablet' | 'phone' - pin it
	"FormFactor": "auto",

	"ViewModeEnabled": false,
	"ZenModeEnabled":  false,
	"GridModeEnabled": false,
	"LangCode":        "en",

	// Forwarded verbatim to <Excalidraw UIOptions={...}>.  See:
	// https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/ui-options
	"UIOptions": {},

	// Initial scene used when no OnLoad callback / DrawingDataAddress yields
	// anything.
	"InitialData":
	{
		"elements": [],
		"appState": {},
		"files":    {}
	},

	// Base URL the iframe / wrapper looks under for fonts + locales.  Set this
	// to wherever you copied vendor/excalidraw-built/assets/ at deploy time.
	"AssetBaseURL": "./excalidraw-assets/",

	// URL of the iframe host page (iframe mode only).  Defaults to
	// excalidraw-iframe-host.html sitting next to the page that loaded the
	// wrapper bundle.
	"IframeHostURL": "./excalidraw-iframe-host.html",

	// Lazy-loading: if the wrapper bundle isn't already on the page when the
	// view first mounts, fetch it on demand from these URLs.  Saves first-
	// paint cost for pages that don't have a diagram.  Leave null to require
	// the host to load the scripts via <script> tags (default — preserves
	// the existing eager-load behavior).
	//
	//   LazyLoadReactVendorURL: URL to react-vendor.min.js (or any script
	//                            that sets window.React + window.ReactDOM).
	//                            Skip if the host already loads React.
	//   LazyLoadWrapperURL:      URL to excalidraw-wrapper.min.js (or any
	//                            script that sets
	//                            window.PictSectionExcalidrawVendor).
	"LazyLoadReactVendorURL": null,
	"LazyLoadWrapperURL":     null,

	// Callback hooks — see README.  Signatures intentionally use Node-style
	// fCallback(err, value) so they compose with the rest of the Fable/Pict
	// async patterns.
	"OnLoad":   null,
	"OnSave":   null,
	"OnChange": null,

	// Throttle (ms) for the OnChange callback fired during active editing.
	// Excalidraw fires onChange on every pointer move; the wrapper batches.
	"OnChangeThrottleMs": 250,

	"Templates":
	[
		{
			"Hash": "Excalidraw-Container",
			"Template": "<!-- Excalidraw-Container Rendering Soon -->"
		}
	],

	"Renderables":
	[
		{
			"RenderableHash": "Excalidraw-Wrap",
			"TemplateHash": "Excalidraw-Container",
			"DestinationAddress": "#Excalidraw-Container-Div"
		}
	],

	"CSS": _CSS
});
