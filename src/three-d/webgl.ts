/** Cheap WebGL capability check used before loading the 3D chunk (no Three.js import). */
let cached: boolean | undefined;

export function webglAvailable(): boolean {
	if (cached !== undefined) return cached;
	try {
		const canvas = document.createElement('canvas');
		const gl = (canvas.getContext('webgl2') ??
			canvas.getContext('webgl')) as WebGLRenderingContext | null;
		cached = !!gl;
		gl?.getExtension('WEBGL_lose_context')?.loseContext();
	} catch {
		cached = false;
	}
	return cached;
}
