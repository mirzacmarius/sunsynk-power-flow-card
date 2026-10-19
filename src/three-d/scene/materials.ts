/**
 * PBR material library with procedural (canvas) textures, so the card needs no
 * external assets at runtime.
 */
import {
	BoxGeometry,
	CanvasTexture,
	Color,
	DoubleSide,
	Material,
	MeshBasicMaterial,
	MeshStandardMaterial,
	RepeatWrapping,
	SRGBColorSpace,
	Texture,
} from 'three';

function canvas(
	w: number,
	h: number,
): [HTMLCanvasElement, CanvasRenderingContext2D] {
	const c = document.createElement('canvas');
	c.width = w;
	c.height = h;
	return [c, c.getContext('2d', { willReadFrequently: true })!];
}

/** Small deterministic PRNG so textures look the same on every load. */
function rng(seed: number) {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 4294967296;
	};
}

function noise(
	ctx: CanvasRenderingContext2D,
	w: number,
	h: number,
	amount: number,
	seed: number,
	size = 1,
) {
	const r = rng(seed);
	const img = ctx.getImageData(0, 0, w, h);
	const d = img.data;
	for (let y = 0; y < h; y += size) {
		for (let x = 0; x < w; x += size) {
			const v = (r() - 0.5) * amount;
			for (let yy = 0; yy < size && y + yy < h; yy++) {
				for (let xx = 0; xx < size && x + xx < w; xx++) {
					const i = ((y + yy) * w + (x + xx)) * 4;
					d[i] = Math.max(0, Math.min(255, d[i] + v));
					d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + v));
					d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + v));
				}
			}
		}
	}
	ctx.putImageData(img, 0, 0);
}

function texture(c: HTMLCanvasElement, repeat = true): Texture {
	const t = new CanvasTexture(c);
	t.colorSpace = SRGBColorSpace;
	if (repeat) {
		t.wrapS = RepeatWrapping;
		t.wrapT = RepeatWrapping;
	}
	return t;
}

function plasterTexture(): Texture {
	const [c, ctx] = canvas(256, 256);
	ctx.fillStyle = '#ffffff';
	ctx.fillRect(0, 0, 256, 256);
	noise(ctx, 256, 256, 14, 7, 1);
	noise(ctx, 256, 256, 8, 11, 4);
	return texture(c);
}

function woodTexture(): Texture {
	const [c, ctx] = canvas(512, 512);
	const r = rng(3);
	const plankW = 512 / 8;
	for (let i = 0; i < 8; i++) {
		const tone = 150 + r() * 40;
		ctx.fillStyle = `rgb(${tone + 40}, ${tone + 10}, ${tone - 30})`;
		const offset = r() * 512;
		ctx.fillRect(i * plankW, 0, plankW, 512);
		ctx.strokeStyle = 'rgba(70, 45, 25, 0.10)';
		for (let g = 0; g < 18; g++) {
			ctx.beginPath();
			const x = i * plankW + r() * plankW;
			ctx.moveTo(x, 0);
			ctx.bezierCurveTo(x + 4, 170, x - 4, 340, x + 2, 512);
			ctx.stroke();
		}
		ctx.fillStyle = 'rgba(40, 25, 15, 0.35)';
		ctx.fillRect(i * plankW, 0, 1.5, 512);
		ctx.fillRect(i * plankW, (offset % 512) | 0, plankW, 1.5);
	}
	noise(ctx, 512, 512, 10, 5, 2);
	return texture(c);
}

function paverTexture(): Texture {
	const [c, ctx] = canvas(512, 512);
	const r = rng(9);
	const n = 4;
	const s = 512 / n;
	for (let y = 0; y < n; y++) {
		for (let x = 0; x < n; x++) {
			const t = 196 + r() * 18;
			ctx.fillStyle = `rgb(${t}, ${t - 3}, ${t - 9})`;
			ctx.fillRect(x * s, y * s, s, s);
		}
	}
	noise(ctx, 512, 512, 16, 13, 2);
	ctx.strokeStyle = 'rgba(80, 80, 80, 0.55)';
	ctx.lineWidth = 3;
	for (let i = 0; i <= n; i++) {
		ctx.beginPath();
		ctx.moveTo(i * s, 0);
		ctx.lineTo(i * s, 512);
		ctx.moveTo(0, i * s);
		ctx.lineTo(512, i * s);
		ctx.stroke();
	}
	return texture(c);
}

function lawnTexture(): Texture {
	const [c, ctx] = canvas(512, 512);
	ctx.fillStyle = '#5a8846';
	ctx.fillRect(0, 0, 512, 512);
	noise(ctx, 512, 512, 18, 21, 1);
	noise(ctx, 512, 512, 12, 23, 8);
	const r = rng(17);
	for (let i = 0; i < 900; i++) {
		ctx.fillStyle =
			r() > 0.5 ? 'rgba(120, 170, 80, 0.25)' : 'rgba(40, 70, 30, 0.25)';
		ctx.fillRect(r() * 512, r() * 512, 1, 3 + r() * 4);
	}
	return texture(c);
}

function roofTexture(): Texture {
	const [c, ctx] = canvas(256, 256);
	ctx.fillStyle = '#9a9ea3';
	ctx.fillRect(0, 0, 256, 256);
	noise(ctx, 256, 256, 40, 31, 1);
	noise(ctx, 256, 256, 18, 33, 3);
	return texture(c);
}

function solarCellTexture(): Texture {
	// 6 × 20 half-cut cells, the common layout for ~430 Wp modules.
	const W = 384;
	const H = 584;
	const [c, ctx] = canvas(W, H);
	ctx.fillStyle = '#0c1220';
	ctx.fillRect(0, 0, W, H);
	const cols = 6;
	const rows = 20;
	const m = 8;
	const cw = (W - m * 2) / cols;
	const ch = (H - m * 2) / rows;
	const r = rng(41);
	for (let y = 0; y < rows; y++) {
		for (let x = 0; x < cols; x++) {
			const v = 22 + r() * 8;
			const g = ctx.createLinearGradient(0, m + y * ch, 0, m + (y + 1) * ch);
			g.addColorStop(0, `rgb(${v - 6}, ${v + 2}, ${v + 30})`);
			g.addColorStop(1, `rgb(${v - 10}, ${v - 4}, ${v + 18})`);
			ctx.fillStyle = g;
			ctx.fillRect(m + x * cw + 1, m + y * ch + 1, cw - 2, ch - 2);
			ctx.strokeStyle = 'rgba(170, 180, 195, 0.18)';
			ctx.lineWidth = 0.8;
			for (let b = 1; b <= 4; b++) {
				const bx = m + x * cw + (cw * b) / 5;
				ctx.beginPath();
				ctx.moveTo(bx, m + y * ch + 1);
				ctx.lineTo(bx, m + (y + 1) * ch - 1);
				ctx.stroke();
			}
		}
	}
	// half-cut gap
	ctx.fillStyle = '#d9dee6';
	ctx.fillRect(m, H / 2 - 1, W - m * 2, 2);
	return texture(c, false);
}

function concreteTexture(): Texture {
	const [c, ctx] = canvas(256, 256);
	ctx.fillStyle = '#c4c0b8';
	ctx.fillRect(0, 0, 256, 256);
	noise(ctx, 256, 256, 26, 51, 1);
	noise(ctx, 256, 256, 12, 53, 5);
	return texture(c);
}

export type MaterialKey =
	| 'wall'
	| 'wallInterior'
	| 'soffit'
	| 'coping'
	| 'frame'
	| 'glass'
	| 'railingGlass'
	| 'floorWood'
	| 'floorStone'
	| 'terrace'
	| 'paverEdge'
	| 'lawn'
	| 'roof'
	| 'door'
	| 'metalDark'
	| 'fabric'
	| 'fabricDark'
	| 'woodFurniture'
	| 'black'
	| 'whiteGloss'
	| 'foliage'
	| 'pot'
	| 'trunk'
	| 'hedge'
	| 'panel'
	| 'panelFrame'
	| 'rack'
	| 'equipmentWhite'
	| 'equipmentGrey'
	| 'display'
	| 'concrete'
	| 'kitchen'
	| 'bed';

export class MaterialLibrary {
	private readonly materials = new Map<MaterialKey, Material>();
	private readonly textures: Texture[] = [];
	private readonly ghosts = new Map<Material, Material>();
	private readonly extra: Material[] = [];

	constructor(private readonly anisotropy = 4) {
		const plaster = this.keep(plasterTexture());
		const wood = this.keep(woodTexture());
		wood.repeat.set(0.5, 0.5);
		const pavers = this.keep(paverTexture());
		pavers.repeat.set(1 / 2.4, 1 / 2.4);
		const lawn = this.keep(lawnTexture());
		lawn.repeat.set(1 / 5, 1 / 5);
		const roof = this.keep(roofTexture());
		roof.repeat.set(1 / 2, 1 / 2);
		const cells = this.keep(solarCellTexture());
		const concrete = this.keep(concreteTexture());
		const std = (
			params: ConstructorParameters<typeof MeshStandardMaterial>[0],
		) => new MeshStandardMaterial(params);

		this.materials.set(
			'wall',
			std({ color: '#e9e0d1', map: plaster, roughness: 0.92 }),
		);
		this.materials.set(
			'wallInterior',
			std({ color: '#ece6dc', map: plaster, roughness: 0.95 }),
		);
		this.materials.set('soffit', std({ color: '#e7e0d4', roughness: 0.95 }));
		this.materials.set(
			'coping',
			std({ color: '#2b2e33', roughness: 0.45, metalness: 0.45 }),
		);
		this.materials.set(
			'frame',
			std({ color: '#141619', roughness: 0.38, metalness: 0.55 }),
		);
		this.materials.set(
			'glass',
			std({
				color: '#9db6c6',
				roughness: 0.04,
				metalness: 0.2,
				transparent: true,
				opacity: 0.24,
				envMapIntensity: 1.6,
				side: DoubleSide,
				depthWrite: false,
			}),
		);
		this.materials.set(
			'railingGlass',
			std({
				color: '#d2ebe6',
				roughness: 0.03,
				metalness: 0.1,
				transparent: true,
				opacity: 0.17,
				envMapIntensity: 1.4,
				side: DoubleSide,
				depthWrite: false,
			}),
		);
		this.materials.set(
			'floorWood',
			std({ color: '#ffffff', map: wood, roughness: 0.62 }),
		);
		this.materials.set(
			'floorStone',
			std({ color: '#d9d4cb', map: plaster, roughness: 0.7 }),
		);
		this.materials.set(
			'terrace',
			std({ color: '#ffffff', map: pavers, roughness: 0.86 }),
		);
		this.materials.set('paverEdge', std({ color: '#3a3e44', roughness: 0.8 }));
		this.materials.set(
			'lawn',
			std({ color: '#ffffff', map: lawn, roughness: 1 }),
		);
		this.materials.set(
			'roof',
			std({ color: '#ffffff', map: roof, roughness: 0.96 }),
		);
		this.materials.set(
			'door',
			std({ color: '#232529', roughness: 0.5, metalness: 0.3 }),
		);
		this.materials.set(
			'metalDark',
			std({ color: '#3a3d42', roughness: 0.4, metalness: 0.7 }),
		);
		this.materials.set('fabric', std({ color: '#8d9199', roughness: 0.97 }));
		this.materials.set(
			'fabricDark',
			std({ color: '#4a4f57', roughness: 0.97 }),
		);
		this.materials.set(
			'woodFurniture',
			std({ color: '#ffffff', map: wood, roughness: 0.55 }),
		);
		this.materials.set(
			'black',
			std({ color: '#121315', roughness: 0.25, metalness: 0.2 }),
		);
		this.materials.set('whiteGloss', std({ color: '#f5f5f4', roughness: 0.3 }));
		this.materials.set('foliage', std({ color: '#3f7a3c', roughness: 0.92 }));
		this.materials.set('pot', std({ color: '#44474d', roughness: 0.7 }));
		this.materials.set('trunk', std({ color: '#6b4f3a', roughness: 0.95 }));
		this.materials.set('hedge', std({ color: '#3d6b39', roughness: 0.95 }));
		this.materials.set(
			'panel',
			std({
				color: '#ffffff',
				map: cells,
				roughness: 0.25,
				metalness: 0.3,
				envMapIntensity: 1.5,
			}),
		);
		this.materials.set(
			'panelFrame',
			std({ color: '#c9ced4', roughness: 0.32, metalness: 0.85 }),
		);
		this.materials.set(
			'rack',
			std({ color: '#9aa1a9', roughness: 0.45, metalness: 0.8 }),
		);
		this.materials.set(
			'equipmentWhite',
			std({ color: '#f2f3f5', roughness: 0.34, metalness: 0.05 }),
		);
		this.materials.set(
			'equipmentGrey',
			std({ color: '#6b7078', roughness: 0.45, metalness: 0.3 }),
		);
		this.materials.set(
			'display',
			std({ color: '#0a0d12', roughness: 0.15, metalness: 0.2 }),
		);
		this.materials.set(
			'concrete',
			std({ color: '#ffffff', map: concrete, roughness: 0.95 }),
		);
		this.materials.set('kitchen', std({ color: '#e9e6e1', roughness: 0.35 }));
		this.materials.set('bed', std({ color: '#e8e4dc', roughness: 0.95 }));

		for (const t of this.textures) t.anisotropy = this.anisotropy;
	}

	private keep(t: Texture): Texture {
		this.textures.push(t);
		return t;
	}

	get(key: MaterialKey): Material {
		return this.materials.get(key)!;
	}

	/** Emissive/unlit material owned by the library (disposed with it). */
	emissive(color: string, opacity = 1, additive = false): MeshBasicMaterial {
		const m = new MeshBasicMaterial({
			color: new Color(color),
			transparent: opacity < 1 || additive,
			opacity,
			toneMapped: false,
			depthWrite: !additive,
		});
		if (additive) m.blending = 2; // AdditiveBlending
		this.extra.push(m);
		return m;
	}

	track<T extends Material>(m: T): T {
		this.extra.push(m);
		return m;
	}

	/** Transparent stand-in used for "semi-transparent floor" views. */
	ghost(original: Material): Material {
		let g = this.ghosts.get(original);
		if (!g) {
			const src = original as MeshStandardMaterial;
			g = new MeshStandardMaterial({
				color: src.color ? src.color.clone() : new Color('#ffffff'),
				transparent: true,
				opacity: 0.1,
				depthWrite: false,
				roughness: 0.9,
			});
			this.ghosts.set(original, g);
		}
		return g;
	}

	dispose(): void {
		this.materials.forEach((m) => m.dispose());
		this.ghosts.forEach((m) => m.dispose());
		this.extra.forEach((m) => m.dispose());
		this.textures.forEach((t) => t.dispose());
		this.materials.clear();
		this.ghosts.clear();
	}
}

/**
 * Box geometry whose UVs are in metres (scaled per face), so tiling textures keep
 * their real-world size on boxes of any dimension.
 */
export function meterBox(w: number, h: number, d: number): BoxGeometry {
	const g = new BoxGeometry(w, h, d);
	const uv = g.attributes.uv;
	// face order: +x, -x, +y, -y, +z, -z (4 vertices each)
	const dims: [number, number][] = [
		[d, h],
		[d, h],
		[w, d],
		[w, d],
		[w, h],
		[w, h],
	];
	for (let f = 0; f < 6; f++) {
		for (let v = 0; v < 4; v++) {
			const i = f * 4 + v;
			uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]);
		}
	}
	uv.needsUpdate = true;
	return g;
}
