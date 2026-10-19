/**
 * Rooms and devices inside the house: pick volumes, highlight boxes, device
 * models, consumption heat tint and lighting driven by real light entities.
 */
import {
	AdditiveBlending,
	BoxGeometry,
	BufferGeometry,
	Color,
	CylinderGeometry,
	EdgesGeometry,
	Group,
	LineBasicMaterial,
	LineSegments,
	Mesh,
	MeshBasicMaterial,
	Object3D,
	PointLight,
	Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
	floorIndex,
	slug,
	type DeviceConfig,
	type RoomConfig,
	type ThreeDConfig,
} from '../config';
import type { RoomSnapshot } from '../data/energy-model';
import type { HouseModel, RectXZ } from './house-builder';
import { MaterialLibrary } from './materials';

export interface RoomVisual {
	id: string;
	floor: 0 | 1;
	rects: RectXZ[];
	y0: number;
	height: number;
	group: Group;
	fills: Mesh[];
	edges: LineSegments[];
	proxies: Mesh[];
	/** label anchor in house coordinates, floor offset applied by the floor group */
	anchor: Vector3;
	light: PointLight | null;
	lamp: Mesh | null;
	lampMat: MeshBasicMaterial | null;
	lightLevel: number;
	lightTarget: number;
	lightColor: Color;
}

export interface DeviceVisual {
	id: string;
	roomId: string;
	floor: 0 | 1;
	group: Group;
	led: MeshBasicMaterial;
	glow: Mesh;
	glowMat: MeshBasicMaterial;
	anchor: Vector3;
}

const WARM = new Color('#ffd7a0');

/** Split a rect along its longer side into n equal parts. */
function split(r: RectXZ, n: number): RectXZ[] {
	const out: RectXZ[] = [];
	for (let i = 0; i < n; i++) {
		if (r.w >= r.d)
			out.push({ x: r.x + (r.w / n) * i, z: r.z, w: r.w / n, d: r.d });
		else out.push({ x: r.x, z: r.z + (r.d / n) * i, w: r.w, d: r.d / n });
	}
	return out;
}

/** Room footprints: explicit bounds, else the whole floor, else an even split of the floor. */
export function layoutRooms(
	rooms: RoomConfig[],
	house: HouseModel,
): Map<string, RectXZ[]> {
	const out = new Map<string, RectXZ[]>();
	for (const floor of [0, 1] as const) {
		const onFloor = rooms.filter((r) => floorIndex(r.floor) === floor);
		const auto = onFloor.filter((r) => !r.bounds);
		const fp = floor === 0 ? house.footprint.ground : house.footprint.first;
		for (const r of onFloor) {
			if (r.bounds) {
				const [x, z, w, d] = r.bounds;
				out.set(r.id ?? slug(r.name), [{ x, z, w, d }]);
			}
		}
		if (auto.length === 1) {
			out.set(
				auto[0].id ?? slug(auto[0].name),
				fp.map((r) => ({ ...r })),
			);
		} else if (auto.length > 1) {
			// larger rect first; distribute rooms over the two volumes
			const rects = [...fp].sort((a, b) => b.w * b.d - a.w * a.d);
			const firstCount = Math.ceil(auto.length / 2);
			const parts = [
				...split(rects[0], firstCount),
				...(rects[1] ? split(rects[1], auto.length - firstCount) : []),
			];
			auto.forEach((r, i) =>
				out.set(r.id ?? slug(r.name), [parts[Math.min(i, parts.length - 1)]]),
			);
		}
	}
	return out;
}

export class RoomSystem {
	readonly rooms = new Map<string, RoomVisual>();
	readonly devices = new Map<string, DeviceVisual>();
	private readonly owned: { dispose(): void }[] = [];
	private highlighted: string | null = null;
	private hovered: string | null = null;
	private heat = false;
	private last: RoomSnapshot[] = [];
	private readonly accent: Color;
	private readonly tmp = new Color();

	constructor(
		three: ThreeDConfig,
		house: HouseModel,
		mats: MaterialLibrary,
		maxPointLights: number,
		accent: string,
	) {
		this.accent = new Color(accent);
		const layout = layoutRooms(three.rooms, house);
		const d = house.dims;
		const fillGeo = this.keep(new BoxGeometry(1, 1, 1));
		const edgeGeo = this.keep(new EdgesGeometry(new BoxGeometry(1, 1, 1)));
		let lightsLeft = maxPointLights;
		for (const r of three.rooms) {
			const id = r.id ?? slug(r.name);
			const floor = floorIndex(r.floor);
			const rects = layout.get(id) ?? [];
			if (!rects.length) continue;
			const y0 = floor === 0 ? 0.03 : d.fh + 0.03;
			const height = floor === 0 ? d.fh - 0.4 : d.roofTop - 0.35 - d.fh - 0.05;
			const parent = floor === 0 ? house.groups.ground : house.groups.first;
			const group = new Group();
			group.name = `room:${id}`;
			parent.add(group);
			const fills: Mesh[] = [];
			const edges: LineSegments[] = [];
			const proxies: Mesh[] = [];
			for (const rect of rects) {
				const fillMat = mats.track(
					new MeshBasicMaterial({
						color: this.accent,
						transparent: true,
						opacity: 0,
						depthWrite: false,
						toneMapped: false,
					}),
				);
				const fill = new Mesh(fillGeo, fillMat);
				fill.scale.set(rect.w - 0.06, height, rect.d - 0.06);
				fill.position.set(
					rect.x + rect.w / 2,
					y0 + height / 2,
					rect.z + rect.d / 2,
				);
				fill.visible = false;
				fill.renderOrder = 2;
				group.add(fill);
				fills.push(fill);
				const edgeMat = mats.track(
					new LineBasicMaterial({
						color: this.accent,
						transparent: true,
						opacity: 0,
						depthWrite: false,
						toneMapped: false,
					}),
				);
				const edge = new LineSegments(edgeGeo, edgeMat);
				edge.scale.copy(fill.scale);
				edge.position.copy(fill.position);
				edge.visible = false;
				edge.renderOrder = 2;
				group.add(edge);
				edges.push(edge);
				const proxy = new Mesh(fillGeo, fillMat);
				proxy.scale.copy(fill.scale);
				proxy.position.copy(fill.position);
				proxy.visible = false;
				proxy.userData.pick = `room:${id}`;
				proxy.userData.proxy = true;
				group.add(proxy);
				proxies.push(proxy);
			}
			const main = rects.reduce((a, b) => (b.w * b.d > a.w * a.d ? b : a));
			const anchor = new Vector3(
				main.x + main.w / 2,
				y0 + height * 0.82,
				main.z + main.d / 2,
			);
			let light: PointLight | null = null;
			let lamp: Mesh | null = null;
			let lampMat: MeshBasicMaterial | null = null;
			if ((r.lights ?? []).length) {
				lampMat = mats.emissive('#1a1a1a');
				lamp = new Mesh(
					this.keep(new CylinderGeometry(0.28, 0.28, 0.03, 20)),
					lampMat,
				);
				lamp.position.set(anchor.x, y0 + height - 0.03, anchor.z);
				group.add(lamp);
				if (lightsLeft > 0) {
					lightsLeft--;
					light = new PointLight(WARM, 0, Math.max(main.w, main.d) * 1.6, 2);
					light.position.set(anchor.x, y0 + height - 0.35, anchor.z);
					light.castShadow = false;
					group.add(light);
				}
			}
			this.rooms.set(id, {
				id,
				floor,
				rects,
				y0,
				height,
				group,
				fills,
				edges,
				proxies,
				anchor,
				light,
				lamp,
				lampMat,
				lightLevel: 0,
				lightTarget: 0,
				lightColor: WARM.clone(),
			});
			this.buildDevices(
				id,
				floor,
				r.devices ?? [],
				main,
				y0,
				height,
				group,
				mats,
			);
		}
	}

	private keep<T extends { dispose(): void }>(g: T): T {
		this.owned.push(g);
		return g;
	}

	private buildDevices(
		roomId: string,
		floor: 0 | 1,
		devices: DeviceConfig[],
		rect: RectXZ,
		y0: number,
		height: number,
		parent: Group,
		mats: MaterialLibrary,
	): void {
		const counters: Record<string, number> = {};
		const ledGeo = this.keep(new BoxGeometry(0.04, 0.012, 0.01));
		const glowGeo = this.keep(new CylinderGeometry(0.42, 0.42, 0.01, 28));
		devices.forEach((dev, i) => {
			const id = dev.id ?? `${roomId}_${i}`;
			const type = dev.type ?? 'appliance';
			const k = (counters[type] = (counters[type] ?? 0) + 1) - 1;
			const g = new Group();
			g.name = `device:${id}`;
			let body: Mesh;
			const cx = rect.x + rect.w / 2;
			const cz = rect.z + rect.d / 2;
			let pos: Vector3;
			let rotY = 0;
			switch (type) {
				case 'ac': {
					body = new Mesh(
						this.keep(new RoundedBoxGeometry(0.85, 0.29, 0.23, 2, 0.04)),
						mats.get('equipmentWhite'),
					);
					const slot = new Mesh(
						this.keep(new BoxGeometry(0.7, 0.025, 0.01)),
						mats.get('equipmentGrey'),
					);
					slot.position.set(0, -0.1, 0.116);
					g.add(slot);
					pos = new Vector3(
						cx + (k - 0.5) * 1.6 * Math.min(1, k),
						y0 + Math.min(2.35, height - 0.35),
						rect.z + 0.14,
					);
					break;
				}
				case 'tv': {
					body = new Mesh(
						this.keep(new BoxGeometry(1.23, 0.71, 0.035)),
						mats.get('black'),
					);
					pos = new Vector3(rect.x + 0.06, y0 + 1.25, cz + k * 1.6);
					rotY = Math.PI / 2;
					break;
				}
				case 'light': {
					body = new Mesh(
						this.keep(new CylinderGeometry(0.22, 0.22, 0.05, 18)),
						mats.get('whiteGloss'),
					);
					pos = new Vector3(cx + k * 0.9, y0 + height - 0.06, cz + 0.8);
					break;
				}
				default: {
					body = new Mesh(
						this.keep(new RoundedBoxGeometry(0.6, 0.85, 0.6, 2, 0.03)),
						mats.get('equipmentWhite'),
					);
					pos = new Vector3(
						rect.x + rect.w - 0.5 - k * 0.8,
						y0 + 0.425,
						rect.z + 0.45,
					);
				}
			}
			if (dev.position) {
				pos = new Vector3(
					cx + dev.position[0],
					y0 + dev.position[1],
					cz + dev.position[2],
				);
			}
			body.castShadow = type !== 'light';
			body.userData.pick = `device:${id}`;
			g.add(body);
			const led = mats.emissive('#475569');
			const ledMesh = new Mesh(ledGeo, led);
			ledMesh.position.set(
				type === 'ac' ? 0.33 : 0.2,
				type === 'ac' ? -0.06 : type === 'tv' ? -0.33 : 0.3,
				type === 'tv' ? 0.02 : type === 'ac' ? 0.118 : 0.302,
			);
			g.add(ledMesh);
			const glowMat = mats.track(
				new MeshBasicMaterial({
					color: this.accent,
					transparent: true,
					opacity: 0,
					blending: AdditiveBlending,
					depthWrite: false,
					toneMapped: false,
				}),
			);
			const glow = new Mesh(glowGeo, glowMat);
			glow.position.set(pos.x, y0 + 0.02, pos.z + (type === 'ac' ? 0.6 : 0));
			glow.visible = false;
			parent.add(glow);
			g.position.copy(pos);
			g.rotation.y = rotY;
			g.userData.pick = `device:${id}`;
			parent.add(g);
			this.devices.set(id, {
				id,
				roomId,
				floor,
				group: g,
				led,
				glow,
				glowMat,
				anchor: pos
					.clone()
					.add(new Vector3(0, type === 'light' ? -0.35 : 0.45, 0)),
			});
		});
	}

	pickables(floorFilter: (floor: 0 | 1) => boolean): Object3D[] {
		const out: Object3D[] = [];
		this.devices.forEach((d) => {
			if (!floorFilter(d.floor)) return;
			d.group.traverse((o) => {
				if ((o as Mesh).isMesh && o.userData.pick) out.push(o);
			});
		});
		this.rooms.forEach((r) => {
			if (floorFilter(r.floor)) out.push(...r.proxies);
		});
		return out;
	}

	setHighlight(roomId: string | null): void {
		this.highlighted = roomId;
		this.paint();
	}

	setHover(roomId: string | null): void {
		if (this.hovered === roomId) return;
		this.hovered = roomId;
		this.paint();
	}

	setHeat(enabled: boolean): void {
		this.heat = enabled;
		this.paint();
	}

	update(rooms: RoomSnapshot[]): void {
		this.last = rooms;
		for (const snap of rooms) {
			const v = this.rooms.get(snap.id);
			if (v) {
				const on = snap.lights.filter((l) => l.on);
				v.lightTarget = on.length
					? Math.max(...on.map((l) => l.brightness))
					: 0;
				const rgb = on.find((l) => l.rgb)?.rgb;
				v.lightColor.copy(
					rgb
						? this.tmp.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255)
						: WARM,
				);
			}
			for (const dev of snap.devices) {
				const dv = this.devices.get(dev.id);
				if (!dv) continue;
				dv.led.color.set(
					dev.on === true
						? '#22c55e'
						: dev.on === false
							? '#334155'
							: '#f59e0b',
				);
				const p = dev.power.available ? (dev.power.value ?? 0) : 0;
				const strength = dev.power.available ? Math.min(1, p / 1500) : 0;
				dv.glow.visible = this.heat && p > 5;
				dv.glowMat.opacity = 0.08 + 0.35 * Math.sqrt(strength);
			}
		}
		this.paint();
	}

	/** Light fades; returns true while animating. */
	animate(dt: number): boolean {
		let animating = false;
		this.rooms.forEach((v) => {
			if (!v.lampMat) return;
			const diff = v.lightTarget - v.lightLevel;
			if (Math.abs(diff) > 0.002) {
				v.lightLevel += diff * Math.min(1, dt * 4);
				animating = true;
			} else v.lightLevel = v.lightTarget;
			v.lampMat.color
				.copy(v.lightColor)
				.multiplyScalar(0.08 + 1.4 * v.lightLevel);
			if (v.light) {
				v.light.color.copy(v.lightColor);
				v.light.intensity = 18 * v.lightLevel;
			}
		});
		return animating;
	}

	private paint(): void {
		const maxPower = Math.max(
			300,
			...this.last.map((r) => (r.power.available ? (r.power.value ?? 0) : 0)),
		);
		this.rooms.forEach((v, id) => {
			const snap = this.last.find((r) => r.id === id);
			let opacity = 0;
			let edge = 0;
			const color = this.tmp.copy(this.accent);
			if (this.heat && snap?.power.available) {
				const ratio = Math.min(1, (snap.power.value ?? 0) / maxPower);
				color.setHSL(0.6 - 0.6 * ratio, 0.85, 0.55);
				opacity = 0.05 + 0.2 * ratio;
				edge = 0.35;
			}
			if (this.hovered === id) {
				opacity = Math.max(opacity, 0.08);
				edge = Math.max(edge, 0.5);
			}
			if (this.highlighted === id) {
				color.copy(this.accent);
				opacity = 0.16;
				edge = 1;
			}
			for (const f of v.fills) {
				const m = f.material as MeshBasicMaterial;
				m.color.copy(color);
				m.opacity = opacity;
				f.visible = opacity > 0;
			}
			for (const e of v.edges) {
				const m = e.material as LineBasicMaterial;
				m.color.copy(color);
				m.opacity = edge;
				e.visible = edge > 0;
			}
		});
	}

	dispose(): void {
		this.owned.forEach((o) => o.dispose());
		this.rooms.forEach((r) => r.group.parent?.remove(r.group));
		this.devices.forEach((d) => {
			d.group.parent?.remove(d.group);
			d.glow.parent?.remove(d.glow);
		});
		this.rooms.clear();
		this.devices.clear();
	}
}

export type { BufferGeometry };
