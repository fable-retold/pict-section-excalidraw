/**
 * Excalidraw-Form-Factor.js
 *
 * Excalidraw decides how dense its UI should be from the size of the CONTAINER it is mounted in:
 * roughly `width <= 599 || (height < 500 && width < 1000)` reads as a phone, and a phone gets the
 * mobile styles panel — shape properties collapse behind a dismissable popover instead of the
 * left-hand island.
 *
 * That heuristic is right for excalidraw.com, where the container IS the viewport, and wrong for an
 * embed, where the container is a box on a page that may be a few hundred pixels tall on a 27"
 * monitor with a mouse. Excalidraw exposes `UIOptions.getFormFactor(width, height)` for exactly this
 * case; returning `undefined` from it falls back to Excalidraw's own detection.
 *
 * NOTE: the iframe host (source/iframe-host/excalidraw-iframe-host.js) carries its own copy of this
 * logic — a function cannot cross postMessage, so the parent sends the MODE STRING and the host
 * rebuilds the resolver inside the frame. Keep the two in step.
 */

const FORM_FACTORS = ['desktop', 'tablet', 'phone'];

/**
 * Does this device drive the pointer with a finger rather than a mouse?
 *
 * @return {boolean} True when the primary pointer is coarse (touch).
 */
function isCoarsePointer()
{
	if ((typeof window === 'undefined') || (typeof window.matchMedia !== 'function')) return false;
	try { return window.matchMedia('(pointer: coarse)').matches; }
	catch (pErr) { return false; }
}

/**
 * Build the `UIOptions.getFormFactor` hook for a configured FormFactor mode.
 *
 * @param {string} pMode - 'auto' | 'pointer' | 'desktop' | 'tablet' | 'phone'.
 * @return {Function} The hook, or null when Excalidraw should decide for itself.
 */
function buildFormFactorResolver(pMode)
{
	let tmpMode = (typeof pMode === 'string') ? pMode.toLowerCase() : 'auto';

	if (tmpMode === 'pointer')
	{
		// Classify by input device, not by the size of the box we happen to be embedded in. A touch
		// screen still gets Excalidraw's own answer — the mobile UI is genuinely better with a finger.
		return function () { return isCoarsePointer() ? undefined : 'desktop'; };
	}

	if (FORM_FACTORS.indexOf(tmpMode) > -1)
	{
		return function () { return tmpMode; };
	}

	// 'auto' and anything unrecognized: don't install the hook at all.
	return null;
}

module.exports = { buildFormFactorResolver, isCoarsePointer, FORM_FACTORS };
