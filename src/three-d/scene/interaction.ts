/**
 * Pointer interaction: hover and click picking with a raycaster limited to the
 * registered pickable objects, plus a selection box highlight.
 */
import {
	Box3,
	BoxGeometry,
	Camera,
	EdgesGeometry,
	Group,
	LineBasicMaterial,
	LineSegments,
	Mesh,
	MeshBasicMaterial,
	Object3D,
	Raycaster,
	Vector2,
	Vector3,
} from 'three';

export interface PickResult {
	id: string;
	object: Object3D;
	instanceId?: number;
	point: Vector3;
}

export interface PointerInfo {
	clientX: number;
	clientY: number;
	/** position relative to the canvas, CSS pixels */
	x: number;
	y: number;
}

/** True when the object and all its ancestors are visible (proxies count as visible themselves). */
export function effectivelyVisible(obj: Object3D): boolean {
	let o: Object3D | null = obj.userData.proxy ? obj.parent : obj;
	while (o) {
		if (!o.visible) return false;
		o = o.parent;
	}
	return true;
}

export class Interaction {
	private readonly raycaster = new Raycaster();
	private readonly ndc = new Vector2();
	private down: { x: number; y: number; t: number } | null = null;
	private pending: PointerEvent | null = null;
	private raf = 0;
	private hoverId: string | null = null;
	private readonly listeners: [string, EventListener][] = [];

	constructor(
		private readonly dom: HTMLElement,
		private readonly getCamera: () => Camera,
		private readonly getPickables: () => Object3D[],
		private readonly onHover: (
			pick: PickResult | null,
			pointer: PointerInfo | null,
		) => void,
		private readonly onClick: (
			pick: PickResult | null,
			pointer: PointerInfo,
			double: boolean,
		) => void,
	) {
		this.raycaster.params.Line = { threshold: 0.05 };
		this.on('pointermove', (e) => this.schedule(e as PointerEvent));
		this.on('pointerleave', () => {
			this.pending = null;
			if (this.hoverId !== null) {
				this.hoverId = null;
				this.onHover(null, null);
			}
		});
		this.on('pointerdown', (e) => {
			const p = e as PointerEvent;
			this.down = { x: p.clientX, y: p.clientY, t: performance.now() };
		});
		this.on('pointerup', (e) => {
			const p = e as PointerEvent;
			if (!this.down) return;
			const moved = Math.hypot(
				p.clientX - this.down.x,
				p.clientY - this.down.y,
			);
			const quick = performance.now() - this.down.t < 600;
			this.down = null;
			if (moved < 6 && quick && p.button === 0) {
				this.onClick(this.pick(p), this.info(p), false);
			}
		});
		this.on('dblclick', (e) => {
			const p = e as MouseEvent;
			this.onClick(this.pick(p), this.info(p), true);
		});
	}

	private on(type: string, fn: EventListener): void {
		this.dom.addEventListener(type, fn);
		this.listeners.push([type, fn]);
	}

	private info(e: MouseEvent): PointerInfo {
		const r = this.dom.getBoundingClientRect();
		return {
			clientX: e.clientX,
			clientY: e.clientY,
			x: e.clientX - r.left,
			y: e.clientY - r.top,
		};
	}

	private schedule(e: PointerEvent): void {
		if (e.pointerType === 'touch') return; // no hover on touch
		this.pending = e;
		if (this.raf) return;
		this.raf = requestAnimationFrame(() => {
			this.raf = 0;
			const ev = this.pending;
			this.pending = null;
			if (!ev || this.down) return;
			const hit = this.pick(ev);
			const id = hit?.id ?? null;
			this.dom.style.cursor = id ? 'pointer' : '';
			this.hoverId = id;
			this.onHover(hit, this.info(ev));
		});
	}

	pick(e: MouseEvent): PickResult | null {
		const r = this.dom.getBoundingClientRect();
		if (!r.width || !r.height) return null;
		this.ndc.set(
			((e.clientX - r.left) / r.width) * 2 - 1,
			-((e.clientY - r.top) / r.height) * 2 + 1,
		);
		this.raycaster.setFromCamera(this.ndc, this.getCamera());
		const hits = this.raycaster.intersectObjects(this.getPickables(), false);
		for (const h of hits) {
			if (!effectivelyVisible(h.object)) continue;
			let o: Object3D | null = h.object;
			while (o && !o.userData.pick && o.userData.mpptId === undefined)
				o = o.parent;
			if (!o) continue;
			const id = o.userData.pick ?? `mppt:${o.userData.mpptId}`;
			return { id, object: h.object, instanceId: h.instanceId, point: h.point };
		}
		return null;
	}

	dispose(): void {
		if (this.raf) cancelAnimationFrame(this.raf);
		for (const [type, fn] of this.listeners)
			this.dom.removeEventListener(type, fn);
		this.listeners.length = 0;
		this.dom.style.cursor = '';
	}
}

/** Glowing box around the selected object(s). */
export class SelectionBox {
	readonly group = new Group();
	private readonly edgeMat: LineBasicMaterial;
	private readonly fillMat: MeshBasicMaterial;
	private readonly edges: LineSegments;
	private readonly fill: Mesh;
	private readonly geo = new BoxGeometry(1, 1, 1);
	private readonly edgeGeo: EdgesGeometry;
	private target: Object3D[] | null = null;
	private pad = 0.08;

	constructor(color: string) {
		this.edgeGeo = new EdgesGeometry(this.geo);
		this.edgeMat = new LineBasicMaterial({
			color,
			transparent: true,
			opacity: 0.95,
			depthTest: false,
			toneMapped: false,
		});
		this.fillMat = new MeshBasicMaterial({
			color,
			transparent: true,
			opacity: 0.06,
			depthWrite: false,
			toneMapped: false,
		});
		this.edges = new LineSegments(this.edgeGeo, this.edgeMat);
		this.edges.renderOrder = 20;
		this.fill = new Mesh(this.geo, this.fillMat);
		this.fill.renderOrder = 19;
		this.group.add(this.edges, this.fill);
		this.group.visible = false;
		this.group.name = 'selection';
	}

	set(objects: Object3D[] | null, pad = 0.08): void {
		this.target = objects && objects.length ? objects : null;
		this.pad = pad;
		this.refresh();
	}

	refresh(): void {
		if (!this.target) {
			this.group.visible = false;
			return;
		}
		const box = new Box3();
		for (const o of this.target) {
			o.updateWorldMatrix(true, true);
			box.expandByObject(o, true);
		}
		if (box.isEmpty()) {
			this.group.visible = false;
			return;
		}
		const size = box.getSize(new Vector3()).addScalar(this.pad * 2);
		const center = box.getCenter(new Vector3());
		const parent = this.group.parent;
		if (parent) parent.worldToLocal(center);
		this.group.position.copy(center);
		this.group.scale.copy(size);
		this.group.visible = true;
	}

	animate(time: number, reducedMotion: boolean): boolean {
		if (!this.group.visible) return false;
		this.edgeMat.opacity = reducedMotion
			? 0.95
			: 0.65 + 0.3 * Math.sin(time * 3.2);
		return !reducedMotion;
	}

	dispose(): void {
		this.geo.dispose();
		this.edgeGeo.dispose();
		this.edgeMat.dispose();
		this.fillMat.dispose();
	}
}
