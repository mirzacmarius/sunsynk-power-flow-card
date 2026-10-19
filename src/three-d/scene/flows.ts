/**
 * Animated energy flows: a glowing tube along each physical cable route plus
 * particles moving along it. Speed, brightness and particle density follow the
 * measured power; direction follows the sign; zero power stops the animation.
 */
import {
	AdditiveBlending,
	BufferAttribute,
	BufferGeometry,
	Color,
	CurvePath,
	GreaterDepth,
	Group,
	LineCurve3,
	Mesh,
	Points,
	QuadraticBezierCurve3,
	ShaderMaterial,
	TubeGeometry,
	Vector3,
} from 'three';
import type { FlowSnapshot } from '../data/energy-model';

const TUBE_VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalV;
varying vec3 vViewDir;
void main() {
	vUv = uv;
	vec4 mv = modelViewMatrix * vec4(position, 1.0);
	vNormalV = normalize(normalMatrix * normal);
	vViewDir = normalize(-mv.xyz);
	gl_Position = projectionMatrix * mv;
}
`;

const TUBE_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uIdleColor;
uniform float uTime;
uniform float uSpeed;
uniform float uLength;
uniform float uIntensity;
uniform float uActive;
uniform float uIdle;
uniform float uDir;
uniform float uFade;
uniform float uXray;
varying vec2 vUv;
varying vec3 vNormalV;
varying vec3 vViewDir;
void main() {
	float facing = abs(dot(vNormalV, vViewDir));
	float core = smoothstep(0.0, 1.0, facing);
	float s = vUv.x * uLength;
	float phase = (uDir * s - uTime * uSpeed) / 0.85;
	float f = fract(phase);
	// asymmetric "chevron" pulse: sharp front edge, soft tail -> readable direction even when static
	float pulse = smoothstep(0.0, 0.08, f) * (1.0 - smoothstep(0.08, 0.62, f));
	float ends = smoothstep(0.0, 0.03, vUv.x) * smoothstep(1.0, 0.97, vUv.x);
	vec3 activeCol = uColor * (0.7 + 0.75 * pulse);
	float activeA = (0.38 + 0.62 * pulse) * uIntensity;
	vec3 col = mix(uIdleColor, activeCol, uActive);
	float a = mix(uIdle, activeA, uActive) * (0.45 + 0.55 * core) * ends * uFade * uXray;
	gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
	#include <colorspace_fragment>
}
`;

const POINTS_VERTEX = /* glsl */ `
attribute float aAlpha;
uniform float uSize;
uniform float uScale;
varying float vAlpha;
void main() {
	vec4 mv = modelViewMatrix * vec4(position, 1.0);
	gl_Position = projectionMatrix * mv;
	gl_PointSize = clamp(uSize * uScale * projectionMatrix[1][1] / max(0.001, -mv.z), 1.0, 48.0);
	vAlpha = aAlpha;
}
`;

const POINTS_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
varying float vAlpha;
void main() {
	vec2 c = gl_PointCoord - 0.5;
	float d = length(c);
	float a = smoothstep(0.5, 0.0, d);
	a = a * a;
	gl_FragColor = vec4(uColor * (0.9 + 0.9 * a), a * vAlpha * uIntensity);
	#include <colorspace_fragment>
}
`;

export interface FlowRoute {
	id: string;
	points: Vector3[];
}

export interface FlowStyle {
	reducedMotion: boolean;
	/** draw occluded segments faintly through geometry */
	xray: boolean;
	intensity: number;
	showIdle: boolean;
	idleColor: string;
	maxParticles: number;
}

const SAMPLES = 256;

/** Polyline → path with small rounded corners. */
export function roundedPath(
	points: Vector3[],
	radius = 0.18,
): CurvePath<Vector3> {
	const path = new CurvePath<Vector3>();
	const pts = points.filter(
		(p, i) => i === 0 || p.distanceTo(points[i - 1]) > 1e-4,
	);
	if (pts.length < 2) {
		path.add(
			new LineCurve3(
				pts[0] ?? new Vector3(),
				(pts[0] ?? new Vector3()).clone().add(new Vector3(0, 0.01, 0)),
			),
		);
		return path;
	}
	let current = pts[0].clone();
	for (let i = 1; i < pts.length - 1; i++) {
		const prev = pts[i - 1];
		const corner = pts[i];
		const next = pts[i + 1];
		const inDir = corner.clone().sub(prev);
		const outDir = next.clone().sub(corner);
		const r = Math.min(radius, inDir.length() / 2, outDir.length() / 2);
		inDir.normalize();
		outDir.normalize();
		if (r < 1e-3 || inDir.dot(outDir) > 0.999) continue;
		const a = corner.clone().addScaledVector(inDir, -r);
		const b = corner.clone().addScaledVector(outDir, r);
		path.add(new LineCurve3(current, a));
		path.add(new QuadraticBezierCurve3(a, corner.clone(), b));
		current = b;
	}
	path.add(new LineCurve3(current, pts[pts.length - 1].clone()));
	return path;
}

export class FlowLine {
	readonly group = new Group();
	readonly length: number;
	private readonly tube: Mesh;
	private readonly tubeMat: ShaderMaterial;
	private readonly xray: Mesh;
	private readonly xrayMat: ShaderMaterial;
	private readonly points: Points;
	private readonly pointsMat: ShaderMaterial;
	private readonly samples: Float32Array;
	private readonly positions: Float32Array;
	private readonly alphas: Float32Array;
	private readonly offsets: Float32Array;
	private count = 0;
	private speed = 0;
	private dir: 1 | -1 = 1;
	private active = false;
	private travel = 0;
	private fade = 1;
	private targetFade = 1;

	constructor(
		readonly id: string,
		points: Vector3[],
		private readonly maxParticles: number,
		radius = 0.06,
	) {
		const path = roundedPath(points);
		this.length = Math.max(0.01, path.getLength());
		const segments = Math.max(24, Math.min(600, Math.round(this.length * 14)));
		const geo = new TubeGeometry(path, segments, radius, 6, false);
		this.tubeMat = new ShaderMaterial({
			vertexShader: TUBE_VERTEX,
			fragmentShader: TUBE_FRAGMENT,
			transparent: true,
			depthWrite: false,
			blending: AdditiveBlending,
			uniforms: {
				uColor: { value: new Color('#ffffff') },
				uIdleColor: { value: new Color('#64748b') },
				uTime: { value: 0 },
				uSpeed: { value: 0 },
				uLength: { value: this.length },
				uIntensity: { value: 1 },
				uActive: { value: 0 },
				uIdle: { value: 0.1 },
				uDir: { value: 1 },
				uFade: { value: 1 },
			},
		});
		this.tubeMat.uniforms.uXray = { value: 1 };
		this.tube = new Mesh(geo, this.tubeMat);
		this.tube.renderOrder = 5;
		this.tube.name = `flow:${id}`;
		this.group.add(this.tube);
		// Faint pass drawn through walls and parapets, so hidden cable runs stay readable.
		this.xrayMat = new ShaderMaterial({
			vertexShader: TUBE_VERTEX,
			fragmentShader: TUBE_FRAGMENT,
			transparent: true,
			depthWrite: false,
			// only where the cable is hidden behind something
			depthFunc: GreaterDepth,
			blending: AdditiveBlending,
			// same uniform objects as the main pass, except the x-ray strength
			uniforms: { ...this.tubeMat.uniforms, uXray: { value: 0.28 } },
		});
		this.xray = new Mesh(geo, this.xrayMat);
		this.xray.renderOrder = 4;
		this.group.add(this.xray);

		this.samples = new Float32Array((SAMPLES + 1) * 3);
		for (let i = 0; i <= SAMPLES; i++) {
			const p = path.getPointAt(i / SAMPLES);
			this.samples[i * 3] = p.x;
			this.samples[i * 3 + 1] = p.y;
			this.samples[i * 3 + 2] = p.z;
		}
		this.positions = new Float32Array(maxParticles * 3);
		this.alphas = new Float32Array(maxParticles);
		this.offsets = new Float32Array(maxParticles);
		const pg = new BufferGeometry();
		pg.setAttribute('position', new BufferAttribute(this.positions, 3));
		pg.setAttribute('aAlpha', new BufferAttribute(this.alphas, 1));
		pg.setDrawRange(0, 0);
		this.pointsMat = new ShaderMaterial({
			vertexShader: POINTS_VERTEX,
			fragmentShader: POINTS_FRAGMENT,
			transparent: true,
			depthWrite: false,
			blending: AdditiveBlending,
			uniforms: {
				uColor: { value: new Color('#ffffff') },
				uIntensity: { value: 1 },
				uSize: { value: 0.22 },
				uScale: { value: 400 },
			},
		});
		this.points = new Points(pg, this.pointsMat);
		this.points.frustumCulled = false;
		this.points.renderOrder = 6;
		this.group.add(this.points);
	}

	setViewportScale(scale: number): void {
		this.pointsMat.uniforms.uScale.value = scale;
	}

	setState(flow: FlowSnapshot | undefined, style: FlowStyle): void {
		const u = this.tubeMat.uniforms;
		const active = !!flow && flow.active && style.intensity > 0;
		this.xray.visible = style.xray;
		this.active = active;
		u.uIdleColor.value.set(style.idleColor);
		u.uIdle.value = style.showIdle
			? flow?.available === false
				? 0.05
				: 0.11
			: 0;
		if (!flow) {
			u.uActive.value = 0;
			this.count = 0;
			this.points.geometry.setDrawRange(0, 0);
			return;
		}
		const ratio = Math.max(0, Math.min(1, flow.ratio));
		const brightness =
			(0.45 + 0.55 * Math.sqrt(ratio)) *
			Math.min(1.4, 0.6 + 0.4 * style.intensity);
		u.uColor.value.set(flow.color);
		u.uActive.value = active ? 1 : 0;
		u.uIntensity.value = brightness;
		u.uDir.value = flow.direction;
		this.dir = flow.direction;
		this.speed =
			active && !style.reducedMotion
				? (0.45 + 2.6 * Math.sqrt(ratio)) * style.intensity
				: 0;
		u.uSpeed.value = this.speed;
		this.pointsMat.uniforms.uColor.value.set(flow.color);
		this.pointsMat.uniforms.uIntensity.value = brightness;
		const target =
			active && !style.reducedMotion
				? Math.max(
						2,
						Math.round(
							(2 + ratio * (this.maxParticles - 2)) *
								Math.min(1.5, style.intensity),
						),
					)
				: 0;
		const wanted = Math.min(
			this.maxParticles,
			Math.max(target, 0),
			Math.ceil(this.length / 0.18),
		);
		if (
			Math.abs(wanted - this.count) >= 2 ||
			(wanted === 0) !== (this.count === 0)
		) {
			this.count = wanted;
			for (let i = 0; i < this.count; i++) {
				this.offsets[i] =
					(i + 0.35 * Math.sin(i * 12.9898)) / Math.max(1, this.count);
			}
		}
		this.points.geometry.setDrawRange(0, this.count);
		if (!this.count) this.writeParticles();
	}

	/** Fade the whole line (used while the exploded view animates). */
	setFade(target: number, immediate = false): void {
		this.targetFade = target;
		if (immediate) {
			this.fade = target;
			this.tubeMat.uniforms.uFade.value = target;
		}
	}

	/** Returns true while the line animates. */
	animate(dt: number, time: number): boolean {
		let animating = false;
		if (Math.abs(this.fade - this.targetFade) > 0.001) {
			this.fade += (this.targetFade - this.fade) * Math.min(1, dt * 8);
			this.tubeMat.uniforms.uFade.value = this.fade;
			animating = true;
		}
		this.points.visible = this.fade > 0.05;
		if (!this.active || this.speed === 0) return animating;
		this.tubeMat.uniforms.uTime.value = time;
		this.travel += (dt * this.speed * this.dir) / this.length;
		this.writeParticles();
		return true;
	}

	private writeParticles(): void {
		const n = this.count;
		for (let i = 0; i < n; i++) {
			let u = (this.offsets[i] + this.travel) % 1;
			if (u < 0) u += 1;
			const f = u * SAMPLES;
			const k = Math.min(SAMPLES - 1, Math.floor(f));
			const t = f - k;
			const a = k * 3;
			const b = (k + 1) * 3;
			this.positions[i * 3] =
				this.samples[a] + (this.samples[b] - this.samples[a]) * t;
			this.positions[i * 3 + 1] =
				this.samples[a + 1] + (this.samples[b + 1] - this.samples[a + 1]) * t;
			this.positions[i * 3 + 2] =
				this.samples[a + 2] + (this.samples[b + 2] - this.samples[a + 2]) * t;
			// fade in/out at the ends of the route
			const edge = Math.min(u, 1 - u);
			this.alphas[i] = Math.min(1, edge / 0.05) * this.fade;
		}
		const g = this.points.geometry;
		(g.attributes.position as BufferAttribute).needsUpdate = true;
		(g.attributes.aAlpha as BufferAttribute).needsUpdate = true;
	}

	dispose(): void {
		this.tube.geometry.dispose();
		this.tubeMat.dispose();
		this.xrayMat.dispose();
		this.points.geometry.dispose();
		this.pointsMat.dispose();
	}
}

export class FlowSystem {
	readonly group = new Group();
	private readonly lines = new Map<string, FlowLine>();
	private flows: FlowSnapshot[] = [];
	private style: FlowStyle;
	private scale = 400;
	private dimmed = new Set<string>();
	private readonly hiddenPrefixes = new Set<string>();
	private focus: string[] | null = null;
	private visible = true;

	constructor(style: FlowStyle) {
		this.group.name = 'flows';
		this.style = style;
	}

	build(routes: FlowRoute[]): void {
		this.clear();
		for (const r of routes) {
			if (r.points.length < 2) continue;
			const radius = r.id.startsWith('device:') ? 0.03 : 0.06;
			const max = r.id.startsWith('device:')
				? Math.ceil(this.style.maxParticles / 3)
				: this.style.maxParticles;
			const line = new FlowLine(r.id, r.points, max, radius);
			line.setViewportScale(this.scale);
			this.lines.set(r.id, line);
			this.group.add(line.group);
		}
		this.setFocus(this.focus);
		this.refade(true);
		this.apply();
	}

	setStyle(style: FlowStyle): void {
		this.style = style;
		this.apply();
	}

	update(flows: FlowSnapshot[]): void {
		this.flows = flows;
		this.apply();
	}

	/** Dim every flow not in `focus` (null = no focus). Ids match exactly or by prefix. */
	setFocus(focus: string[] | null): void {
		this.focus = focus;
		this.dimmed = new Set(
			focus
				? [...this.lines.keys()].filter(
						(id) => !focus.some((f) => id === f || id.startsWith(f)),
					)
				: [],
		);
		this.refade();
	}

	/** Hide every flow whose id starts with `prefix`. */
	setHidden(prefix: string, hidden: boolean): void {
		if (hidden) this.hiddenPrefixes.add(prefix);
		else this.hiddenPrefixes.delete(prefix);
		this.refade();
	}

	setVisible(visible: boolean, immediate = false): void {
		this.visible = visible;
		this.refade(immediate);
	}

	private fadeFor(id: string): number {
		if (!this.visible) return 0;
		for (const p of this.hiddenPrefixes) if (id.startsWith(p)) return 0;
		return this.dimmed.has(id) ? 0.18 : 1;
	}

	private refade(immediate = false): void {
		this.lines.forEach((line, id) => line.setFade(this.fadeFor(id), immediate));
	}

	setViewportScale(scale: number): void {
		this.scale = scale;
		this.lines.forEach((l) => l.setViewportScale(scale));
	}

	private apply(): void {
		this.lines.forEach((line, id) => {
			line.setState(
				this.flows.find((f) => f.id === id),
				this.style,
			);
		});
	}

	animate(dt: number, time: number): boolean {
		let animating = false;
		this.lines.forEach((l) => {
			if (l.animate(dt, time)) animating = true;
		});
		return animating;
	}

	clear(): void {
		this.lines.forEach((l) => {
			this.group.remove(l.group);
			l.dispose();
		});
		this.lines.clear();
	}

	dispose(): void {
		this.clear();
	}
}
