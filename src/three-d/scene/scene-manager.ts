/**
 * Owns the WebGL renderer, scene graph, camera, controls and render loop.
 *
 * - Builds the static scene once per structural config; live data only changes
 *   uniforms, colours and visibility (`applySnapshot`).
 * - Renders on demand; runs continuously only while something animates, capped
 *   to `max_fps` (or `idle_fps` after `idle_timeout` without interaction).
 * - Pauses when the card is off-screen or the tab is hidden.
 * - `dispose()` releases every GPU resource, observer and listener.
 */
import {
	ACESFilmicToneMapping,
	Box3,
	Group,
	Mesh,
	Material,
	Object3D,
	PCFShadowMap,
	PerspectiveCamera,
	Scene,
	Vector3,
	WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type {
	CameraViewId,
	FloorId,
	PresetId,
	Quality,
	ThreeDConfig,
} from '../config';
import type { EnergySnapshot, FlowSnapshot } from '../data/energy-model';
import { CameraRig, Pose } from './camera-rig';
import { disposeObject } from './dispose';
import { EnvironmentRig } from './environment';
import { Equipment } from './equipment';
import { FlowRoute, FlowSystem } from './flows';
import { loadHouseModel } from './gltf';
import { buildHouse, HouseModel } from './house-builder';
import {
	Interaction,
	PickResult,
	PointerInfo,
	SelectionBox,
} from './interaction';
import { MaterialLibrary } from './materials';
import { RoomSystem } from './rooms';
import { SolarArray } from './solar-array';

export interface ProjectedLabel {
	id: string;
	x: number;
	y: number;
	visible: boolean;
}

export interface SceneCallbacks {
	onHover(id: string | null, pointer: PointerInfo | null): void;
	onSelect(id: string | null, double: boolean): void;
	onLabels(labels: ProjectedLabel[]): void;
	onStatus(status: SceneStatus): void;
}

export interface SceneStatus {
	quality: Exclude<Quality, 'auto'>;
	renderer?: string;
	modelError?: string;
	modelLoaded?: boolean;
	contextLost?: boolean;
}

export interface SceneState {
	floor: FloorId | null;
	roof: boolean;
	exploded: boolean;
	night: boolean | null;
	overlay: boolean;
	heat: boolean;
	deviceFlows: boolean;
	focus: string[] | null;
	reducedMotion: boolean;
	labels: string[];
	selected: string | null;
	hovered: string | null;
}

export interface SceneInit {
	reducedMotion: boolean;
	batteryCount: number;
	batteryCapacityWh: number | null;
	hasNonessential: boolean;
}

const QUALITY = {
	low: {
		pixelRatio: 1,
		shadows: false,
		shadowMap: 512,
		exteriorLights: 0,
		roomLights: 0,
		particles: 14,
		antialias: false,
	},
	medium: {
		pixelRatio: 1.5,
		shadows: true,
		shadowMap: 1024,
		exteriorLights: 3,
		roomLights: 3,
		particles: 26,
		antialias: true,
	},
	high: {
		pixelRatio: 2,
		shadows: true,
		shadowMap: 2048,
		exteriorLights: 6,
		roomLights: 6,
		particles: 40,
		antialias: true,
	},
};

const ACCENT = '#7dd3fc';

function detectQuality(gl: WebGLRenderingContext | WebGL2RenderingContext): {
	quality: Exclude<Quality, 'auto'>;
	renderer: string;
} {
	let renderer = '';
	try {
		const ext = gl.getExtension('WEBGL_debug_renderer_info');
		renderer = ext
			? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL))
			: String(gl.getParameter(gl.RENDERER));
	} catch {
		/* ignore */
	}
	if (/swiftshader|llvmpipe|software|basic render/i.test(renderer))
		return { quality: 'low', renderer };
	const coarse =
		typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
	const cores = navigator.hardwareConcurrency ?? 4;
	if (coarse || cores <= 4) return { quality: 'medium', renderer };
	return { quality: 'high', renderer };
}

export class SceneManager {
	readonly renderer: WebGLRenderer;
	readonly scene = new Scene();
	readonly camera: PerspectiveCamera;
	readonly controls: OrbitControls;
	readonly quality: Exclude<Quality, 'auto'>;
	private readonly preset: (typeof QUALITY)['high'];
	private mats!: MaterialLibrary;
	private house!: HouseModel;
	private solar!: SolarArray;
	private equipment!: Equipment;
	private rooms!: RoomSystem;
	private flows!: FlowSystem;
	private env!: EnvironmentRig;
	private selection!: SelectionBox;
	private rig!: CameraRig;
	private interaction: Interaction;
	private customModel: Group | null = null;
	private modelAbort: AbortController | null = null;
	private snapshot: EnergySnapshot | null = null;
	private deviceFlowIds: string[] = [];
	private anchors = new Map<string, { obj: Object3D; local: Vector3 }>();
	private state: SceneState;
	private width = 1;
	private height = 1;
	private raf = 0;
	private running = false;
	private visible = true;
	private needsRender = true;
	private lastFrame = 0;
	private lastInteraction = performance.now();
	private explode = { value: 0, target: 0, from: 0, start: 0 };
	private disposed = false;
	private readonly io: IntersectionObserver;
	private readonly onVisibility = () => this.updateActive();
	private readonly onContextLost = (e: Event) => {
		e.preventDefault();
		this.stop();
		this.cb.onStatus({ quality: this.quality, contextLost: true });
	};
	private readonly onContextRestored = () => {
		this.rebuild(this.three);
		this.cb.onStatus({ quality: this.quality, contextLost: false });
	};

	constructor(
		private readonly container: HTMLElement,
		private three: ThreeDConfig,
		private readonly cb: SceneCallbacks,
		private readonly init: SceneInit,
	) {
		const probe =
			document.createElement('canvas').getContext('webgl2') ??
			document.createElement('canvas').getContext('webgl');
		const auto = probe
			? detectQuality(probe)
			: { quality: 'low' as const, renderer: '' };
		probe?.getExtension('WEBGL_lose_context')?.loseContext();
		this.quality = three.quality === 'auto' ? auto.quality : three.quality;
		this.preset = QUALITY[this.quality];

		this.renderer = new WebGLRenderer({
			antialias: this.preset.antialias,
			alpha: true,
			powerPreference:
				this.quality === 'low' ? 'low-power' : 'high-performance',
		});
		this.renderer.setClearColor(0x000000, 0);
		this.renderer.toneMapping = ACESFilmicToneMapping;
		this.renderer.toneMappingExposure = 0.92;
		this.renderer.shadowMap.enabled = this.preset.shadows;
		this.renderer.shadowMap.type = PCFShadowMap;
		this.renderer.setPixelRatio(
			Math.min(
				window.devicePixelRatio || 1,
				this.preset.pixelRatio,
				three.pixel_ratio_max,
			),
		);
		const canvas = this.renderer.domElement;
		canvas.style.display = 'block';
		canvas.style.width = '100%';
		canvas.style.height = '100%';
		canvas.setAttribute('aria-label', '3D energy view');
		canvas.addEventListener('webglcontextlost', this.onContextLost, false);
		canvas.addEventListener(
			'webglcontextrestored',
			this.onContextRestored,
			false,
		);
		container.appendChild(canvas);

		this.camera = new PerspectiveCamera(three.camera.fov, 1, 0.1, 400);
		this.controls = new OrbitControls(this.camera, canvas);
		this.controls.enableDamping = true;
		this.controls.dampingFactor = 0.085;
		this.controls.screenSpacePanning = true;
		this.controls.maxPolarAngle = Math.PI * 0.485;
		this.controls.rotateSpeed = 0.7;
		this.controls.zoomSpeed = 0.9;
		this.controls.panSpeed = 0.8;
		this.controls.addEventListener('change', () => {
			this.needsRender = true;
			this.kick();
		});
		this.controls.addEventListener('start', () => this.markInteraction());

		this.state = {
			floor: null,
			roof: true,
			exploded: false,
			night: null,
			overlay: three.solar_overlay,
			heat: false,
			deviceFlows: false,
			focus: null,
			reducedMotion: init.reducedMotion,
			labels: [],
			selected: null,
			hovered: null,
		};

		this.buildContent();
		this.rig.goTo(this.rig.viewPose(three.camera.default_view), true);

		this.interaction = new Interaction(
			canvas,
			() => this.camera,
			() => this.pickables(),
			(pick, pointer) => this.handleHover(pick, pointer),
			(pick, _pointer, double) => {
				this.markInteraction();
				this.cb.onSelect(pick?.id ?? null, double);
			},
		);

		this.io = new IntersectionObserver(
			(entries) => {
				this.visible = entries[0]?.isIntersecting ?? true;
				this.updateActive();
			},
			{ threshold: 0.01 },
		);
		this.io.observe(container);
		document.addEventListener('visibilitychange', this.onVisibility);
		this.cb.onStatus({ quality: this.quality, renderer: auto.renderer });
		this.updateActive();
	}

	// ------------------------------------------------------------------ building

	private buildContent(): void {
		const three = this.three;
		const anisotropy = Math.min(
			8,
			this.renderer.capabilities.getMaxAnisotropy(),
		);
		this.mats = new MaterialLibrary(anisotropy);
		this.house = buildHouse(three.house, this.mats);
		this.scene.add(this.house.root);
		this.solar = new SolarArray(three, this.house, this.mats, three.colors);
		this.house.groups.roof.add(this.solar.group);
		this.equipment = new Equipment(
			three,
			this.house,
			this.mats,
			three.colors,
			this.init.batteryCount,
			this.init.batteryCapacityWh,
		);
		this.house.root.add(this.equipment.group);
		this.rooms = new RoomSystem(
			three,
			this.house,
			this.mats,
			this.preset.roomLights,
			ACCENT,
		);
		this.flows = new FlowSystem(this.flowStyle());
		this.house.root.add(this.flows.group);
		this.env = new EnvironmentRig(this.scene, this.renderer, this.house, {
			shadows: this.preset.shadows,
			shadowMapSize: this.preset.shadowMap,
			exteriorPointLights: this.preset.exteriorLights,
			facadeAzimuth: three.compass.facade_azimuth,
		});
		this.selection = new SelectionBox(ACCENT);
		this.scene.add(this.selection.group);
		this.controls.minDistance = three.camera.min_distance * 0.25;
		this.controls.maxDistance = three.camera.max_distance;
		this.controls.autoRotate = three.camera.auto_rotate;
		this.controls.autoRotateSpeed = 0.35;
		const bounds = new Box3();
		for (const g of [
			this.house.groups.groundArch,
			this.house.groups.firstArch,
			this.house.groups.roofArch,
		])
			bounds.expandByObject(g);
		bounds.expandByObject(this.equipment.group);
		this.rig = new CameraRig(
			this.camera,
			this.controls,
			bounds,
			three.camera.transition_ms,
		);
		this.buildAnchors();
		this.flows.build(this.routes());
		this.flows.setHidden('device:', !this.state.deviceFlows);
		this.applyFloorState();
		if (three.model.url) this.loadModel();
		if (this.snapshot) this.applySnapshot(this.snapshot);
		this.needsRender = true;
	}

	private teardownContent(): void {
		this.modelAbort?.abort();
		this.modelAbort = null;
		this.flows?.dispose();
		this.solar?.dispose();
		this.equipment?.dispose();
		this.rooms?.dispose();
		this.env?.dispose();
		this.selection?.dispose();
		if (this.house) {
			this.scene.remove(this.house.root);
			disposeObject(this.house.root);
			this.house.dispose();
		}
		if (this.selection) this.scene.remove(this.selection.group);
		this.customModel = null;
		this.mats?.dispose();
		this.scene.clear();
		this.anchors.clear();
	}

	/** Rebuild after a structural config change (house dims, panels, rooms...). */
	rebuild(three: ThreeDConfig): void {
		const pose: Pose = {
			position: this.camera.position.clone(),
			target: this.controls.target.clone(),
		};
		this.three = three;
		this.camera.fov = three.camera.fov;
		this.camera.updateProjectionMatrix();
		this.teardownContent();
		this.buildContent();
		this.rig.goTo(pose, true);
		this.kick();
	}

	/** Non-structural config change (colours, intensity, idle paths...). */
	updateConfig(three: ThreeDConfig): void {
		this.three = three;
		this.rig?.setTransition(three.camera.transition_ms);
		this.controls.autoRotate = three.camera.auto_rotate;
		this.flows.setStyle(this.flowStyle());
		this.kick();
	}

	private flowStyle() {
		return {
			reducedMotion: this.state?.reducedMotion ?? this.init.reducedMotion,
			xray: true,
			intensity: this.three.animation_intensity,
			showIdle: this.three.show_idle_paths,
			idleColor: this.three.colors.idle,
			maxParticles: this.preset.particles,
		};
	}

	private async loadModel(): Promise<void> {
		this.modelAbort = new AbortController();
		const signal = this.modelAbort.signal;
		try {
			const model = await loadHouseModel(this.three.model, signal);
			if (signal.aborted || this.disposed) return;
			this.customModel = model;
			this.house.root.add(model);
			if (this.three.model.hide_procedural) {
				const g = this.house.groups;
				for (const group of [
					g.groundArch,
					g.firstArch,
					g.roofArch,
					g.groundInterior,
					g.firstInterior,
				])
					group.visible = false;
				// fittings and light washes are placed for the built-in model
				for (const w of [
					this.house.washes.upperLoggia,
					this.house.washes.lowerWall,
				]) {
					w.visible = false;
					w.userData.hidden = true;
				}
				for (const f of this.house.fittings) f.visible = false;
			}
			this.cb.onStatus({ quality: this.quality, modelLoaded: true });
			this.needsRender = true;
			this.kick();
		} catch (e) {
			if (signal.aborted) return;
			this.cb.onStatus({
				quality: this.quality,
				modelError: String((e as Error)?.message ?? e),
			});
		}
	}

	private buildAnchors(): void {
		const a = this.anchors;
		const d = this.house.dims;
		const solarCenter = new Vector3();
		let n = 0;
		this.solar.mppts.forEach((g, id) => {
			a.set(`mppt:${id}`, {
				obj: this.solar.group,
				local: g.center.clone().add(new Vector3(0, 0.9, 0)),
			});
			solarCenter.add(g.center);
			n++;
		});
		if (n)
			a.set('solar', {
				obj: this.solar.group,
				local: solarCenter.divideScalar(n).add(new Vector3(0, 1.8, 0)),
			});
		a.set('inverter', {
			obj: this.equipment.inverter,
			local: new Vector3(0, 0.62, 0.2),
		});
		this.equipment.batteries.forEach((t, i) => {
			a.set(`battery:${i + 1}`, {
				obj: t,
				local: new Vector3(0, (t.userData.height as number) + 0.35, 0),
			});
		});
		a.set('grid', { obj: this.equipment.grid, local: new Vector3(0, 2.0, 0) });
		// above the ground-floor glazing of the right volume (the living area)
		a.set('home', {
			obj: this.house.groups.ground,
			local: new Vector3(d.Rw * 0.45, d.fh - 0.2, d.Rd + 0.4),
		});
		this.rooms.rooms.forEach((r, id) =>
			a.set(`room:${id}`, { obj: r.group, local: r.anchor.clone() }),
		);
		this.rooms.devices.forEach((dv, id) =>
			a.set(`device:${id}`, {
				obj: dv.group.parent!,
				local: dv.anchor.clone(),
			}),
		);
	}

	/** Cable routes in house coordinates, following walls and roofs. */
	private routes(): FlowRoute[] {
		const d = this.house.dims;
		const roofOff = this.house.groups.roof.position.y;
		const firstOff = this.house.groups.first.position.y;
		const roofY = d.roofTop + roofOff;
		const cy = roofY + 0.2;
		const py = d.parapetTop + roofOff + 0.12;
		const a = this.equipment.anchors;
		const out: FlowRoute[] = [];
		const ids = [...this.solar.mppts.keys()].sort((x, y) => x - y);
		ids.forEach((id, i) => {
			const g = this.solar.mppts.get(id)!;
			const start = g.cableStart.clone();
			start.y += roofOff;
			const inP = a.pvIn[i] ?? a.pvIn[a.pvIn.length - 1];
			const lane = inP.z;
			const pts = [
				start,
				new Vector3(start.x, cy, start.z),
				new Vector3(start.x, cy, lane),
			];
			if (start.x < 0.2) {
				pts.push(
					new Vector3(-0.35, cy, lane),
					new Vector3(-0.35, py, lane),
					new Vector3(0.35, py, lane),
					new Vector3(0.35, cy, lane),
				);
			}
			pts.push(
				new Vector3(d.Rw - 0.55, cy, lane),
				new Vector3(d.Rw - 0.55, py, lane),
				new Vector3(inP.x, py, lane),
				inP.clone(),
			);
			out.push({ id: `mppt${id}`, points: pts });
		});
		const ib = a.inverterBattery;
		a.batteryPorts.forEach((bp, i) => {
			const y = bp.y + 0.1;
			out.push({
				id: i === 0 ? 'battery' : `battery${i + 1}`,
				points: [
					bp.clone(),
					new Vector3(bp.x, y, bp.z),
					new Vector3(d.Rw + 0.06, y, bp.z),
					new Vector3(d.Rw + 0.06, 0.78, bp.z),
					new Vector3(d.Rw + 0.06, 0.78, ib.z),
					new Vector3(ib.x, 0.78, ib.z),
					ib.clone(),
				],
			});
		});
		const gp = a.gridPort;
		const ig = a.inverterGrid;
		const trenchX = d.Rw + 1.25;
		out.push({
			id: 'grid',
			points: [
				gp.clone(),
				new Vector3(gp.x, 0.03, gp.z),
				new Vector3(trenchX, 0.03, gp.z),
				new Vector3(trenchX, 0.03, ig.z),
				new Vector3(d.Rw + 0.06, 0.03, ig.z),
				new Vector3(d.Rw + 0.06, 0.62, ig.z),
				new Vector3(ig.x, 0.62, ig.z),
				ig.clone(),
			],
		});
		const ih = a.inverterHome;
		const bi = a.boardIn;
		out.push({
			id: 'home',
			points: [
				ih.clone(),
				new Vector3(ih.x, 0.48, ih.z),
				new Vector3(bi.x, 0.48, ih.z),
				new Vector3(bi.x, 0.48, bi.z),
				bi.clone(),
			],
		});
		if (this.init.hasNonessential) {
			const z = Math.min(d.Rd - 1.0, gp.z - 0.8);
			out.push({
				id: 'nonessential',
				points: [
					new Vector3(trenchX, 0.03, z),
					new Vector3(d.Rw + 0.06, 0.03, z),
					new Vector3(d.Rw + 0.06, 0.5, z),
					new Vector3(d.Rw - 0.5, 0.5, z),
				],
			});
		}
		// branch circuits from the distribution board to each metered device
		this.deviceFlowIds = [];
		const bc = a.boardCenter;
		this.rooms.devices.forEach((dv, id) => {
			const room = this.rooms.rooms.get(dv.roomId);
			if (!room) return;
			const off = dv.floor === 1 ? firstOff : 0;
			const ceil = room.y0 + room.height - 0.12 + off;
			const p = dv.anchor.clone();
			p.y += off;
			const end = new Vector3(p.x, Math.min(ceil, p.y + 0.25), p.z);
			out.push({
				id: `device:${id}`,
				points: [
					new Vector3(bc.x, bc.y + 0.3, bc.z),
					new Vector3(bc.x, ceil, bc.z),
					new Vector3(p.x, ceil, bc.z),
					new Vector3(p.x, ceil, p.z),
					end,
				],
			});
			this.deviceFlowIds.push(`device:${id}`);
		});
		return out;
	}

	// ------------------------------------------------------------------ data

	applySnapshot(snapshot: EnergySnapshot): void {
		this.snapshot = snapshot;
		const flows: FlowSnapshot[] = [...snapshot.flows];
		const minFlow = this.three.min_flow_power;
		for (const room of snapshot.rooms) {
			for (const dev of room.devices) {
				const id = `device:${dev.id}`;
				if (!this.deviceFlowIds.includes(id)) continue;
				const p = dev.power.available ? Math.max(0, dev.power.value ?? 0) : 0;
				flows.push({
					id,
					kind: 'home',
					powerW: p,
					direction: 1,
					active: this.state.deviceFlows && dev.power.available && p > minFlow,
					available: dev.power.available,
					ratio: Math.min(1, p / 2500),
					color: this.three.colors.home,
				});
			}
		}
		this.flows.update(flows);
		this.solar.updateData(snapshot.solar.mppts);
		this.solar.setOverlay(this.state.overlay, snapshot.solar.mppts);
		this.equipment.update(snapshot);
		this.rooms.update(snapshot.rooms);
		this.env.update(
			snapshot.environment,
			snapshot.exteriorLights,
			this.state.night,
		);
		this.needsRender = true;
		this.kick();
	}

	// ------------------------------------------------------------------ state

	setState(patch: Partial<SceneState>): void {
		const prev = this.state;
		this.state = { ...prev, ...patch };
		const s = this.state;
		if (
			patch.reducedMotion !== undefined &&
			patch.reducedMotion !== prev.reducedMotion
		) {
			this.flows.setStyle(this.flowStyle());
			this.rig.setTransition(
				s.reducedMotion ? 0 : this.three.camera.transition_ms,
			);
		}
		if (patch.floor !== undefined || patch.roof !== undefined)
			this.applyFloorState();
		if (patch.exploded !== undefined && patch.exploded !== prev.exploded) {
			this.explode.from = this.explode.value;
			this.explode.target = s.exploded ? 1 : 0;
			this.explode.start = performance.now();
			this.flows.setVisible(false);
		}
		if (patch.overlay !== undefined && this.snapshot)
			this.solar.setOverlay(s.overlay, this.snapshot.solar.mppts);
		if (patch.heat !== undefined) this.rooms.setHeat(s.heat);
		if (patch.night !== undefined && this.snapshot)
			this.env.update(
				this.snapshot.environment,
				this.snapshot.exteriorLights,
				s.night,
			);
		if (patch.deviceFlows !== undefined) {
			// branch circuits to devices only show in room views
			this.flows.setHidden('device:', !s.deviceFlows);
			if (this.snapshot) this.applySnapshot(this.snapshot);
		}
		if (patch.focus !== undefined)
			this.flows.setFocus(s.focus ? [...s.focus] : null);
		if (patch.selected !== undefined) this.applySelection(s.selected);
		if (patch.hovered !== undefined) this.applyHover(s.hovered);
		this.needsRender = true;
		this.kick();
	}

	getState(): SceneState {
		return { ...this.state };
	}

	private applyFloorState(): void {
		const { floor, roof } = this.state;
		const ghost = this.three.semi_transparent_floors;
		const g = this.house.groups;
		const firstMode: 'show' | 'ghost' | 'hide' =
			floor === 'ground' ? (ghost ? 'ghost' : 'hide') : 'show';
		const roofMode: 'show' | 'ghost' | 'hide' =
			floor !== null || !roof
				? ghost && floor === null
					? 'ghost'
					: 'hide'
				: 'show';
		this.setGroupMode(g.first, firstMode);
		this.setGroupMode(g.roofArch, roofMode);
		this.solar.setGhost(roofMode !== 'show');
		// looking into a single floor: panels would only clutter the view from above
		this.solar.group.visible = roofMode !== 'hide';
		// roof cable runs float once the roof is gone: keep them, but quietly
		this.flows.setDimmed('mppt', roofMode !== 'show');
		this.selection?.refresh();
		this.needsRender = true;
	}

	private setGroupMode(group: Object3D, mode: 'show' | 'ghost' | 'hide'): void {
		group.visible = mode !== 'hide';
		group.traverse((o) => {
			const m = o as Mesh;
			if (!m.isMesh || o.userData.proxy) return;
			const mat = m.material as Material;
			const isBasic =
				(mat as { isMeshBasicMaterial?: boolean }).isMeshBasicMaterial ||
				(mat as { isShaderMaterial?: boolean }).isShaderMaterial;
			if (mode === 'ghost') {
				if (isBasic) {
					if (m.userData.wasVisible === undefined)
						m.userData.wasVisible = m.visible;
					m.visible = false;
					return;
				}
				if (!m.userData.origMaterial) m.userData.origMaterial = mat;
				m.material = this.mats.ghost(m.userData.origMaterial as Material);
				m.castShadow = false;
			} else {
				if (m.userData.origMaterial) {
					m.material = m.userData.origMaterial as Material;
					delete m.userData.origMaterial;
					m.castShadow = true;
				}
				if (m.userData.wasVisible !== undefined) {
					m.visible = m.userData.wasVisible as boolean;
					delete m.userData.wasVisible;
				}
			}
		});
	}

	private floorPickable(floor: 0 | 1): boolean {
		const f = this.state.floor;
		if (f === 'ground') return floor === 0;
		if (f === 'first') return floor === 1;
		return true;
	}

	private pickables(): Object3D[] {
		return [
			...this.equipment.pickables(),
			...this.rooms.pickables((f) => this.floorPickable(f)),
			...this.solar.pickables(),
		];
	}

	private handleHover(
		pick: PickResult | null,
		pointer: PointerInfo | null,
	): void {
		const id = pick?.id ?? null;
		this.cb.onHover(id, pointer);
	}

	private applyHover(id: string | null): void {
		this.solar.setHover(
			id?.startsWith('mppt:') ? Number(id.split(':')[1]) : null,
		);
		this.rooms.setHover(id?.startsWith('room:') ? id.slice(5) : null);
	}

	private selectionObjects(id: string): Object3D[] | null {
		if (id === 'inverter') return [this.equipment.inverter];
		if (id.startsWith('battery')) {
			const i = Number(id.split(':')[1] ?? 1) - 1;
			return this.equipment.batteries[i] ? [this.equipment.batteries[i]] : null;
		}
		if (id === 'grid') return [this.equipment.grid];
		if (id === 'home') return [this.equipment.board];
		if (id.startsWith('device:')) {
			const d = this.rooms.devices.get(id.slice(7));
			return d ? [d.group] : null;
		}
		return null;
	}

	private applySelection(id: string | null): void {
		this.solar.setHighlight(
			id?.startsWith('mppt:') ? Number(id.split(':')[1]) : null,
		);
		this.rooms.setHighlight(id?.startsWith('room:') ? id.slice(5) : null);
		this.selection.set(
			id ? this.selectionObjects(id) : null,
			id?.startsWith('device:') ? 0.06 : 0.1,
		);
	}

	/** Move the camera to show `id`. Rooms also reveal their floor. */
	focus(id: string): void {
		const world = (key: string) => {
			const a = this.anchors.get(key);
			return a ? a.obj.localToWorld(a.local.clone()) : null;
		};
		let pose: Pose | null = null;
		if (id === 'inverter' || id.startsWith('battery') || id === 'home') {
			const c =
				id === 'home'
					? this.equipment.anchors.boardCenter
					: id === 'inverter'
						? this.equipment.anchors.inverterCenter
						: this.equipment.anchors.batteryCenters[0];
			const center = this.house.root.localToWorld(c.clone());
			pose = this.rig.focusPose(
				center,
				id === 'home' ? 2.4 : 1.5,
				new Vector3(1, 0.5, 0.42),
			);
		} else if (id === 'grid') {
			const center = this.house.root.localToWorld(
				this.equipment.anchors.gridCenter.clone(),
			);
			pose = this.rig.focusPose(center, 1.8, new Vector3(0.55, 0.45, 1));
		} else if (id === 'solar') {
			const c = world('solar');
			if (c)
				pose = this.rig.focusPose(
					c.add(new Vector3(0, -1.8, 0)),
					8.5,
					new Vector3(0.55, 1.1, 0.8),
				);
		} else if (id.startsWith('mppt:')) {
			const g = this.solar.mppts.get(Number(id.split(':')[1]));
			if (g)
				pose = this.rig.focusPose(
					this.solar.group.localToWorld(g.center.clone()),
					4.2,
					new Vector3(0.45, 1.0, 0.75),
				);
		} else if (id.startsWith('room:')) {
			const r = this.rooms.rooms.get(id.slice(5));
			if (r) {
				if (!this.state.exploded)
					this.setState({ floor: r.floor === 0 ? 'ground' : 'first' });
				const main = r.rects.reduce((p, q) => (q.w * q.d > p.w * p.d ? q : p));
				const c = world(id) ?? new Vector3();
				pose = this.rig.focusPose(
					c,
					Math.max(main.w, main.d) / 2 + 1.2,
					new Vector3(0.55, 1.15, 0.9),
				);
			}
		} else if (id.startsWith('device:')) {
			const dv = this.rooms.devices.get(id.slice(7));
			if (dv) {
				if (!this.state.exploded)
					this.setState({ floor: dv.floor === 0 ? 'ground' : 'first' });
				const c = world(id) ?? new Vector3();
				pose = this.rig.focusPose(c, 4.6, new Vector3(0.45, 1.5, 0.9));
			}
		}
		if (pose) {
			this.rig.goTo(pose, this.state.reducedMotion);
			this.kick();
		}
	}

	setView(view: CameraViewId): void {
		this.rig.goTo(this.rig.viewPose(view), this.state.reducedMotion);
		this.markInteraction();
		this.kick();
	}

	/** Preset camera + scene state. */
	applyPreset(preset: PresetId): void {
		const base: Partial<SceneState> = {
			floor: null,
			roof: true,
			exploded: false,
			night: null,
			overlay: this.three.solar_overlay,
			heat: false,
			deviceFlows: false,
			focus: null,
		};
		let pose: Pose | null = null;
		switch (preset) {
			case 'overview':
				pose = this.rig.viewPose('iso');
				break;
			case 'solar': {
				Object.assign(base, { overlay: true, focus: ['mppt'] });
				const c = this.anchors.get('solar');
				const center = c
					? c.obj.localToWorld(c.local.clone()).add(new Vector3(0, -1.8, 0))
					: new Vector3();
				pose = this.rig.focusPose(center, 8.5, new Vector3(0.55, 1.1, 0.8));
				break;
			}
			case 'battery': {
				Object.assign(base, { focus: ['battery', 'grid', 'home'] });
				const a = this.equipment.anchors;
				const center = this.house.root.localToWorld(
					a.inverterCenter.clone().lerp(a.batteryCenters[0], 0.5),
				);
				pose = this.rig.focusPose(center, 2.3, new Vector3(1, 0.5, 0.5));
				break;
			}
			case 'rooms':
				Object.assign(base, {
					exploded: true,
					roof: false,
					heat: true,
					deviceFlows: true,
					focus: ['device:', 'home'],
				});
				pose = this.rig.viewPose('iso', 1.28, 2.6);
				break;
			case 'night': {
				Object.assign(base, { night: true });
				const d = this.house.dims;
				// standing on the lawn in front of the left half, like the reference photo
				const target = this.house.root.localToWorld(
					new Vector3((d.xMin + d.xMax) / 2 + 0.6, 3.3, d.Ld - 1),
				);
				const position = this.house.root.localToWorld(
					new Vector3(d.xMin * 0.3, 1.7, d.zMax + 24),
				);
				pose = { position, target };
				break;
			}
		}
		this.setState(base);
		if (pose) this.rig.goTo(pose, this.state.reducedMotion);
		this.markInteraction();
		this.kick();
	}

	resetCamera(): void {
		this.rig.goTo(
			this.rig.viewPose(this.three.camera.default_view),
			this.state.reducedMotion,
		);
		this.kick();
	}

	// ------------------------------------------------------------------ loop

	resize(width: number, height: number): void {
		if (width < 2 || height < 2) return;
		this.width = width;
		this.height = height;
		this.renderer.setSize(width, height, false);
		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();
		this.flows.setViewportScale((height * this.renderer.getPixelRatio()) / 2);
		this.needsRender = true;
		this.kick();
	}

	private markInteraction(): void {
		this.lastInteraction = performance.now();
		this.kick();
	}

	private updateActive(): void {
		const active =
			this.visible && document.visibilityState !== 'hidden' && !this.disposed;
		if (active) this.kick();
		else this.stop();
	}

	/** Make sure the loop runs (it stops itself when idle). */
	kick(): void {
		if (
			this.disposed ||
			this.running ||
			!this.visible ||
			document.visibilityState === 'hidden'
		)
			return;
		this.running = true;
		this.lastFrame = 0;
		this.raf = requestAnimationFrame(this.loop);
	}

	private stop(): void {
		this.running = false;
		if (this.raf) cancelAnimationFrame(this.raf);
		this.raf = 0;
	}

	private readonly loop = (now: number): void => {
		if (!this.running) return;
		const idle = now - this.lastInteraction > this.three.idle_timeout * 1000;
		const fps = idle ? this.three.idle_fps : this.three.max_fps;
		if (this.lastFrame && now - this.lastFrame < 1000 / fps - 1.5) {
			this.raf = requestAnimationFrame(this.loop);
			return;
		}
		const dt = this.lastFrame
			? Math.min(0.1, (now - this.lastFrame) / 1000)
			: 1 / 60;
		this.lastFrame = now;
		const t = now / 1000;
		let animating = false;
		if (this.rig.animate(now)) animating = true;
		if (this.controls.update()) animating = true;
		if (this.controls.autoRotate) animating = true;
		if (this.animateExplode(dt)) animating = true;
		if (this.env.animate(dt)) animating = true;
		if (this.rooms.animate(dt)) animating = true;
		if (this.flows.animate(dt, t)) animating = true;
		if (this.equipment.animate(t, this.state.reducedMotion)) animating = true;
		if (this.selection.animate(t, this.state.reducedMotion)) animating = true;
		if (animating || this.needsRender) {
			this.renderer.render(this.scene, this.camera);
			this.needsRender = false;
			this.projectLabels();
		}
		if (animating) {
			this.raf = requestAnimationFrame(this.loop);
		} else {
			this.running = false;
			this.raf = 0;
		}
	};

	private animateExplode(_dt: number): boolean {
		const e = this.explode;
		if (e.value === e.target) return false;
		const duration = this.state.reducedMotion ? 1 : 750;
		const t = Math.min(1, (performance.now() - e.start) / duration);
		const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
		e.value = e.from + (e.target - e.from) * k;
		if (t >= 1) e.value = e.target;
		this.positionFloors();
		if (e.value === e.target) this.onExplodeDone();
		return true;
	}

	private positionFloors(): void {
		const gap = 3.4 * this.explode.value;
		this.house.groups.first.position.y = gap;
		this.house.groups.roof.position.y = gap * 2;
		if (this.customModel) this.customModel.visible = this.explode.value < 0.01;
	}

	private onExplodeDone(): void {
		this.flows.build(this.routes());
		if (this.snapshot) this.applySnapshot(this.snapshot);
		this.flows.setFocus(this.state.focus);
		this.flows.setVisible(true);
		this.selection.refresh();
	}

	private projectLabels(): void {
		if (!this.state.labels.length) {
			this.cb.onLabels([]);
			return;
		}
		const out: ProjectedLabel[] = [];
		const v = new Vector3();
		for (const id of this.state.labels) {
			const a = this.anchors.get(id);
			if (!a) continue;
			if (!a.obj.visible && !id.startsWith('mppt')) {
				out.push({ id, x: 0, y: 0, visible: false });
				continue;
			}
			a.obj.localToWorld(v.copy(a.local));
			v.project(this.camera);
			const visible =
				v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
			out.push({
				id,
				x: ((v.x + 1) / 2) * this.width,
				y: ((1 - v.y) / 2) * this.height,
				visible,
			});
		}
		this.cb.onLabels(out);
	}

	/** Diagnostics for the demo/test harness. */
	stats() {
		const info = this.renderer.info;
		return {
			quality: this.quality,
			calls: info.render.calls,
			triangles: info.render.triangles,
			geometries: info.memory.geometries,
			textures: info.memory.textures,
			programs: info.programs?.length ?? 0,
			running: this.running,
		};
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.stop();
		this.io.disconnect();
		document.removeEventListener('visibilitychange', this.onVisibility);
		this.interaction.dispose();
		this.controls.dispose();
		this.teardownContent();
		const canvas = this.renderer.domElement;
		canvas.removeEventListener('webglcontextlost', this.onContextLost);
		canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
		this.renderer.renderLists.dispose();
		this.renderer.dispose();
		this.renderer.forceContextLoss();
		canvas.remove();
	}
}
