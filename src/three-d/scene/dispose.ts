import { BufferGeometry, Material, Mesh, Object3D, Texture } from 'three';

const TEXTURE_KEYS = [
	'map',
	'alphaMap',
	'aoMap',
	'bumpMap',
	'displacementMap',
	'emissiveMap',
	'envMap',
	'lightMap',
	'metalnessMap',
	'normalMap',
	'roughnessMap',
	'specularMap',
	'clearcoatMap',
	'clearcoatNormalMap',
	'clearcoatRoughnessMap',
	'sheenColorMap',
	'sheenRoughnessMap',
	'transmissionMap',
	'thicknessMap',
] as const;

export function disposeMaterial(
	material: Material,
	textures: Set<Texture>,
): void {
	const m = material as unknown as Record<string, unknown>;
	for (const key of TEXTURE_KEYS) {
		const tex = m[key];
		if (tex && (tex as Texture).isTexture) textures.add(tex as Texture);
	}
	const uniforms = (m.uniforms ?? {}) as Record<string, { value: unknown }>;
	for (const u of Object.values(uniforms)) {
		if (u?.value && (u.value as Texture).isTexture)
			textures.add(u.value as Texture);
	}
	material.dispose();
}

/** Dispose every geometry, material and texture below `root` (each once). */
export function disposeObject(root: Object3D): void {
	const geometries = new Set<BufferGeometry>();
	const materials = new Set<Material>();
	const textures = new Set<Texture>();
	root.traverse((obj) => {
		const mesh = obj as Mesh;
		if (mesh.geometry) geometries.add(mesh.geometry);
		const mat = mesh.material as Material | Material[] | undefined;
		if (Array.isArray(mat)) mat.forEach((x) => materials.add(x));
		else if (mat) materials.add(mat);
	});
	geometries.forEach((g) => g.dispose());
	materials.forEach((m) => disposeMaterial(m, textures));
	textures.forEach((t) => t.dispose());
}
