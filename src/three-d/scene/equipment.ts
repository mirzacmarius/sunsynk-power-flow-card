/**
 * Technical equipment: Solis hybrid inverter, Dyness tower battery(ies), the grid
 * connection point (meter pillar) and the house distribution board.
 *
 * Placement defaults to the right volume's side wall and is configurable in house
 * coordinates (three_d.inverter.position, three_d.battery.position, three_d.grid.position).
 */
import {
	AdditiveBlending,
	BoxGeometry,
	BufferGeometry,
	CanvasTexture,
	Color,
	CylinderGeometry,
	DoubleSide,
	Group,
	InstancedMesh,
	Matrix4,
	Mesh,
	MeshBasicMaterial,
	Object3D,
	PlaneGeometry,
	SphereGeometry,
	SRGBColorSpace,
	TorusGeometry,
	Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { FlowColors, ThreeDConfig } from '../config';
import type { EnergySnapshot } from '../data/energy-model';
import type { HouseModel } from './house-builder';
import { MaterialLibrary } from './materials';

export interface EquipmentAnchors {
	pvIn: Vector3[];
	inverterBattery: Vector3;
	inverterGrid: Vector3;
	inverterHome: Vector3;
	inverterCenter: Vector3;
	batteryPorts: Vector3[];
	batteryCenters: Vector3[];
	gridPort: Vector3;
	gridCenter: Vector3;
	boardIn: Vector3;
	boardCenter: Vector3;
}

const STATUS_COLORS: Record<string, string> = {
	normal: '#22c55e',
	standby: '#3b82f6',
	alarm: '#ef4444',
	selftest: '#a855f7',
	unknown: '#64748b',
};

function textTexture(
	text: string,
	w = 512,
	h = 96,
	color = '#5b6470',
): CanvasTexture {
	const c = document.createElement('canvas');
	c.width = w;
	c.height = h;
	const ctx = c.getContext('2d')!;
	ctx.clearRect(0, 0, w, h);
	ctx.fillStyle = color;
	ctx.font = `600 ${Math.round(h * 0.52)}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText(text, w / 2, h / 2);
	const t = new CanvasTexture(c);
	t.colorSpace = SRGBColorSpace;
	return t;
}

export class Equipment {
	readonly group = new Group();
	readonly inverter = new Group();
	readonly batteries: Group[] = [];
	readonly grid = new Group();
	readonly board = new Group();
	readonly anchors: EquipmentAnchors;
	private readonly owned: { dispose(): void }[] = [];
	private readonly led: MeshBasicMaterial;
	private readonly haloMat: MeshBasicMaterial;
	private readonly halo: Mesh;
	private readonly lampMat: MeshBasicMaterial;
	private readonly socBars: InstancedMesh[] = [];
	private readonly socState: {
		soc: number | null;
		state: string;
		ratio: number;
	}[] = [];
	private readonly segments = 10;
	private fault = false;
	private statusColor = new Color(STATUS_COLORS.unknown);
	private readonly tmpColor = new Color();

	constructor(
		three: ThreeDConfig,
		house: HouseModel,
		mats: MaterialLibrary,
		private readonly colors: FlowColors,
		batteryCount: number,
		batteryCapacityWh: number | null,
	) {
		this.group.name = 'equipment';
		const white = mats.get('equipmentWhite');
		const grey = mats.get('equipmentGrey');
		const dark = mats.get('metalDark');
		const display = mats.get('display');
		const geo = <T extends BufferGeometry>(g: T): T => {
			this.owned.push(g);
			return g;
		};

		// ---------------- inverter (local: faces +z, origin at body centre) ----------------
		const body = new Mesh(
			geo(new RoundedBoxGeometry(0.55, 0.64, 0.23, 3, 0.03)),
			white,
		);
		body.castShadow = true;
		body.receiveShadow = true;
		this.inverter.add(body);
		const bracket = new Mesh(geo(new BoxGeometry(0.46, 0.5, 0.03)), dark);
		bracket.position.set(0, 0, -0.13);
		this.inverter.add(bracket);
		const screen = new Mesh(geo(new BoxGeometry(0.36, 0.11, 0.012)), display);
		screen.position.set(0, 0.17, 0.117);
		this.inverter.add(screen);
		this.led = mats.emissive(STATUS_COLORS.unknown);
		const ledBar = new Mesh(geo(new BoxGeometry(0.28, 0.014, 0.008)), this.led);
		ledBar.position.set(0, 0.075, 0.119);
		this.inverter.add(ledBar);
		// vertical heatsink plates on both sides
		const finGeo = geo(new BoxGeometry(0.03, 0.5, 0.008));
		for (let i = 0; i < 6; i++) {
			for (const side of [-1, 1]) {
				const fin = new Mesh(finGeo, grey);
				fin.position.set(side * 0.29, -0.02, -0.085 + i * 0.032);
				this.inverter.add(fin);
			}
		}
		const glandGeo = geo(new CylinderGeometry(0.014, 0.014, 0.045, 10));
		for (let i = 0; i < 8; i++) {
			const g = new Mesh(glandGeo, i < 4 ? dark : grey);
			g.position.set(-0.22 + i * 0.063, -0.34, 0.02);
			this.inverter.add(g);
		}
		const labelTex = textTexture(
			three.inverter.model_name.replace(/^Solis\s+/i, ''),
		);
		this.owned.push(labelTex);
		const label = new Mesh(
			geo(new PlaneGeometry(0.34, 0.064)),
			mats.track(
				new MeshBasicMaterial({
					map: labelTex,
					transparent: true,
					depthWrite: false,
				}),
			),
		);
		label.position.set(0, -0.06, 0.1165);
		this.inverter.add(label);
		const brandTex = textTexture(
			three.inverter.model_name.split(/\s+/)[0].toUpperCase(),
			256,
			64,
			'#2a3340',
		);
		this.owned.push(brandTex);
		const brand = new Mesh(
			geo(new PlaneGeometry(0.14, 0.035)),
			mats.track(
				new MeshBasicMaterial({
					map: brandTex,
					transparent: true,
					depthWrite: false,
				}),
			),
		);
		brand.position.set(0, 0.255, 0.1165);
		this.inverter.add(brand);
		// fault halo
		this.haloMat = mats.track(
			new MeshBasicMaterial({
				color: colors.fault,
				transparent: true,
				opacity: 0,
				blending: AdditiveBlending,
				depthWrite: false,
				toneMapped: false,
				side: DoubleSide,
			}),
		);
		this.halo = new Mesh(
			geo(new TorusGeometry(0.5, 0.025, 8, 48)),
			this.haloMat,
		);
		this.halo.visible = false;
		this.inverter.add(this.halo);
		this.inverter.userData.pick = 'inverter';
		body.userData.pick = 'inverter';

		const invPos = three.inverter.position
			? new Vector3(...three.inverter.position)
			: house.technical.inverter.clone();
		this.inverter.position.copy(invPos);
		this.inverter.rotation.y =
			Math.PI / 2 + (three.inverter.rotation * Math.PI) / 180;
		this.inverter.name = 'inverter';
		this.group.add(this.inverter);

		// ---------------- batteries (local: faces +z, origin on the floor) ----------------
		const modulesSetting = three.battery.modules;
		const modules =
			modulesSetting === 'auto'
				? batteryCapacityWh
					? Math.max(2, Math.min(8, Math.round(batteryCapacityWh / 5120)))
					: 4
				: modulesSetting;
		const modH = 0.2;
		const stackH = 0.1 + modules * (modH + 0.01) + 0.24;
		const basePos = three.battery.position
			? new Vector3(...three.battery.position)
			: house.technical.battery.clone();
		const plinthGeo = geo(new BoxGeometry(0.62, 0.1, 0.36));
		const modGeo = geo(new RoundedBoxGeometry(0.6, modH, 0.34, 2, 0.012));
		const bduGeo = geo(new RoundedBoxGeometry(0.6, 0.22, 0.34, 2, 0.015));
		const panelGeo = geo(new BoxGeometry(0.4, 0.08, 0.008));
		const btnGeo = geo(new CylinderGeometry(0.018, 0.018, 0.01, 16));
		const segH = (modules * (modH + 0.01) - 0.04) / this.segments;
		const segGeo = geo(new BoxGeometry(0.035, segH * 0.72, 0.006));
		for (let b = 0; b < Math.max(1, batteryCount); b++) {
			const tower = new Group();
			const plinth = new Mesh(plinthGeo, dark);
			plinth.position.y = 0.05;
			plinth.castShadow = true;
			tower.add(plinth);
			for (let i = 0; i < modules; i++) {
				const m = new Mesh(modGeo, white);
				m.position.y = 0.1 + modH / 2 + i * (modH + 0.01);
				m.castShadow = true;
				m.receiveShadow = true;
				m.userData.pick = `battery:${b + 1}`;
				tower.add(m);
			}
			const bdu = new Mesh(bduGeo, mats.get('kitchen'));
			bdu.position.y = stackH - 0.12;
			bdu.castShadow = true;
			bdu.userData.pick = `battery:${b + 1}`;
			tower.add(bdu);
			const panel = new Mesh(panelGeo, display);
			panel.position.set(-0.04, stackH - 0.12, 0.172);
			tower.add(panel);
			const btn = new Mesh(btnGeo, this.led);
			btn.rotation.x = Math.PI / 2;
			btn.position.set(0.22, stackH - 0.12, 0.172);
			tower.add(btn);
			const segMat = mats.track(
				new MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
			);
			const bar = new InstancedMesh(segGeo, segMat, this.segments);
			for (let i = 0; i < this.segments; i++) {
				const y = 0.1 + 0.02 + segH * (i + 0.5);
				bar.setMatrixAt(i, new Matrix4().setPosition(0.24, y, 0.174));
				bar.setColorAt(i, new Color(0.08, 0.09, 0.1));
			}
			bar.instanceMatrix.needsUpdate = true;
			if (bar.instanceColor) bar.instanceColor.needsUpdate = true;
			tower.add(bar);
			this.socBars.push(bar);
			this.socState.push({ soc: null, state: 'unavailable', ratio: 0 });
			tower.position.copy(basePos).add(new Vector3(0, 0, -b * 0.72));
			tower.rotation.y = Math.PI / 2 + (three.battery.rotation * Math.PI) / 180;
			tower.userData.pick = `battery:${b + 1}`;
			tower.userData.height = stackH;
			tower.name = `battery${b + 1}`;
			this.batteries.push(tower);
			this.group.add(tower);
		}

		// ---------------- grid connection point (meter pillar) ----------------
		const pillar = new Mesh(
			geo(new BoxGeometry(0.7, 1.55, 0.42)),
			mats.get('concrete'),
		);
		pillar.position.y = 0.775;
		pillar.castShadow = true;
		pillar.receiveShadow = true;
		pillar.userData.pick = 'grid';
		this.grid.add(pillar);
		const door = new Mesh(geo(new BoxGeometry(0.52, 0.62, 0.02)), grey);
		door.position.set(0, 1.05, 0.215);
		door.userData.pick = 'grid';
		this.grid.add(door);
		const meterWin = new Mesh(geo(new BoxGeometry(0.16, 0.1, 0.01)), display);
		meterWin.position.set(-0.1, 1.18, 0.227);
		this.grid.add(meterWin);
		const cap = new Mesh(
			geo(new BoxGeometry(0.8, 0.06, 0.52)),
			mats.get('coping'),
		);
		cap.position.y = 1.58;
		this.grid.add(cap);
		this.lampMat = mats.emissive('#64748b');
		const lamp = new Mesh(geo(new SphereGeometry(0.035, 12, 10)), this.lampMat);
		lamp.position.set(0.17, 1.2, 0.235);
		this.grid.add(lamp);
		const gridPos = three.grid.position
			? new Vector3(...three.grid.position)
			: house.technical.grid.clone();
		this.grid.position.copy(gridPos);
		this.grid.rotation.y = -Math.PI / 2;
		this.grid.userData.pick = 'grid';
		this.grid.name = 'grid';
		this.group.add(this.grid);

		// ---------------- distribution board inside the house ----------------
		const boardBox = new Mesh(
			geo(new RoundedBoxGeometry(0.42, 0.56, 0.12, 2, 0.01)),
			white,
		);
		boardBox.castShadow = true;
		boardBox.userData.pick = 'home';
		this.board.add(boardBox);
		const boardSeam = new Mesh(geo(new BoxGeometry(0.004, 0.5, 0.004)), grey);
		boardSeam.position.set(0, 0, 0.062);
		this.board.add(boardSeam);
		this.board.position.copy(house.technical.board);
		this.board.rotation.y = -Math.PI / 2;
		this.board.userData.pick = 'home';
		this.board.name = 'board';
		house.groups.groundInterior.parent!.add(this.board);

		// ---------------- anchors (house coordinates) ----------------
		this.group.updateMatrixWorld(true);
		this.board.updateMatrixWorld(true);
		const toHouse = (obj: Object3D, local: Vector3) => {
			const m = new Matrix4().compose(obj.position, obj.quaternion, obj.scale);
			return local.clone().applyMatrix4(m);
		};
		const mpptCount = Math.max(1, three.solar.mppts.length);
		const pvIn: Vector3[] = [];
		for (let i = 0; i < mpptCount; i++) {
			pvIn.push(
				toHouse(
					this.inverter,
					new Vector3(
						-0.19 + (0.38 * i) / Math.max(1, mpptCount - 1),
						0.33,
						0.02,
					),
				),
			);
		}
		this.anchors = {
			pvIn,
			inverterBattery: toHouse(this.inverter, new Vector3(-0.2, -0.35, 0.04)),
			inverterGrid: toHouse(this.inverter, new Vector3(0.2, -0.35, 0.04)),
			inverterHome: toHouse(this.inverter, new Vector3(0.02, -0.35, -0.06)),
			inverterCenter: toHouse(this.inverter, new Vector3(0, 0, 0.12)),
			batteryPorts: this.batteries.map((t) =>
				toHouse(
					t,
					new Vector3(0.18, (t.userData.height as number) - 0.02, -0.08),
				),
			),
			batteryCenters: this.batteries.map((t) =>
				toHouse(t, new Vector3(0, (t.userData.height as number) / 2, 0.18)),
			),
			gridPort: toHouse(this.grid, new Vector3(0, 0.04, 0.22)),
			gridCenter: toHouse(this.grid, new Vector3(0, 1.0, 0.25)),
			boardIn: toHouse(this.board, new Vector3(0, -0.29, 0)),
			boardCenter: toHouse(this.board, new Vector3(0, 0, 0.07)),
		};
	}

	pickables(): Object3D[] {
		const out: Object3D[] = [];
		const add = (g: Object3D) =>
			g.traverse((o) => {
				if ((o as Mesh).isMesh && o.userData.pick) out.push(o);
			});
		add(this.inverter);
		this.batteries.forEach(add);
		add(this.grid);
		add(this.board);
		return out;
	}

	update(snapshot: EnergySnapshot): void {
		const cat = snapshot.inverter.status.category;
		this.statusColor.set(STATUS_COLORS[cat] ?? STATUS_COLORS.unknown);
		this.led.color.copy(this.statusColor);
		this.fault = snapshot.inverter.fault;
		this.halo.visible = this.fault;
		const conn = snapshot.grid.connection;
		this.lampMat.color.set(
			conn === 'connected'
				? '#22c55e'
				: conn === 'disconnected'
					? this.colors.fault
					: '#f59e0b',
		);
		snapshot.batteries.forEach((b, i) => {
			if (!this.socState[i]) return;
			const flow = snapshot.flows.find((f) => f.id === 'battery');
			this.socState[i] = {
				soc: b.soc.available ? (b.soc.value ?? null) : null,
				state: b.state,
				ratio: flow?.ratio ?? 0,
			};
		});
		this.paintSoc(0, true);
	}

	/** Per-frame animation; returns true while something animates. */
	animate(time: number, reducedMotion: boolean): boolean {
		let animating = false;
		if (this.fault) {
			this.haloMat.opacity = reducedMotion
				? 0.6
				: 0.35 + 0.35 * Math.sin(time * 5);
			this.led.color
				.copy(this.statusColor)
				.multiplyScalar(
					reducedMotion ? 1 : 0.5 + 0.5 * (Math.sin(time * 6) > 0 ? 1 : 0.2),
				);
			animating = !reducedMotion;
		}
		if (
			!reducedMotion &&
			this.socState.some(
				(s) => s.state === 'charging' || s.state === 'discharging',
			)
		) {
			this.paintSoc(time, false);
			animating = true;
		}
		return animating;
	}

	private paintSoc(time: number, staticOnly: boolean): void {
		this.socBars.forEach((bar, i) => {
			const s = this.socState[i];
			const lit =
				s.soc === null
					? 0
					: Math.max(
							0,
							Math.min(this.segments, Math.ceil(s.soc / (100 / this.segments))),
						);
			const base =
				s.soc === null
					? null
					: s.soc <= 15
						? new Color(this.colors.fault)
						: s.soc <= 35
							? new Color('#f59e0b')
							: new Color(
									s.state === 'discharging'
										? this.colors.battery_discharge
										: this.colors.battery_charge,
								);
			const speed = 0.6 + 1.8 * s.ratio;
			const phase = (time * speed) % 1;
			const dir =
				s.state === 'charging' ? 1 : s.state === 'discharging' ? -1 : 0;
			for (let k = 0; k < this.segments; k++) {
				if (!base || k >= lit) {
					bar.setColorAt(k, this.tmpColor.setRGB(0.07, 0.08, 0.09));
					continue;
				}
				let intensity = 0.85;
				if (!staticOnly && dir !== 0 && lit > 0) {
					const pos = dir > 0 ? phase * lit : (1 - phase) * lit;
					const dist = Math.abs(k + 0.5 - pos);
					intensity = 0.65 + 0.9 * Math.max(0, 1 - dist / 1.4);
				}
				bar.setColorAt(k, this.tmpColor.copy(base).multiplyScalar(intensity));
			}
			if (bar.instanceColor) bar.instanceColor.needsUpdate = true;
		});
	}

	dispose(): void {
		this.owned.forEach((o) => o.dispose());
		this.socBars.forEach((b) => b.dispose());
		this.board.parent?.remove(this.board);
	}
}
