// Educational navigation uses the same original glyph geometry as the app sidebar.
import { SIDEBAR_GLYPHS } from './sidebar-icons.js';
const names = ['wallet', 'devices', 'security', 'swap', 'chat', 'fingerprint', 'addressBook', 'publicSwap'];
function svg(name) {
 const glyph = SIDEBAR_GLYPHS[name];
 return `<svg class="feature-icon interface-symbol" data-interface-icon="" data-icon="${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true" focusable="false"><path class="interface-glyph-plane" d="${glyph.body}"/><path class="interface-glyph-body" d="${glyph.body}"/><g class="interface-glyph-detail"><path d="${glyph.detail}"/></g><path class="interface-glyph-trace" d="${glyph.detail}" pathLength="1"/></svg>`;
}
export const icon = (index) => svg(names[index]);
export const arrow = svg('forward');
