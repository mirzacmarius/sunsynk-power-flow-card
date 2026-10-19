/**
 * Solar panels on configurable flat-roof surfaces, grouped by MPPT.
 *
 * Every panel is its own instance (pickable and individually tinted), but panels
 * never get values of their own: they display their MPPT's readings.
 */
import {
	AdditiveBlending,
	BoxGeometry,
	BufferGeometry,
	Color,
	Group,
	InstancedMesh,
	Matrix4,
	Mesh,
	MeshBasicMaterial,
	MeshStandardMaterial,
	Object3D,
	PlaneGeometry,
	Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SurfaceConfig, ThreeDConfig } from '../config';
import type { MpptSnapshot } from '../data/energy-model';
import type { HouseModel } from './house-builder';
import { MaterialLibrary } from './materials';

/** Compass azimuth (deg) → horizontal unit vector in house coordinates. */
export function azimuthVector(azimuth: number, facadeAzimuth: number): Vector3 {
	const a = ((facadeAzimuth - azimuth) * Math.PI) / 180;
	return new Vector3(Math.sin(a), 0, Math.cos(a));
}

export interface MpptGroup {
	id: number;
	surfaceId: string;
	frames: InstancedMesh;
	cells: InstancedMesh;
	overlay: InstancedMesh;
	count: number;
	/** house-space centre of the string, for labels and camera focus */
	center: Vector3;
	/** low-edge point of the panel closest to the technical area (cable exit) */
	cableStart: Vector3;
	/** panel centres (house space) */
	positions: Vector3[];
}

const WHITE = new Color(1, 1, 1);
const BLACK = new Color(0, 0, 0);

export class SolarArray {
	readonly group = new Group();
	readonly mppts = new Map<number, MpptGroup>();
	private readonly cellMat: MeshStandardMaterial;
	private readonly frameMat: MeshStandardMaterial;
	private readonly overlayMat: MeshBasicMaterial;
	private rackMat: MeshStandardMaterial | null = null;
	private readonly geometries: BufferGeometry[] = [];
	private highlighted: number | null = null;
	private hovered: number | null = null;
	private overlay = false;
	private lastMppts: MpptSnapshot[] = [];
	private ghost = false;

	constructor(
		private readonly three: ThreeDConfig,
		house: HouseModel,
		mats: MaterialLibrary,
		private readonly colors: { solar: string; fault: string },
	) {
		this.group.name = 'solar';
		this.cellMat = mats.track(
			(mats.get('panel') as MeshStandardMaterial).clone(),
		);
		this.frameMat = mats.track(
			(mats.get('panelFrame') as MeshStandardMaterial).clone(),
		);
		this.overlayMat = mats.track(
			new MeshBasicMaterial({
				color: 0xffffff,
				transparent: true,
				blending: AdditiveBlending,
				depthWrite: false,
				toneMapped: false,
			}),
		);
		const rackMat = mats.track(
			(mats.get('rack') as MeshStandardMaterial).clone(),
		);
		this.rackMat = rackMat;
		const p = three.solar.panel;
		const facade = three.compass.facade_azimuth;
		const tech = house.technical.inverter;

		const rackGeos: BufferGeometry[] = [];
		const cursors = new Map<string, number>();
		for (const surface of three.solar.surfaces) {
			const slots = this.slotMatrices(surface, house, facade, rackGeos);
			const mpptsHere = three.solar.mppts.filter(
				(m) => m.surface === surface.id,
			);
			cursors.set(surface.id, 0);
			for (const m of mpptsHere) {
				const start = m.start ?? cursors.get(surface.id)!;
				const end = Math.min(slots.length, start + m.panels);
				cursors.set(surface.id, start + m.panels);
				const chosen = slots.slice(start, end);
				if (!chosen.length) continue;
				const [w, l] =
					surface.orientation === 'portrait'
						? [p.width, p.height]
						: [p.height, p.width];
				const frameGeo = new BoxGeometry(w, l, p.thickness);
				const cellGeo = new PlaneGeometry(w - 0.035, l - 0.035);
				cellGeo.translate(0, 0, p.thickness / 2 + 0.0015);
				const overlayGeo = new PlaneGeometry(w - 0.02, l - 0.02);
				overlayGeo.translate(0, 0, p.thickness / 2 + 0.006);
				this.geometries.push(frameGeo, cellGeo, overlayGeo);
				const frames = new InstancedMesh(
					frameGeo,
					this.frameMat,
					chosen.length,
				);
				const cells = new InstancedMesh(cellGeo, this.cellMat, chosen.length);
				const overlay = new InstancedMesh(
					overlayGeo,
					this.overlayMat,
					chosen.length,
				);
				frames.castShadow = true;
				frames.receiveShadow = true;
				cells.receiveShadow = true;
				const positions: Vector3[] = [];
				let best: { score: number; point: Vector3 } | null = null;
				chosen.forEach((slot, i) => {
					frames.setMatrixAt(i, slot.matrix);
					cells.setMatrixAt(i, slot.matrix);
					overlay.setMatrixAt(i, slot.matrix);
					cells.setColorAt(i, WHITE);
					overlay.setColorAt(i, BLACK);
					positions.push(slot.center);
					const score = -slot.lowEdge.distanceTo(
						new Vector3(tech.x, slot.lowEdge.y, tech.z),
					);
					if (!best || score > best.score)
						best = { score, point: slot.lowEdge.clone() };
				});
				for (const mesh of [frames, cells, overlay]) {
					mesh.instanceMatrix.needsUpdate = true;
					if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
					mesh.userData.mpptId = m.id;
					mesh.computeBoundingSphere();
					mesh.computeBoundingBox();
				}
				overlay.renderOrder = 3;
				frames.name = `mppt${m.id}:frames`;
				cells.name = `mppt${m.id}:cells`;
				this.group.add(frames, cells, overlay);
				const center = positions
					.reduce((acc, v) => acc.add(v), new Vector3())
					.divideScalar(positions.length);
				this.mppts.set(m.id, {
					id: m.id,
					surfaceId: surface.id,
					frames,
					cells,
					overlay,
					count: chosen.length,
					center,
					cableStart:
						(best as { point: Vector3 } | null)?.point ?? center.clone(),
					positions,
				});
			}
		}
		if (rackGeos.length) {
			const merged = mergeGeometries(rackGeos, false);
			rackGeos.forEach((g) => g.dispose());
			if (merged) {
				this.geometries.push(merged);
				const racks = new Mesh(merged, rackMat);
				racks.castShadow = true;
				racks.name = 'solar:racks';
				this.group.add(racks);
			}
		}
	}

	private slotMatrices(
		s: SurfaceConfig,
		house: HouseModel,
		facade: number,
		rackGeos: BufferGeometry[],
	): { matrix: Matrix4; center: Vector3; lowEdge: Vector3 }[] {
		const roof = house.roofs[s.roof];
		const p = this.three.solar.panel;
		const [w, l] =
			s.orientation === 'portrait' ? [p.width, p.height] : [p.height, p.width];
		const t = (s.tilt * Math.PI) / 180;
		const f = azimuthVector(s.azimuth, facade);
		const up = new Vector3(0, 1, 0);
		const r = new Vector3().crossVectors(up, f).normalize();
		const n = up
			.clone()
			.multiplyScalar(Math.cos(t))
			.addScaledVector(f, Math.sin(t))
			.normalize();
		const slope = up
			.clone()
			.multiplyScalar(Math.sin(t))
			.addScaledVector(f, -Math.cos(t))
			.normalize();
		const spacing =
			s.row_spacing ?? l * Math.cos(t) + Math.max(0.4, 2.0 * l * Math.sin(t));
		const center = new Vector3(
			roof.x + roof.w / 2 + s.offset[0],
			roof.y,
			roof.z + roof.d / 2 + s.offset[1],
		);
		const height = s.mount_height + (l / 2) * Math.sin(t);
		const out: { matrix: Matrix4; center: Vector3; lowEdge: Vector3 }[] = [];
		for (let row = 0; row < s.rows; row++) {
			const along = (row - (s.rows - 1) / 2) * spacing;
			const rowCenter = center.clone().addScaledVector(f, -along);
			for (let col = 0; col < s.columns; col++) {
				const across = (col - (s.columns - 1) / 2) * (w + s.column_gap);
				const c = rowCenter.clone().addScaledVector(r, across);
				c.y = roof.y + height;
				const m = new Matrix4().makeBasis(r, slope, n).setPosition(c);
				const lowEdge = c.clone().addScaledVector(slope, -l / 2);
				out.push({ matrix: m, center: c, lowEdge });
			}
			// rails and legs for the row
			const rowLen = s.columns * (w + s.column_gap);
			for (const edge of [-1, 1]) {
				const edgeCenter = rowCenter
					.clone()
					.addScaledVector(
						slope.clone().setY(0).normalize(),
						((edge * l * Math.cos(t)) / 2) * 0.8,
					);
				const legH = s.mount_height + (edge > 0 ? l * Math.sin(t) * 0.9 : 0.05);
				const rail = new BoxGeometry(rowLen, 0.04, 0.05);
				const basis = new Matrix4().makeBasis(
					r,
					up,
					new Vector3().crossVectors(r, up),
				);
				rail.applyMatrix4(
					basis.clone().setPosition(edgeCenter.x, roof.y + legH, edgeCenter.z),
				);
				rackGeos.push(rail);
				for (let k = 0; k <= s.columns; k += 2) {
					const across = (k - s.columns / 2) * (w + s.column_gap);
					const lp = edgeCenter.clone().addScaledVector(r, across);
					const leg = new BoxGeometry(0.04, legH, 0.04);
					leg.translate(lp.x, roof.y + legH / 2, lp.z);
					rackGeos.push(leg);
				}
			}
		}
		return out;
	}

	pickables(): Object3D[] {
		const out: Object3D[] = [];
		this.mppts.forEach((m) => out.push(m.cells, m.frames));
		return out;
	}

	setHighlight(id: number | null): void {
		this.highlighted = id;
		this.refresh();
	}

	setHover(id: number | null): void {
		if (this.hovered === id) return;
		this.hovered = id;
		this.refresh();
	}

	setOverlay(enabled: boolean, mppts: MpptSnapshot[]): void {
		this.overlay = enabled;
		this.lastMppts = mppts;
		this.refresh();
	}

	updateData(mppts: MpptSnapshot[]): void {
		this.lastMppts = mppts;
		if (this.overlay) this.refresh();
	}

	setGhost(ghost: boolean): void {
		if (this.ghost === ghost) return;
		this.ghost = ghost;
		for (const m of [this.cellMat, this.frameMat, this.rackMat]) {
			if (!m) continue;
			m.transparent = ghost;
			m.opacity = ghost ? (m === this.rackMat ? 0.12 : 0.22) : 1;
			m.depthWrite = !ghost;
			m.needsUpdate = true;
		}
	}

	private refresh(): void {
		const solar = new Color(this.colors.solar);
		const fault = new Color(this.colors.fault);
		const tmp = new Color();
		this.mppts.forEach((g, id) => {
			const snap = this.lastMppts.find((m) => m.id === id);
			const dim = this.highlighted !== null && this.highlighted !== id;
			let overlayColor = BLACK;
			if (this.highlighted === id) {
				overlayColor = tmp.copy(solar).multiplyScalar(0.42);
			} else if (this.hovered === id) {
				overlayColor = tmp.copy(solar).multiplyScalar(0.22);
			} else if (this.overlay && snap) {
				if (snap.status === 'unavailable')
					overlayColor = tmp.setRGB(0.12, 0.12, 0.14);
				else if (snap.status === 'inactive' || snap.status === 'no_voltage')
					overlayColor = tmp.copy(fault).multiplyScalar(0.45);
				else if (snap.status === 'underperforming')
					overlayColor = tmp.setRGB(0.42, 0.17, 0.0);
				else {
					const ratio = Math.max(
						0,
						Math.min(1, snap.efficiency ?? snap.share ?? 0),
					);
					overlayColor = tmp.copy(solar).multiplyScalar(0.06 + 0.3 * ratio);
				}
			}
			for (let i = 0; i < g.count; i++) {
				g.overlay.setColorAt(i, overlayColor);
				g.cells.setColorAt(i, dim ? tmp.setRGB(0.45, 0.45, 0.5) : WHITE);
			}
			if (g.overlay.instanceColor) g.overlay.instanceColor.needsUpdate = true;
			if (g.cells.instanceColor) g.cells.instanceColor.needsUpdate = true;
		});
	}

	dispose(): void {
		this.geometries.forEach((g) => g.dispose());
		this.mppts.forEach((m) => {
			m.frames.dispose();
			m.cells.dispose();
			m.overlay.dispose();
		});
		this.mppts.clear();
	}
}
