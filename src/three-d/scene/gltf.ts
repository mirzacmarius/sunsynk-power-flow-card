/**
 * Optional replacement of the procedural house by a user-supplied GLB/glTF model
 * (served by Home Assistant, e.g. /local/house.glb). No external decoders are
 * fetched; meshopt-compressed files are supported through the bundled decoder.
 */
import { Group, Mesh, Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as meshopt from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { ThreeDConfig } from '../config';

// The decoder's typings point at the `meshoptimizer` package, which node10 module resolution can't see.
const MeshoptDecoder = (
	meshopt as unknown as {
		MeshoptDecoder: Parameters<GLTFLoader['setMeshoptDecoder']>[0];
	}
).MeshoptDecoder;

export async function loadHouseModel(
	model: ThreeDConfig['model'],
	signal: AbortSignal,
): Promise<Group> {
	if (!model.url) throw new Error('no model url');
	const loader = new GLTFLoader();
	loader.setMeshoptDecoder(MeshoptDecoder);
	const gltf = await loader.loadAsync(model.url);
	if (signal.aborted) {
		disposeTree(gltf.scene);
		throw new Error('aborted');
	}
	const root = new Group();
	root.name = 'custom-model';
	root.add(gltf.scene);
	root.scale.setScalar(model.scale);
	root.position.set(...model.position);
	root.rotation.set(
		(model.rotation[0] * Math.PI) / 180,
		(model.rotation[1] * Math.PI) / 180,
		(model.rotation[2] * Math.PI) / 180,
	);
	root.traverse((o) => {
		const m = o as Mesh;
		if (m.isMesh) {
			m.castShadow = true;
			m.receiveShadow = true;
		}
	});
	return root;
}

function disposeTree(o: Object3D): void {
	o.traverse((x) => {
		const m = x as Mesh;
		m.geometry?.dispose();
		const mat = m.material;
		if (Array.isArray(mat)) mat.forEach((y) => y.dispose());
		else mat?.dispose();
	});
}
