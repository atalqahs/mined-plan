/**
 * Rendering tier detection. Software rasterisers (SwiftShader, llvmpipe, WARP,
 * Microsoft Basic Render Driver) run every pixel on the CPU; we lower geometry
 * detail, pixel ratio and MSAA for them. `?quality=high|low` overrides.
 */
export type RenderTier = 'high' | 'low';

export interface TierInfo {
  tier: RenderTier;
  renderer: string;
  software: boolean;
}

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|warp|mesa offscreen/i;

let cached: TierInfo | null = null;

export function detectRenderTier(search = typeof location !== 'undefined' ? location.search : ''): TierInfo {
  if (cached) return cached;
  let renderer = 'unknown';
  try {
    const gl = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    if (gl && ext) renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    /* ignore — treat as unknown */
  }
  const software = SOFTWARE.test(renderer);
  const forced = new URLSearchParams(search).get('quality');
  const tier: RenderTier = forced === 'high' || forced === 'low' ? forced : software ? 'low' : 'high';
  cached = { tier, renderer, software };
  return cached;
}
