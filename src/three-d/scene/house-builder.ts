/**
 * Procedural model of the house, built from the editable dimensions in HouseSpec.
 *
 * House coordinates (metres): x runs along the garden facade (left wing at x < 0,
 * right volume at x > 0), z points out of the garden facade, y is up. The rear
 * walls of both volumes sit on z = 0. The returned root group is shifted so the
 * house is centred on the world origin.
 *
 * Static parts are merged per material to keep draw calls low.
 */
import {
	BufferGeometry,
	CanvasTexture,
	CircleGeometry,
	CylinderGeometry,
	DoubleSide,
	Group,
	Matrix4,
	Mesh,
	MeshBasicMaterial,
	MeshStandardMaterial,
	Object3D,
	PlaneGeometry,
	SphereGeometry,
	SRGBColorSpace,
	Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { HouseSpec } from '../config';
import { MaterialKey, MaterialLibrary, meterBox } from './materials';

export interface RectXZ {
	x: number;
	z: number;
	w: number;
	d: number;
}

export interface HouseDims {
	Lw: number;
	Ld: number;
	Rw: number;
	Rd: number;
	fh: number;
	cl: number;
	gFront: number;
	roofTop: number;
	parapetTop: number;
	xMin: number;
	xMax: number;
	zMax: number;
	frameFront: number;
	loggiaBackR: number;
	loggiaBackL: number;
}

export interface HouseModel {
	root: Group;
	groups: {
		site: Group;
		ground: Group;
		first: Group;
		roof: Group;
		groundArch: Group;
		firstArch: Group;
		roofArch: Group;
		groundInterior: Group;
		firstInterior: Group;
	};
	dims: HouseDims;
	/** interior floor area per floor, house coordinates */
	footprint: { ground: RectXZ[]; first: RectXZ[] };
	/** usable flat-roof areas inside the parapets, with the roof surface height */
	roofs: { left: RectXZ & { y: number }; right: RectXZ & { y: number } };
	lights: {
		wall: Vector3[];
		soffit: Vector3[];
		loggia: Vector3[];
		rightLoggia: Vector3[];
		bollards: Vector3[];
	};
	washes: {
		upperLoggia: Mesh;
		lowerWall: Mesh;
	};
	/** emissive light fittings switched on with exterior lighting */
	fittings: Mesh[];
	/** default technical area on the right volume's side wall */
	technical: {
		inverter: Vector3;
		battery: Vector3;
		grid: Vector3;
		board: Vector3;
	};
	/** world-space offset applied to the house root */
	offset: Vector3;
	dispose(): void;
}

type Opening = [number, number, number, number]; // [u0, u1, y0, y1]

class Batcher {
	private readonly items = new Map<
		string,
		{
			key: MaterialKey;
			cast: boolean;
			receive: boolean;
			geos: BufferGeometry[];
		}
	>();

	add(
		key: MaterialKey,
		geo: BufferGeometry,
		cast = true,
		receive = true,
	): void {
		const id = `${key}|${cast ? 1 : 0}|${receive ? 1 : 0}`;
		let item = this.items.get(id);
		if (!item) {
			item = { key, cast, receive, geos: [] };
			this.items.set(id, item);
		}
		item.geos.push(geo);
	}

	build(mats: MaterialLibrary, parent: Object3D): void {
		for (const item of this.items.values()) {
			if (!item.geos.length) continue;
			const merged = mergeGeometries(item.geos, false);
			item.geos.forEach((g) => g.dispose());
			if (!merged) continue;
			const mesh = new Mesh(merged, mats.get(item.key));
			mesh.castShadow = item.cast;
			mesh.receiveShadow = item.receive;
			mesh.name = `batch:${item.key}`;
			parent.add(mesh);
		}
		this.items.clear();
	}
}

/** Box from min/max corners. */
function boxGeo(
	x0: number,
	x1: number,
	y0: number,
	y1: number,
	z0: number,
	z1: number,
): BufferGeometry {
	const w = Math.abs(x1 - x0);
	const h = Math.abs(y1 - y0);
	const d = Math.abs(z1 - z0);
	const g = meterBox(
		Math.max(w, 0.001),
		Math.max(h, 0.001),
		Math.max(d, 0.001),
	);
	g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
	return g;
}

function gradientTexture(
	stops: [number, string][],
	vertical = true,
): CanvasTexture {
	const c = document.createElement('canvas');
	c.width = vertical ? 4 : 128;
	c.height = vertical ? 128 : 4;
	const ctx = c.getContext('2d')!;
	const g = vertical
		? ctx.createLinearGradient(0, 0, 0, 128)
		: ctx.createLinearGradient(0, 0, 128, 0);
	for (const [o, col] of stops) g.addColorStop(o, col);
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, c.width, c.height);
	const t = new CanvasTexture(c);
	t.colorSpace = SRGBColorSpace;
	return t;
}

function radialTexture(inner: string, outer: string): CanvasTexture {
	const c = document.createElement('canvas');
	c.width = c.height = 256;
	const ctx = c.getContext('2d')!;
	const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
	g.addColorStop(0, inner);
	g.addColorStop(0.72, inner);
	g.addColorStop(1, outer);
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, 256, 256);
	const t = new CanvasTexture(c);
	return t;
}

export function computeDims(s: HouseSpec): HouseDims {
	const fh = s.floor_height;
	const Lw = s.left.width;
	const Ld = s.left.depth;
	const Rw = s.right.width;
	const Rd = Ld + s.right.projection;
	const cl = s.left.cantilever_left;
	const roofTop = 2 * fh + 0.35;
	const parapetTop = roofTop + s.parapet;
	const frameFront = Rd + s.right.frame_overhang;
	return {
		Lw,
		Ld,
		Rw,
		Rd,
		fh,
		cl,
		gFront: Ld - s.left.ground_setback,
		roofTop,
		parapetTop,
		xMin: -Lw - cl,
		xMax: Rw,
		zMax: frameFront,
		frameFront,
		loggiaBackR: frameFront - s.right.frame_depth,
		loggiaBackL: Ld - s.left.loggia_depth,
	};
}

export function buildHouse(spec: HouseSpec, mats: MaterialLibrary): HouseModel {
	const d = computeDims(spec);
	const { Lw, Ld, Rw, Rd, fh, gFront, roofTop, parapetTop, xMin, frameFront } =
		d;
	const T = 0.3; // exterior wall thickness
	const PT = 0.25; // parapet thickness
	const slabTop = fh;
	const slabBottom = fh - 0.35;
	const owned: { dispose(): void }[] = [];

	const root = new Group();
	root.name = 'house-root';
	const site = new Group();
	const ground = new Group();
	const first = new Group();
	const roof = new Group();
	const groundArch = new Group();
	const firstArch = new Group();
	const roofArch = new Group();
	const groundInterior = new Group();
	const firstInterior = new Group();
	site.name = 'site';
	ground.name = 'ground';
	first.name = 'first';
	roof.name = 'roof';
	ground.add(groundArch, groundInterior);
	first.add(firstArch, firstInterior);
	roof.add(roofArch);
	root.add(site, ground, first, roof);

	const bSite = new Batcher();
	const bG = new Batcher();
	const bF = new Batcher();
	const bR = new Batcher();
	const bGi = new Batcher();
	const bFi = new Batcher();

	const box = (
		b: Batcher,
		key: MaterialKey,
		x0: number,
		x1: number,
		y0: number,
		y1: number,
		z0: number,
		z1: number,
		cast = true,
		receive = true,
	) =>
		b.add(
			key,
			boxGeo(
				Math.min(x0, x1),
				Math.max(x0, x1),
				Math.min(y0, y1),
				Math.max(y0, y1),
				Math.min(z0, z1),
				Math.max(z0, z1),
			),
			cast,
			receive,
		);

	/** Wall in the XY plane (faces ±z) spanning x0..x1, thickness z0..z1, with rectangular openings [x0,x1,y0,y1]. */
	const wallZ = (
		b: Batcher,
		key: MaterialKey,
		x0: number,
		x1: number,
		y0: number,
		y1: number,
		z0: number,
		z1: number,
		openings: Opening[] = [],
	) => {
		for (const [ua, ub, va, vb] of solidParts(x0, x1, y0, y1, openings))
			box(b, key, ua, ub, va, vb, z0, z1);
	};
	/** Wall in the YZ plane (faces ±x) spanning z0..z1, thickness x0..x1, with openings [z0,z1,y0,y1]. */
	const wallX = (
		b: Batcher,
		key: MaterialKey,
		z0: number,
		z1: number,
		y0: number,
		y1: number,
		x0: number,
		x1: number,
		openings: Opening[] = [],
	) => {
		for (const [ua, ub, va, vb] of solidParts(z0, z1, y0, y1, openings))
			box(b, key, x0, x1, va, vb, ua, ub);
	};

	/** Black-framed glazing in an opening of a z-facing wall. */
	const glazingZ = (
		b: Batcher,
		x0: number,
		x1: number,
		y0: number,
		y1: number,
		zc: number,
		panes = 1,
		f = 0.06,
	) => {
		box(
			b,
			'glass',
			x0 + f,
			x1 - f,
			y0 + f,
			y1 - f,
			zc - 0.01,
			zc + 0.01,
			false,
			false,
		);
		box(b, 'frame', x0, x1, y1 - f, y1, zc - 0.05, zc + 0.05);
		box(b, 'frame', x0, x1, y0, y0 + f, zc - 0.05, zc + 0.05);
		box(b, 'frame', x0, x0 + f, y0, y1, zc - 0.05, zc + 0.05);
		box(b, 'frame', x1 - f, x1, y0, y1, zc - 0.05, zc + 0.05);
		for (let i = 1; i < panes; i++) {
			const x = x0 + ((x1 - x0) * i) / panes;
			box(b, 'frame', x - f / 2, x + f / 2, y0, y1, zc - 0.045, zc + 0.045);
		}
	};
	const glazingX = (
		b: Batcher,
		z0: number,
		z1: number,
		y0: number,
		y1: number,
		xc: number,
		panes = 1,
		f = 0.06,
	) => {
		box(
			b,
			'glass',
			xc - 0.01,
			xc + 0.01,
			y0 + f,
			y1 - f,
			z0 + f,
			z1 - f,
			false,
			false,
		);
		box(b, 'frame', xc - 0.05, xc + 0.05, y1 - f, y1, z0, z1);
		box(b, 'frame', xc - 0.05, xc + 0.05, y0, y0 + f, z0, z1);
		box(b, 'frame', xc - 0.05, xc + 0.05, y0, y1, z0, z0 + f);
		box(b, 'frame', xc - 0.05, xc + 0.05, y0, y1, z1 - f, z1);
		for (let i = 1; i < panes; i++) {
			const z = z0 + ((z1 - z0) * i) / panes;
			box(b, 'frame', xc - 0.045, xc + 0.045, y0, y1, z - f / 2, z + f / 2);
		}
	};

	// =====================================================================
	// LEFT WING — ground floor (set back under the cantilevered upper box)
	// =====================================================================
	const lgDoor: Opening = [-3.45, -2.15, 0, 2.5];
	const lgWin: Opening = [-5.7, -4.1, 0.9, 2.5];
	const lgDoor2: Opening = [-7.45, -6.45, 0, 2.35];
	box(bG, 'concrete', -Lw, 0, -0.25, 0, 0, gFront); // plinth / slab
	wallZ(bG, 'wall', -Lw, 0, 0, slabBottom, gFront - T, gFront, [
		lgDoor,
		lgWin,
		lgDoor2,
	]);
	glazingZ(bG, lgDoor[0], lgDoor[1], lgDoor[2], lgDoor[3], gFront - T / 2, 1);
	glazingZ(bG, lgWin[0], lgWin[1], lgWin[2], lgWin[3], gFront - T / 2, 2);
	box(
		bG,
		'door',
		lgDoor2[0] + 0.05,
		lgDoor2[1] - 0.05,
		0,
		lgDoor2[3] - 0.05,
		gFront - T / 2 - 0.03,
		gFront - T / 2 + 0.03,
	);
	const lgSideWin: Opening = [2.4, 4.0, 0.9, 2.3];
	wallX(bG, 'wall', 0, gFront, 0, slabBottom, -Lw, -Lw + T, [lgSideWin]);
	glazingX(
		bG,
		lgSideWin[0],
		lgSideWin[1],
		lgSideWin[2],
		lgSideWin[3],
		-Lw + T / 2,
		1,
	);
	const lgRear1: Opening = [-8.6, -7.2, 0.9, 2.3];
	const lgRear2: Opening = [-4.6, -2.4, 0.9, 2.3];
	wallZ(bG, 'wall', -Lw, 0, 0, slabBottom, 0, T, [lgRear1, lgRear2]);
	glazingZ(bG, lgRear1[0], lgRear1[1], lgRear1[2], lgRear1[3], T / 2, 1);
	glazingZ(bG, lgRear2[0], lgRear2[1], lgRear2[2], lgRear2[3], T / 2, 2);

	// =====================================================================
	// RIGHT VOLUME — ground floor
	// =====================================================================
	const gl = spec.right.glazing_left_pier;
	const gw = spec.right.glazing_width;
	const gh = spec.right.glazing_height;
	box(bG, 'concrete', 0, Rw, -0.25, 0, 0, Rd);
	const rgFront: Opening = [gl, gl + gw, 0, gh];
	wallZ(bG, 'wall', 0, Rw, 0, slabBottom, Rd - T, Rd, [rgFront]);
	glazingZ(bG, rgFront[0], rgFront[1], rgFront[2], rgFront[3], Rd - T / 2, 4);
	// left side wall: tall narrow window near the front corner, door into the left wing
	const rgSideWin: Opening = [Rd - 1.3, Rd - 0.7, 0.25, 2.6];
	const rgSideDoor: Opening = [gFront - 2.6, gFront - 1.5, 0, 2.2];
	wallX(bG, 'wall', 0, Rd, 0, slabBottom, 0, T, [rgSideWin, rgSideDoor]);
	glazingX(
		bG,
		rgSideWin[0],
		rgSideWin[1],
		rgSideWin[2],
		rgSideWin[3],
		T / 2,
		1,
	);
	// right side wall (technical area outside around z 4.2–6.9)
	const rgRightWin: Opening = [1.6, 2.9, 0.9, 2.2];
	const rgRightWin2: Opening = [Rd - 3.2, Rd - 1.8, 0.9, 2.3];
	wallX(bG, 'wall', 0, Rd, 0, slabBottom, Rw - T, Rw, [
		rgRightWin,
		rgRightWin2,
	]);
	glazingX(
		bG,
		rgRightWin[0],
		rgRightWin[1],
		rgRightWin[2],
		rgRightWin[3],
		Rw - T / 2,
		1,
	);
	glazingX(
		bG,
		rgRightWin2[0],
		rgRightWin2[1],
		rgRightWin2[2],
		rgRightWin2[3],
		Rw - T / 2,
		1,
	);
	const rgRear: Opening = [1.8, 4.2, 0.9, 2.3];
	wallZ(bG, 'wall', 0, Rw, 0, slabBottom, 0, T, [rgRear]);
	glazingZ(bG, rgRear[0], rgRear[1], rgRear[2], rgRear[3], T / 2, 2);

	// first-floor slabs (ceiling of the ground floor); the left one cantilevers
	box(bF, 'wall', xMin, 0, slabBottom, slabTop, 0, Ld);
	box(bF, 'wall', 0, Rw, slabBottom, slabTop, 0, d.loggiaBackR);

	// =====================================================================
	// LEFT WING — upper box with the long recessed loggia
	// =====================================================================
	const llm = spec.left.loggia_left_margin;
	const lb = d.loggiaBackL;
	const loggiaCeil = roofTop - 0.35;
	// left end wall + side window
	const luSideWin: Opening = [3.0, 4.8, fh + 0.9, fh + 2.4];
	wallX(bF, 'wall', 0, Ld, slabTop, parapetTop, xMin, xMin + T, [luSideWin]);
	glazingX(
		bF,
		luSideWin[0],
		luSideWin[1],
		luSideWin[2],
		luSideWin[3],
		xMin + T / 2,
		1,
	);
	// solid return wall left of the loggia opening
	box(bF, 'wall', xMin + T, xMin + llm, slabTop, parapetTop, lb, Ld);
	// rear wall
	const luRear1: Opening = [-9.4, -7.8, fh + 0.9, fh + 2.3];
	const luRear2: Opening = [-5.0, -3.2, fh + 0.9, fh + 2.3];
	wallZ(bF, 'wall', xMin, 0, slabTop, roofTop, 0, T, [luRear1, luRear2]);
	glazingZ(bF, luRear1[0], luRear1[1], luRear1[2], luRear1[3], T / 2, 1);
	glazingZ(bF, luRear2[0], luRear2[1], luRear2[2], luRear2[3], T / 2, 2);
	// loggia back wall with two tall door units
	const luDoor1: Opening = [-3.0, -1.6, slabTop, slabTop + 2.75];
	const luDoor2: Opening = [-6.8, -5.4, slabTop, slabTop + 2.75];
	wallZ(bF, 'wall', xMin + llm, 0, slabTop, loggiaCeil, lb - T, lb, [
		luDoor1,
		luDoor2,
	]);
	glazingZ(bF, luDoor1[0], luDoor1[1], luDoor1[2], luDoor1[3], lb - T / 2, 2);
	glazingZ(bF, luDoor2[0], luDoor2[1], luDoor2[2], luDoor2[3], lb - T / 2, 2);
	// loggia floor finish
	box(bF, 'floorStone', xMin + llm, 0, slabTop, slabTop + 0.02, lb, Ld - 0.02);
	// solid band above the opening (front face only; the roof slab is the loggia ceiling)
	box(bR, 'wall', xMin + llm, 0, loggiaCeil, parapetTop, Ld - 0.3, Ld);
	// full-width frameless glass railing on a slim metal channel
	box(
		bF,
		'metalDark',
		xMin + llm,
		0,
		slabTop,
		slabTop + 0.08,
		Ld - 0.12,
		Ld - 0.02,
	);
	box(
		bF,
		'railingGlass',
		xMin + llm + 0.02,
		-0.02,
		slabTop + 0.08,
		slabTop + 1.1,
		Ld - 0.08,
		Ld - 0.06,
		false,
		false,
	);

	// =====================================================================
	// RIGHT VOLUME — upper floor: thick frame around a recessed loggia
	// =====================================================================
	const fl = spec.right.frame_left;
	const fr = spec.right.frame_right;
	const ft = spec.right.frame_top;
	const lbR = d.loggiaBackR;
	const frameTopY = parapetTop - ft;
	const bottomBandY0 = slabTop - spec.right.frame_bottom + 0.25;
	// bottom band (loggia floor slab + fascia) and front upstand
	box(bF, 'wall', 0, Rw, bottomBandY0, slabTop, lbR, frameFront);
	box(bF, 'wall', 0, Rw, slabTop, slabTop + 0.25, frameFront - 0.3, frameFront);
	box(
		bF,
		'floorStone',
		fl,
		Rw - fr,
		slabTop,
		slabTop + 0.02,
		lbR,
		frameFront - 0.3,
	);
	// legs
	box(bF, 'wall', 0, fl, slabTop, frameTopY, lbR, frameFront);
	box(bF, 'wall', Rw - fr, Rw, slabTop, frameTopY, lbR, frameFront);
	// top band (part of the roof group so it lifts with the roof in exploded view)
	box(bR, 'wall', 0, Rw, frameTopY, parapetTop, lbR, frameFront);
	// glass wall at the back of the loggia, aligned over the ground-floor glazing
	box(bF, 'wall', fl, gl, slabTop, frameTopY, lbR - T, lbR);
	box(bF, 'wall', gl + gw, Rw - fr, slabTop, frameTopY, lbR - T, lbR);
	glazingZ(bF, gl, gl + gw, slabTop, frameTopY, lbR - T / 2, 4);
	// frameless glass balustrade on the upstand
	box(
		bF,
		'railingGlass',
		fl + 0.02,
		Rw - fr - 0.02,
		slabTop + 0.25,
		slabTop + 1.1,
		frameFront - 0.17,
		frameFront - 0.15,
		false,
		false,
	);
	// side walls, rear wall
	const ruSideWin: Opening = [lbR - 1.6, lbR - 1.0, fh + 0.3, fh + 2.6];
	wallX(bF, 'wall', 0, lbR, slabTop, roofTop, 0, T, [ruSideWin]);
	glazingX(
		bF,
		ruSideWin[0],
		ruSideWin[1],
		ruSideWin[2],
		ruSideWin[3],
		T / 2,
		1,
	);
	const ruRightWin: Opening = [2.0, 3.4, fh + 0.9, fh + 2.3];
	const ruRightWin2: Opening = [lbR - 3.0, lbR - 1.6, fh + 0.9, fh + 2.3];
	wallX(bF, 'wall', 0, lbR, slabTop, roofTop, Rw - T, Rw, [
		ruRightWin,
		ruRightWin2,
	]);
	glazingX(
		bF,
		ruRightWin[0],
		ruRightWin[1],
		ruRightWin[2],
		ruRightWin[3],
		Rw - T / 2,
		1,
	);
	glazingX(
		bF,
		ruRightWin2[0],
		ruRightWin2[1],
		ruRightWin2[2],
		ruRightWin2[3],
		Rw - T / 2,
		1,
	);
	const ruRear: Opening = [1.6, 4.4, fh + 0.9, fh + 2.3];
	wallZ(bF, 'wall', 0, Rw, slabTop, roofTop, 0, T, [ruRear]);
	glazingZ(bF, ruRear[0], ruRear[1], ruRear[2], ruRear[3], T / 2, 2);

	// =====================================================================
	// ROOFS — slabs, parapets, anthracite copings
	// =====================================================================
	box(bR, 'roof', xMin, 0, loggiaCeil, roofTop, 0, Ld - 0.3);
	box(bR, 'roof', 0, Rw, loggiaCeil, roofTop, 0, lbR);
	// left roof parapets
	box(bR, 'wall', xMin, xMin + PT, roofTop, parapetTop, 0, Ld);
	box(bR, 'wall', xMin, 0, roofTop, parapetTop, 0, PT);
	box(bR, 'wall', xMin, xMin + llm, roofTop, parapetTop, Ld - 0.3, Ld);
	// right roof parapets (front is the frame's top band)
	box(bR, 'wall', -PT / 2, PT / 2, roofTop, parapetTop, 0, lbR);
	box(bR, 'wall', Rw - PT, Rw, roofTop, parapetTop, 0, lbR);
	box(bR, 'wall', 0, Rw, roofTop, parapetTop, 0, PT);
	// copings
	const cop = (x0: number, x1: number, z0: number, z1: number) =>
		box(
			bR,
			'coping',
			x0 - 0.02,
			x1 + 0.02,
			parapetTop,
			parapetTop + 0.06,
			z0 - 0.02,
			z1 + 0.02,
		);
	cop(xMin, xMin + PT, 0, Ld);
	cop(xMin, 0, 0, PT);
	cop(xMin, 0, Ld - 0.3, Ld);
	cop(-PT / 2, PT / 2, 0, lbR);
	cop(Rw - PT, Rw, 0, lbR);
	cop(0, Rw, 0, PT);
	cop(0, Rw, lbR, frameFront);
	// roof drains / small details
	box(bR, 'metalDark', -2, -1.6, roofTop, roofTop + 0.05, 0.6, 1.0);
	box(
		bR,
		'metalDark',
		Rw / 2 - 0.2,
		Rw / 2 + 0.2,
		roofTop,
		roofTop + 0.05,
		0.6,
		1.0,
	);

	// =====================================================================
	// INTERIOR — floors, partitions, furniture (visible through the glass)
	// =====================================================================
	const groundRects: RectXZ[] = [
		{ x: -Lw + T, z: T, w: Lw - T * 2, d: gFront - T * 2 },
		{ x: T, z: T, w: Rw - T * 2, d: Rd - T * 2 },
	];
	const firstRects: RectXZ[] = [
		{ x: xMin + T, z: T, w: -xMin - T * 2, d: lb - T * 2 },
		{ x: T, z: T, w: Rw - T * 2, d: lbR - T * 2 },
	];
	for (const r of groundRects)
		box(bGi, 'floorWood', r.x, r.x + r.w, 0, 0.02, r.z, r.z + r.d, false, true);
	for (const r of firstRects)
		box(
			bFi,
			'floorWood',
			r.x,
			r.x + r.w,
			slabTop,
			slabTop + 0.02,
			r.z,
			r.z + r.d,
			false,
			true,
		);
	// ceilings (undersides) read as plaster; they belong to the slab above, so they hide/ghost with it
	for (const r of groundRects)
		box(
			bF,
			'soffit',
			r.x,
			r.x + r.w,
			slabBottom - 0.01,
			slabBottom,
			r.z,
			r.z + r.d,
			false,
			false,
		);
	for (const r of firstRects)
		box(
			bR,
			'soffit',
			r.x,
			r.x + r.w,
			loggiaCeil - 0.01,
			loggiaCeil,
			r.z,
			r.z + r.d,
			false,
			false,
		);

	// open-riser staircase on the left of the right volume, rising towards the rear
	{
		const steps = 16;
		const rise = (fh - 0.02) / steps;
		const run = 0.27;
		const x0 = T + 0.08;
		const x1 = T + 1.05;
		const zStart = Rd - 1.15;
		for (let i = 0; i < steps; i++) {
			const y = rise * (i + 1);
			const z = zStart - i * run;
			box(bGi, 'woodFurniture', x0, x1, y - 0.05, y, z - run, z, true, true);
		}
		const zEnd = zStart - steps * run;
		// steel stringers
		const stringer = (x: number) => {
			const len = Math.hypot(fh, steps * run);
			const g = meterBox(0.03, 0.22, len);
			const m = new Matrix4()
				.makeRotationX(Math.atan2(fh, steps * run))
				.setPosition(x, fh / 2 - 0.08, (zStart + zEnd) / 2);
			g.applyMatrix4(m);
			bGi.add('black', g);
		};
		stringer(x0 + 0.02);
		stringer(x1 - 0.02);
	}

	// right volume, ground floor: dining table with pendants, sofa on the right
	const dz = Rd - 2.6;
	box(bGi, 'woodFurniture', 2.0, 4.1, 0.72, 0.76, dz - 0.5, dz + 0.5);
	for (const lx of [2.2, 3.9])
		box(bGi, 'black', lx, lx + 0.06, 0, 0.72, dz - 0.4, dz + 0.4);
	for (let i = 0; i < 3; i++) {
		const cx = 2.35 + i * 0.7;
		box(
			bGi,
			'fabricDark',
			cx - 0.21,
			cx + 0.21,
			0.45,
			0.5,
			dz - 0.95,
			dz - 0.55,
		);
		box(
			bGi,
			'fabricDark',
			cx - 0.21,
			cx + 0.21,
			0.5,
			0.92,
			dz - 0.97,
			dz - 0.92,
		);
		box(
			bGi,
			'fabricDark',
			cx - 0.21,
			cx + 0.21,
			0.45,
			0.5,
			dz + 0.55,
			dz + 0.95,
		);
		box(
			bGi,
			'fabricDark',
			cx - 0.21,
			cx + 0.21,
			0.5,
			0.92,
			dz + 0.92,
			dz + 0.97,
		);
	}
	// L-shaped sofa + rug + low table
	box(bGi, 'fabric', Rw - 1.25, Rw - T - 0.05, 0, 0.42, Rd - 5.4, Rd - 3.2);
	box(bGi, 'fabric', Rw - 1.25, Rw - T - 0.05, 0.42, 0.85, Rd - 5.4, Rd - 5.1);
	box(bGi, 'fabric', Rw - 2.8, Rw - 1.25, 0, 0.42, Rd - 5.4, Rd - 4.55);
	box(bGi, 'fabric', Rw - 2.8, Rw - 1.25, 0.42, 0.85, Rd - 5.4, Rd - 5.15);
	box(
		bGi,
		'fabricDark',
		Rw - 3.0,
		Rw - 1.4,
		0.02,
		0.03,
		Rd - 4.4,
		Rd - 2.8,
		false,
		true,
	);
	box(bGi, 'woodFurniture', Rw - 2.6, Rw - 1.8, 0.03, 0.38, Rd - 4.0, Rd - 3.3);

	// left wing ground floor: kitchen island + counters along the rear wall
	box(bGi, 'kitchen', -4.6, -1.0, 0, 0.9, T, T + 0.62);
	box(bGi, 'black', -4.6, -1.0, 0.9, 0.94, T, T + 0.64);
	box(bGi, 'kitchen', -4.6, -1.0, 1.5, 2.25, T, T + 0.36);
	box(bGi, 'kitchen', -3.8, -1.8, 0, 0.9, 2.6, 3.5);
	box(bGi, 'whiteGloss', -3.85, -1.75, 0.9, 0.94, 2.55, 3.55);
	// hall bench + console
	box(bGi, 'woodFurniture', -8.6, -7.2, 0, 0.45, gFront - 1.1, gFront - 0.7);

	// first floor: master bedroom in the right volume, bedrooms in the left wing
	const bed = (b: Batcher, cx: number, cz: number, rot: 'z' | 'x') => {
		const [w, l] = rot === 'z' ? [1.7, 2.1] : [2.1, 1.7];
		box(
			b,
			'woodFurniture',
			cx - w / 2,
			cx + w / 2,
			slabTop,
			slabTop + 0.32,
			cz - l / 2,
			cz + l / 2,
		);
		box(
			b,
			'bed',
			cx - w / 2 + 0.05,
			cx + w / 2 - 0.05,
			slabTop + 0.32,
			slabTop + 0.55,
			cz - l / 2 + 0.05,
			cz + l / 2 - 0.05,
		);
		if (rot === 'z')
			box(
				b,
				'fabricDark',
				cx - w / 2,
				cx + w / 2,
				slabTop,
				slabTop + 1.15,
				cz - l / 2 - 0.08,
				cz - l / 2,
			);
		else
			box(
				b,
				'fabricDark',
				cx - w / 2 - 0.08,
				cx - w / 2,
				slabTop,
				slabTop + 1.15,
				cz - l / 2,
				cz + l / 2,
			);
	};
	bed(bFi, Rw / 2 + 0.3, lbR - 3.4, 'z');
	box(
		bFi,
		'woodFurniture',
		Rw - T - 0.62,
		Rw - T,
		slabTop,
		slabTop + 2.3,
		1.0,
		3.4,
	); // wardrobe
	bed(bFi, -3.0, lb - 3.0, 'z');
	bed(bFi, -7.4, lb - 3.0, 'z');
	box(
		bFi,
		'woodFurniture',
		xMin + T,
		xMin + T + 0.6,
		slabTop,
		slabTop + 2.3,
		0.8,
		3.0,
	);

	// interior partitions (simple, plausible layout)
	box(bGi, 'wallInterior', -4.8, -4.7, 0, slabBottom, T, gFront - T - 1.0);
	box(bGi, 'wallInterior', T, Rw - T, 0, slabBottom, gFront - 0.1, gFront);
	box(bFi, 'wallInterior', -5.2, -5.1, slabTop, loggiaCeil, T, lb - T - 1.0);
	box(bFi, 'wallInterior', T, Rw - T, slabTop, loggiaCeil, 4.0, 4.1);

	// plants on the right loggia
	const plant = (b: Batcher, x: number, y: number, z: number, s = 1) => {
		const pot = new CylinderGeometry(0.22 * s, 0.17 * s, 0.42 * s, 12);
		pot.translate(x, y + 0.21 * s, z);
		b.add('pot', pot);
		const leaf = new SphereGeometry(0.36 * s, 9, 7);
		leaf.scale(1, 1.2, 1);
		leaf.translate(x, y + 0.42 * s + 0.36 * s, z);
		b.add('foliage', leaf);
	};
	plant(bF, fl + 0.45, slabTop, frameFront - 0.6);
	plant(bF, Rw - fr - 0.45, slabTop, frameFront - 0.6, 0.85);

	// =====================================================================
	// SITE — terrain, terrace, planting, technical canopy
	// =====================================================================
	const cx = (xMin + Rw) / 2;
	const cz = frameFront / 2;
	const td = spec.terrace_depth;
	const tX0 = xMin - 0.6;
	const tX1 = Rw + 0.8;
	const tZ0 = gFront;
	const tZ1 = frameFront + td;
	box(bSite, 'terrace', tX0, tX1, -0.07, -0.02, tZ0, tZ1, false, true);
	box(
		bSite,
		'paverEdge',
		tX0 - 0.25,
		tX1 + 0.25,
		-0.075,
		-0.015,
		tZ1,
		tZ1 + 0.25,
		false,
		true,
	);
	box(
		bSite,
		'paverEdge',
		tX0 - 0.25,
		tX0,
		-0.075,
		-0.015,
		tZ0,
		tZ1,
		false,
		true,
	);
	box(
		bSite,
		'paverEdge',
		tX1,
		tX1 + 0.25,
		-0.075,
		-0.015,
		tZ0,
		tZ1,
		false,
		true,
	);
	// path along the right side to the technical area and the street
	box(
		bSite,
		'terrace',
		Rw + 0.8,
		Rw + 2.0,
		-0.07,
		-0.02,
		-1.5,
		tZ0,
		false,
		true,
	);
	// planting: low hedges and a few trees
	box(bSite, 'hedge', xMin - 3, Rw + 3, 0, 0.9, -4.2, -3.5);
	box(bSite, 'hedge', xMin - 3.7, xMin - 3, 0, 0.9, -4.2, tZ1 + 3);
	const tree = (x: number, z: number, h: number, r: number) => {
		const trunk = new CylinderGeometry(0.09, 0.13, h * 0.55, 8);
		trunk.translate(x, (h * 0.55) / 2, z);
		bSite.add('trunk', trunk);
		const crown = new SphereGeometry(r, 10, 8);
		crown.scale(1, 1.15, 1);
		crown.translate(x, h * 0.55 + r * 0.9, z);
		bSite.add('foliage', crown);
	};
	tree(xMin - 2.2, tZ1 + 1.8, 4.2, 1.4);
	tree(xMin - 1.6, 2.0, 5.0, 1.7);
	tree(Rw + 4.2, -2.5, 4.6, 1.5);
	tree(Rw + 6.4, tZ1 + 2.6, 3.4, 1.1);
	plant(bSite, xMin + 0.6, -0.02, tZ1 - 0.6, 1.1);
	plant(bSite, -0.9, -0.02, Ld + 0.7, 0.9);
	// technical canopy over the equipment on the right side wall
	box(bSite, 'metalDark', Rw, Rw + 1.0, 2.55, 2.62, 6.7, 9.9);

	// terrain disc with a soft edge so the house reads as a floating diorama
	const groundTex = radialTexture('#ffffff', '#000000');
	owned.push(groundTex);
	const lawnMat = (mats.get('lawn') as MeshStandardMaterial).clone();
	lawnMat.alphaMap = groundTex;
	lawnMat.transparent = true;
	lawnMat.depthWrite = false;
	mats.track(lawnMat);
	const disc = new Mesh(new CircleGeometry(spec.plot_radius, 72), lawnMat);
	disc.rotation.x = -Math.PI / 2;
	disc.position.set(cx, -0.08, cz);
	disc.receiveShadow = true;
	disc.renderOrder = -1;
	disc.name = 'terrain';
	site.add(disc);

	// soft contact shadow under the footprint (cheap ambient-occlusion stand-in)
	{
		const pad = 3;
		const x0 = xMin - pad;
		const z0 = -pad;
		const w = Rw - xMin + pad * 2;
		const dpt = frameFront + pad * 2;
		const px = 512 / Math.max(w, dpt);
		const c = document.createElement('canvas');
		c.width = Math.ceil(w * px);
		c.height = Math.ceil(dpt * px);
		const ctx = c.getContext('2d')!;
		ctx.fillStyle = '#000000';
		ctx.fillRect(0, 0, c.width, c.height);
		ctx.shadowColor = '#ffffff';
		ctx.shadowBlur = 0.9 * px;
		ctx.fillStyle = '#ffffff';
		const rect = (ax: number, az: number, bx: number, bz: number) =>
			ctx.fillRect(
				(ax - x0) * px,
				(az - z0) * px,
				(bx - ax) * px,
				(bz - az) * px,
			);
		rect(-Lw, 0, 0, gFront);
		rect(0, 0, Rw, Rd);
		const tex = new CanvasTexture(c);
		owned.push(tex);
		const mat = mats.track(
			new MeshBasicMaterial({
				color: '#000000',
				alphaMap: tex,
				transparent: true,
				opacity: 0.32,
				depthWrite: false,
			}),
		);
		const plane = new Mesh(new PlaneGeometry(w, dpt), mat);
		owned.push(plane.geometry);
		plane.rotation.x = -Math.PI / 2;
		plane.position.set(x0 + w / 2, -0.015, z0 + dpt / 2);
		plane.renderOrder = 0;
		plane.name = 'contact-shadow';
		site.add(plane);
	}

	// =====================================================================
	// LIGHTING FIXTURES & WASHES (exterior)
	// =====================================================================
	const wall: Vector3[] = [
		new Vector3(-0.03, 2.25, Rd - 0.35),
		new Vector3(-0.03, fh + 2.25, lbR - 0.35),
		new Vector3(gl + gw + (Rw - gl - gw) / 2, 2.2, Rd + 0.03),
	];
	const soffit: Vector3[] = [];
	for (let i = 0; i < 6; i++)
		soffit.push(
			new Vector3(
				-0.9 - i * ((Lw - 1.2) / 5),
				slabBottom - 0.01,
				(gFront + Ld) / 2,
			),
		);
	const loggia: Vector3[] = [];
	for (let i = 0; i < 4; i++)
		loggia.push(
			new Vector3(
				xMin + llm + 1.0 + i * ((-xMin - llm - 2.0) / 3),
				loggiaCeil - 0.01,
				(lb + Ld) / 2,
			),
		);
	const rightLoggia: Vector3[] = [
		new Vector3(Rw * 0.33, frameTopY - 0.01, (lbR + frameFront) / 2),
		new Vector3(Rw * 0.66, frameTopY - 0.01, (lbR + frameFront) / 2),
	];
	const bollards: Vector3[] = [];
	for (let i = 0; i < 5; i++)
		bollards.push(
			new Vector3(tX0 + 0.8 + i * ((tX1 - tX0 - 1.6) / 4), 0, tZ1 + 0.55),
		);

	const fittings: Mesh[] = [];
	const fittingMat = mats.emissive('#fff4dc');
	const downGeo = new CylinderGeometry(0.06, 0.06, 0.02, 12);
	owned.push(downGeo);
	for (const p of [...soffit, ...loggia, ...rightLoggia]) {
		const m = new Mesh(downGeo, fittingMat);
		m.position.copy(p);
		m.userData.fitting = true;
		// soffit lights hang under the first-floor slab, loggia ceilings belong to the roof slab
		(soffit.includes(p) ? first : p.y > fh + 2 ? roof : first).add(m);
		fittings.push(m);
	}
	const sconceGeo = meterBox(0.12, 0.22, 0.08);
	owned.push(sconceGeo);
	for (const p of wall) {
		const m = new Mesh(sconceGeo, fittingMat);
		m.position.copy(p);
		(p.y > fh ? first : ground).add(m);
		fittings.push(m);
	}
	const bollardGeo = new CylinderGeometry(0.07, 0.07, 0.75, 10);
	owned.push(bollardGeo);
	const bollardTopGeo = new CylinderGeometry(0.075, 0.075, 0.08, 10);
	owned.push(bollardTopGeo);
	for (const p of bollards) {
		const post = new Mesh(bollardGeo, mats.get('metalDark'));
		post.position.set(p.x, 0.375, p.z);
		post.castShadow = true;
		site.add(post);
		const top = new Mesh(bollardTopGeo, fittingMat);
		top.position.set(p.x, 0.72, p.z);
		site.add(top);
		fittings.push(top);
	}

	const washTex = gradientTexture([
		[0, 'rgba(255,255,255,1)'],
		[0.45, 'rgba(255,255,255,0.35)'],
		[1, 'rgba(255,255,255,0)'],
	]);
	owned.push(washTex);
	const washMat = (color: string) => {
		const m = new MeshBasicMaterial({
			color,
			map: washTex,
			transparent: true,
			opacity: 0,
			blending: 2,
			depthWrite: false,
			toneMapped: false,
			side: DoubleSide,
		});
		return mats.track(m);
	};
	const upperW = -xMin - llm - 0.2;
	const upperLoggia = new Mesh(
		new PlaneGeometry(upperW, loggiaCeil - slabTop - 0.1),
		washMat('#d946ef'),
	);
	upperLoggia.position.set(
		xMin + llm + 0.1 + upperW / 2,
		(slabTop + loggiaCeil) / 2,
		lb + 0.012,
	);
	upperLoggia.name = 'wash:upper_loggia';
	first.add(upperLoggia);
	const lowerW = Lw - 0.2;
	const lowerWall = new Mesh(
		new PlaneGeometry(lowerW, slabBottom - 0.1),
		washMat('#22d3ee'),
	);
	lowerWall.position.set(
		-Lw + 0.1 + lowerW / 2,
		slabBottom / 2,
		gFront + 0.012,
	);
	lowerWall.name = 'wash:lower_wall';
	ground.add(lowerWall);
	owned.push(upperLoggia.geometry, lowerWall.geometry);

	// ---- build merged meshes ----
	bSite.build(mats, site);
	bG.build(mats, groundArch);
	bF.build(mats, firstArch);
	bR.build(mats, roofArch);
	bGi.build(mats, groundInterior);
	bFi.build(mats, firstInterior);

	const offset = new Vector3(-cx, 0, -cz);
	root.position.copy(offset);

	return {
		root,
		groups: {
			site,
			ground,
			first,
			roof,
			groundArch,
			firstArch,
			roofArch,
			groundInterior,
			firstInterior,
		},
		dims: d,
		footprint: { ground: groundRects, first: firstRects },
		roofs: {
			left: {
				x: xMin + PT,
				z: PT,
				w: -xMin - PT * 1.5,
				d: Ld - 0.3 - PT,
				y: roofTop,
			},
			right: { x: PT / 2, z: PT, w: Rw - PT * 1.5, d: lbR - PT, y: roofTop },
		},
		lights: { wall, soffit, loggia, rightLoggia, bollards },
		washes: { upperLoggia, lowerWall },
		fittings,
		technical: {
			inverter: new Vector3(Rw + 0.14, 1.3, 9.0),
			battery: new Vector3(Rw + 0.38, 0, 7.85),
			grid: new Vector3(Rw + 4.6, 0, Rd - 0.4),
			board: new Vector3(Rw - T - 0.08, 1.35, 9.0),
		},
		offset,
		dispose() {
			owned.forEach((o) => o.dispose());
		},
	};
}

/**
 * Solid rectangles of a wall area [u0,u1]×[v0,v1] after removing openings.
 * Openings are clipped to the wall; overlapping openings are fine.
 */
export function solidParts(
	u0: number,
	u1: number,
	v0: number,
	v1: number,
	openings: Opening[],
): Opening[] {
	const ops = openings
		.map(
			([a, b, c, e]) =>
				[
					Math.max(u0, a),
					Math.min(u1, b),
					Math.max(v0, c),
					Math.min(v1, e),
				] as Opening,
		)
		.filter(([a, b, c, e]) => b > a && e > c);
	const cuts = new Set<number>([u0, u1]);
	for (const [a, b] of ops) {
		cuts.add(a);
		cuts.add(b);
	}
	const us = [...cuts].sort((a, b) => a - b);
	const out: Opening[] = [];
	for (let i = 0; i < us.length - 1; i++) {
		const ua = us[i];
		const ub = us[i + 1];
		if (ub - ua < 1e-6) continue;
		const covering = ops
			.filter(([a, b]) => a <= ua + 1e-6 && b >= ub - 1e-6)
			.map(([, , c, e]) => [c, e] as [number, number])
			.sort((p, q) => p[0] - q[0]);
		let v = v0;
		for (const [c, e] of covering) {
			if (c > v + 1e-6) out.push([ua, ub, v, c]);
			v = Math.max(v, e);
		}
		if (v1 > v + 1e-6) out.push([ua, ub, v, v1]);
	}
	return out;
}
