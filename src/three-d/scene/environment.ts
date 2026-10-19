/**
 * Lighting rig: sun (positioned from the sun entity's azimuth/elevation), sky
 * fill, image-based reflections, night mode, exterior architectural lighting.
 */
import {
	Color,
	DirectionalLight,
	HemisphereLight,
	Mesh,
	MeshBasicMaterial,
	Object3D,
	PMREMGenerator,
	PointLight,
	Scene,
	Texture,
	Vector3,
	WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { ExteriorLightConfig } from '../config';
import type {
	EnvironmentSnapshot,
	ExteriorLightSnapshot,
} from '../data/energy-model';
import type { HouseModel } from './house-builder';
import { azimuthVector } from './solar-array';

export interface EnvironmentOptions {
	shadows: boolean;
	shadowMapSize: number;
	exteriorPointLights: number;
	facadeAzimuth: number;
}

const DEFAULT_SUN = { azimuth: 150, elevation: 38 };

function lerp(a: number, b: number, t: number) {
	return a + (b - a) * t;
}

export class EnvironmentRig {
	readonly sun: DirectionalLight;
	readonly moon: DirectionalLight;
	readonly hemi: HemisphereLight;
	private readonly envTexture: Texture;
	private readonly exterior: {
		light: PointLight;
		zone: ExteriorLightConfig['zone'];
		base: number;
	}[] = [];
	private night = 0;
	private nightTarget = 0;
	private readonly sunTarget = new Object3D();
	private readonly zoneOn = new Map<
		string,
		{ on: boolean | null; color: string | null; brightness: number }
	>();
	private readonly daySky = new Color('#dbe8ff');
	private readonly nightSky = new Color('#1c2740');
	private readonly dayGround = new Color('#8b7d66');
	private readonly nightGround = new Color('#0b1020');
	private readonly washDefaults: Record<string, string> = {
		upper_loggia: '#d946ef',
		lower_wall: '#22d3ee',
	};

	constructor(
		private readonly scene: Scene,
		renderer: WebGLRenderer,
		private readonly house: HouseModel,
		private readonly opts: EnvironmentOptions,
	) {
		const pmrem = new PMREMGenerator(renderer);
		const room = new RoomEnvironment();
		this.envTexture = pmrem.fromScene(room, 0.04).texture;
		room.traverse((o) => {
			const m = o as unknown as {
				geometry?: { dispose(): void };
				material?: { dispose(): void };
			};
			m.geometry?.dispose();
			m.material?.dispose();
		});
		pmrem.dispose();
		scene.environment = this.envTexture;

		this.hemi = new HemisphereLight(this.daySky, this.dayGround, 0.75);
		scene.add(this.hemi);

		this.sun = new DirectionalLight('#fff4e5', 2.6);
		this.sun.castShadow = opts.shadows;
		if (opts.shadows) {
			const s = this.sun.shadow;
			s.mapSize.set(opts.shadowMapSize, opts.shadowMapSize);
			s.camera.left = -19;
			s.camera.right = 19;
			s.camera.top = 19;
			s.camera.bottom = -19;
			s.camera.near = 1;
			s.camera.far = 110;
			s.bias = -0.0004;
			s.normalBias = 0.025;
			s.radius = 3;
		}
		this.sun.target = this.sunTarget;
		scene.add(this.sun, this.sunTarget);

		this.moon = new DirectionalLight('#9db4ff', 0);
		this.moon.position.set(-25, 30, 18);
		scene.add(this.moon);

		// a few real lights for the architectural washes; emissive planes do the rest
		const root = house.root;
		const L = house.lights;
		const candidates: {
			pos: Vector3;
			zone: ExteriorLightConfig['zone'];
			color: string;
			base: number;
		}[] = [
			{
				pos: L.loggia[1] ?? L.loggia[0],
				zone: 'upper_loggia',
				color: '#d946ef',
				base: 6,
			},
			{
				pos: L.soffit[1] ?? L.soffit[0],
				zone: 'lower_wall',
				color: '#22d3ee',
				base: 5,
			},
			{
				pos: L.soffit[4] ?? L.soffit[0],
				zone: 'lower_wall',
				color: '#22d3ee',
				base: 5,
			},
			{
				pos: L.loggia[2] ?? L.loggia[0],
				zone: 'upper_loggia',
				color: '#d946ef',
				base: 6,
			},
			{
				pos: L.rightLoggia[0],
				zone: 'right_loggia',
				color: '#ffd9a8',
				base: 4,
			},
			{ pos: L.wall[0], zone: 'wall_lights', color: '#ffd9a8', base: 3 },
		];
		for (const c of candidates.slice(0, opts.exteriorPointLights)) {
			if (!c.pos) continue;
			const light = new PointLight(c.color, 0, 6, 2);
			light.position.copy(c.pos).add(new Vector3(0, -0.25, 0.3));
			root.add(light);
			this.exterior.push({ light, zone: c.zone, base: c.base });
		}
	}

	update(
		env: EnvironmentSnapshot,
		lights: ExteriorLightSnapshot[],
		nightOverride: boolean | null,
	): void {
		const night = nightOverride ?? env.night;
		this.nightTarget = night ? 1 : 0;
		const az = env.azimuth ?? DEFAULT_SUN.azimuth;
		const el =
			env.elevation !== null && env.elevation !== undefined && env.elevation > 0
				? env.elevation
				: DEFAULT_SUN.elevation;
		const elev = (Math.max(12, el) * Math.PI) / 180;
		const dir = azimuthVector(az, this.opts.facadeAzimuth)
			.multiplyScalar(Math.cos(elev))
			.add(new Vector3(0, Math.sin(elev), 0));
		this.sun.position.copy(dir.multiplyScalar(45));
		this.sunTarget.position.set(0, 0, 0);
		// warmer light when the sun is low
		const low = 1 - Math.min(1, el / 35);
		this.sun.color.setRGB(1, 0.95 - 0.12 * low, 0.88 - 0.25 * low);
		this.zoneOn.clear();
		for (const l of lights)
			this.zoneOn.set(l.zone, {
				on: l.on,
				color: l.color,
				brightness: l.brightness,
			});
		this.applyNight(this.night);
	}

	/** Night transition; returns true while animating. */
	animate(dt: number): boolean {
		if (Math.abs(this.night - this.nightTarget) < 0.002) {
			if (this.night !== this.nightTarget) {
				this.night = this.nightTarget;
				this.applyNight(this.night);
			}
			return false;
		}
		this.night += (this.nightTarget - this.night) * Math.min(1, dt * 3);
		this.applyNight(this.night);
		return true;
	}

	get isNight(): boolean {
		return this.nightTarget > 0.5;
	}

	private zoneLevel(zone: string): { level: number; color: string | null } {
		const z = this.zoneOn.get(zone);
		if (!z) return { level: this.night, color: null }; // decorative: follows night mode
		if (z.on === null) return { level: this.night, color: z.color };
		return {
			level: z.on ? Math.max(this.night, 0.6) * z.brightness : 0,
			color: z.color,
		};
	}

	private applyNight(n: number): void {
		this.sun.intensity = lerp(2.6, 0, n);
		this.sun.castShadow = this.opts.shadows && n < 0.6;
		this.moon.intensity = lerp(0, 0.45, n);
		this.hemi.intensity = lerp(0.75, 0.16, n);
		this.hemi.color.copy(this.daySky).lerp(this.nightSky, n);
		this.hemi.groundColor.copy(this.dayGround).lerp(this.nightGround, n);
		this.scene.environmentIntensity = lerp(0.75, 0.2, n);

		const upper = this.zoneLevel('upper_loggia');
		const lower = this.zoneLevel('lower_wall');
		const wall = this.zoneLevel('wall_lights');
		const terrace = this.zoneLevel('terrace');
		const rightLoggia = this.zoneLevel('right_loggia');
		const wash = (
			mesh: Mesh,
			level: number,
			color: string | null,
			fallback: string,
		) => {
			const m = mesh.material as MeshBasicMaterial;
			m.opacity = 0.85 * level;
			m.color.set(color ?? fallback);
			mesh.visible = level > 0.01 && !mesh.userData.hidden;
		};
		wash(
			this.house.washes.upperLoggia,
			upper.level,
			upper.color,
			this.washDefaults.upper_loggia,
		);
		wash(
			this.house.washes.lowerWall,
			lower.level,
			lower.color,
			this.washDefaults.lower_wall,
		);
		for (const f of this.house.fittings) {
			const m = f.material as MeshBasicMaterial;
			const lvl = Math.max(wall.level, terrace.level, n);
			m.color.setRGB(1, 0.93, 0.82).multiplyScalar(0.25 + 1.8 * lvl);
		}
		for (const e of this.exterior) {
			const z =
				e.zone === 'upper_loggia'
					? upper
					: e.zone === 'lower_wall'
						? lower
						: e.zone === 'right_loggia'
							? rightLoggia
							: wall;
			e.light.intensity = e.base * z.level;
			if (z.color) e.light.color.set(z.color);
		}
	}

	dispose(): void {
		this.envTexture.dispose();
		this.scene.environment = null;
		for (const e of this.exterior) e.light.parent?.remove(e.light);
		this.sun.shadow.map?.dispose();
	}
}
