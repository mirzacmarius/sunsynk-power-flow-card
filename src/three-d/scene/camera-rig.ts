/**
 * Camera presets and smooth transitions (front, rear, left, right, top, isometric,
 * and "focus on this object").
 */
import { Box3, PerspectiveCamera, Sphere, Vector3 } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CameraViewId } from '../config';

export interface Pose {
	position: Vector3;
	target: Vector3;
}

const VIEW_DIRS: Record<CameraViewId, Vector3> = {
	iso: new Vector3(0.78, 0.66, 1.0),
	front: new Vector3(0, 0.3, 1),
	rear: new Vector3(0, 0.36, -1),
	left: new Vector3(-1, 0.36, 0.06),
	right: new Vector3(1, 0.36, 0.06),
	top: new Vector3(0.0, 1, 0.14),
};

function ease(t: number): number {
	return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export class CameraRig {
	private tween: {
		from: Pose;
		to: Pose;
		start: number;
		duration: number;
	} | null = null;
	private readonly sphere = new Sphere();

	constructor(
		private readonly camera: PerspectiveCamera,
		private readonly controls: OrbitControls,
		bounds: Box3,
		private transitionMs: number,
	) {
		bounds.getBoundingSphere(this.sphere);
		controls.addEventListener('start', () => {
			this.tween = null;
		});
	}

	setBounds(bounds: Box3): void {
		bounds.getBoundingSphere(this.sphere);
	}

	setTransition(ms: number): void {
		this.transitionMs = ms;
	}

	private fitDistance(radius: number): number {
		const fov = (this.camera.fov * Math.PI) / 180;
		const aspect = Math.max(0.5, this.camera.aspect);
		const vertical = radius / Math.sin(fov / 2);
		const horizontal = radius / Math.sin(Math.atan(Math.tan(fov / 2) * aspect));
		return Math.max(vertical, horizontal) * 0.92;
	}

	viewPose(view: CameraViewId, scale = 1, lift = 0): Pose {
		const dir = VIEW_DIRS[view].clone().normalize();
		const target = this.sphere.center
			.clone()
			.add(new Vector3(0, -1.2 + lift, 0));
		// narrow (portrait-ish) stages need a little more room around the house
		const fit = this.camera.aspect < 1.3 ? 1.02 : 0.9;
		const dist = this.fitDistance(this.sphere.radius * fit * scale);
		return { position: target.clone().addScaledVector(dir, dist), target };
	}

	/** Pose looking at `center` from `fromDir` (or the current direction), framing `radius`. */
	focusPose(center: Vector3, radius: number, fromDir?: Vector3): Pose {
		const dir = (
			fromDir ?? this.camera.position.clone().sub(this.controls.target)
		)
			.clone()
			.normalize();
		if (dir.y < 0.25) {
			dir.y = 0.25;
			dir.normalize();
		}
		const dist = Math.max(
			this.controls.minDistance,
			this.fitDistance(Math.max(0.6, radius)),
		);
		return {
			position: center.clone().addScaledVector(dir, dist),
			target: center.clone(),
		};
	}

	goTo(pose: Pose, instant = false): void {
		const from: Pose = {
			position: this.camera.position.clone(),
			target: this.controls.target.clone(),
		};
		if (instant || this.transitionMs <= 0) {
			this.camera.position.copy(pose.position);
			this.controls.target.copy(pose.target);
			this.controls.update();
			this.tween = null;
			return;
		}
		this.tween = {
			from,
			to: pose,
			start: performance.now(),
			duration: this.transitionMs,
		};
	}

	get animating(): boolean {
		return this.tween !== null;
	}

	/** Advance the transition; returns true while moving. */
	animate(now: number): boolean {
		if (!this.tween) return false;
		const t = Math.min(1, (now - this.tween.start) / this.tween.duration);
		const k = ease(t);
		this.camera.position.lerpVectors(
			this.tween.from.position,
			this.tween.to.position,
			k,
		);
		this.controls.target.lerpVectors(
			this.tween.from.target,
			this.tween.to.target,
			k,
		);
		this.controls.update();
		if (t >= 1) this.tween = null;
		return true;
	}
}
