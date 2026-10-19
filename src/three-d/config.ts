/**
 * Configuration for the optional 3D view (`view_mode: 3d`).
 *
 * Everything lives under the `three_d:` key of the card config. All options are
 * optional; `resolveThreeDConfig()` fills in defaults and returns validation
 * messages instead of throwing, so a bad 3D option never breaks the classic card.
 */

export type ViewMode = 'classic' | '3d';
export type Quality = 'auto' | 'low' | 'medium' | 'high';
export type NightModeSetting = 'auto' | 'on' | 'off';
export type CameraViewId = 'iso' | 'front' | 'rear' | 'left' | 'right' | 'top';
export type PresetId = 'overview' | 'solar' | 'battery' | 'rooms' | 'night';
export type FloorId = 'ground' | 'first';
export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

export type SummaryItemId =
	| 'solar_now'
	| 'solar_today'
	| 'home_now'
	| 'home_today'
	| 'battery_soc'
	| 'battery_power'
	| 'grid'
	| 'inverter';

export const ALL_SUMMARY_ITEMS: SummaryItemId[] = [
	'solar_now',
	'solar_today',
	'home_now',
	'home_today',
	'battery_soc',
	'battery_power',
	'grid',
	'inverter',
];

export interface FlowColors {
	solar: string;
	battery_charge: string;
	battery_discharge: string;
	home: string;
	grid_import: string;
	grid_export: string;
	fault: string;
	idle: string;
}

export const DEFAULT_FLOW_COLORS: FlowColors = {
	solar: '#ffb020',
	battery_charge: '#22c55e',
	battery_discharge: '#22d3ee',
	home: '#3b82f6',
	grid_import: '#a855f7',
	grid_export: '#2dd4bf',
	fault: '#ef4444',
	idle: '#64748b',
};

/** Parametric house dimensions in metres. See docs/3d/model-assumptions.md. */
export interface HouseSpec {
	floor_height: number;
	slab: number;
	parapet: number;
	left: {
		width: number;
		depth: number;
		/** ground-floor front wall set back under the cantilevered upper box */
		ground_setback: number;
		/** upper box overhang past the ground floor at the left end */
		cantilever_left: number;
		loggia_depth: number;
		/** solid wall left of the upper loggia opening */
		loggia_left_margin: number;
		/** solid band above the upper loggia opening */
		band_height: number;
	};
	right: {
		width: number;
		/** how far the right volume's front face projects past the left upper box */
		projection: number;
		frame_top: number;
		frame_left: number;
		frame_right: number;
		frame_bottom: number;
		frame_depth: number;
		frame_overhang: number;
		glazing_width: number;
		glazing_height: number;
		glazing_left_pier: number;
	};
	terrace_depth: number;
	plot_radius: number;
}

export const DEFAULT_HOUSE: HouseSpec = {
	floor_height: 3.15,
	slab: 0.3,
	parapet: 0.75,
	left: {
		width: 9.6,
		depth: 9.0,
		ground_setback: 1.6,
		cantilever_left: 0.8,
		loggia_depth: 1.7,
		loggia_left_margin: 0.9,
		band_height: 1.0,
	},
	right: {
		width: 6.3,
		projection: 5.5,
		frame_top: 1.5,
		frame_left: 0.6,
		frame_right: 1.2,
		frame_bottom: 0.7,
		frame_depth: 1.2,
		frame_overhang: 0.25,
		glazing_width: 4.2,
		glazing_height: 2.6,
		glazing_left_pier: 0.7,
	},
	terrace_depth: 3.6,
	plot_radius: 24,
};

export interface PanelSpec {
	width: number;
	height: number;
	thickness: number;
}

export interface SurfaceConfig {
	id: string;
	/** which flat roof the array sits on */
	roof: 'left' | 'right';
	/** offset of the array centre from the roof centre, metres [x, z] */
	offset: Vec2;
	/** compass direction the panels face, degrees (90 = east, 180 = south) */
	azimuth: number;
	tilt: number;
	rows: number;
	columns: number;
	orientation: 'portrait' | 'landscape';
	/** distance between rows along the facing direction (metres) */
	row_spacing?: number;
	column_gap: number;
	mount_height: number;
}

export interface MpptConfig {
	id: number;
	name?: string;
	/** free text shown in the UI, e.g. "East" */
	orientation?: string;
	surface: string;
	panels: number;
	/** first slot (row-major) on the surface used by this string */
	start?: number;
	/** optional per-MPPT energy-today sensor */
	energy_today?: string;
	/** optional nameplate power per panel (Wp) for normalised comparisons */
	panel_power?: number;
}

export interface DeviceControlConfig {
	entity: string;
	action?: 'toggle' | 'turn_on' | 'turn_off';
	confirm?: boolean;
}

export type DeviceType =
	| 'ac'
	| 'tv'
	| 'light'
	| 'heater'
	| 'appliance'
	| 'boiler'
	| 'pump'
	| 'ev'
	| 'other';

export interface DeviceConfig {
	id?: string;
	name: string;
	type?: DeviceType;
	icon?: string;
	power?: string;
	energy?: string;
	energy_today?: string;
	state?: string;
	temperature?: string;
	/** position inside the room, metres relative to the room's floor centre */
	position?: Vec3;
	control?: DeviceControlConfig | string;
}

export interface RoomConfig {
	id?: string;
	name: string;
	floor: FloorId | 0 | 1;
	/** footprint in house coordinates: [x, z, width, depth] in metres */
	bounds?: [number, number, number, number];
	power?: string;
	energy?: string;
	energy_today?: string;
	temperature?: string;
	humidity?: string;
	lights?: string[];
	devices?: DeviceConfig[];
}

export interface ExteriorLightConfig {
	entity?: string;
	zone:
		'upper_loggia' | 'lower_wall' | 'terrace' | 'right_loggia' | 'wall_lights';
	color?: string;
}

export interface ThreeDUserConfig {
	height?: number | string;
	language?: 'auto' | 'en' | 'ro';
	show_view_toggle?: boolean;
	quality?: Quality;
	max_fps?: number;
	idle_fps?: number;
	idle_timeout?: number;
	pixel_ratio_max?: number;
	animation_intensity?: number;
	/** flows below this power (W) are treated as idle; avoids animating sensor noise */
	min_flow_power?: number;
	reduced_motion?: 'auto' | boolean;
	night_mode?: NightModeSetting;
	sun_entity?: string;
	show_idle_paths?: boolean;
	show_labels?: boolean;
	solar_overlay?: boolean;
	semi_transparent_floors?: boolean;
	default_preset?: PresetId;
	camera?: {
		default_view?: CameraViewId;
		fov?: number;
		auto_rotate?: boolean;
		min_distance?: number;
		max_distance?: number;
		transition_ms?: number;
	};
	model?: {
		url?: string;
		scale?: number;
		position?: Vec3;
		rotation?: Vec3;
		hide_procedural?: boolean;
	};
	house?: Partial<
		Omit<HouseSpec, 'left' | 'right'> & {
			left: Partial<HouseSpec['left']>;
			right: Partial<HouseSpec['right']>;
		}
	>;
	compass?: { facade_azimuth?: number };
	solar?: {
		panel?: Partial<PanelSpec>;
		surfaces?: Partial<SurfaceConfig>[];
		mppts?: Partial<MpptConfig>[];
		underperformance_ratio?: number;
		min_compare_power?: number;
	};
	battery?: {
		capacity?: number;
		modules?: number | 'auto';
		position?: Vec3;
		rotation?: number;
		model_name?: string;
	};
	inverter?: {
		position?: Vec3;
		rotation?: number;
		model_name?: string;
		extra_entities?: string[];
	};
	grid?: { position?: Vec3 };
	rooms?: RoomConfig[];
	exterior_lights?: ExteriorLightConfig[];
	colors?: Partial<FlowColors>;
	statistics?: {
		summary?: SummaryItemId[];
		history?: boolean;
		history_hours?: number;
		daily_days?: number;
		refresh_minutes?: number;
	};
}

/** Fully resolved 3D config: every field present. */
export interface ThreeDConfig {
	height: string | null;
	language: 'auto' | 'en' | 'ro';
	show_view_toggle: boolean;
	quality: Quality;
	max_fps: number;
	idle_fps: number;
	idle_timeout: number;
	pixel_ratio_max: number;
	animation_intensity: number;
	min_flow_power: number;
	reduced_motion: 'auto' | boolean;
	night_mode: NightModeSetting;
	sun_entity: string;
	show_idle_paths: boolean;
	show_labels: boolean;
	solar_overlay: boolean;
	semi_transparent_floors: boolean;
	default_preset: PresetId;
	camera: {
		default_view: CameraViewId;
		fov: number;
		auto_rotate: boolean;
		min_distance: number;
		max_distance: number;
		transition_ms: number;
	};
	model: {
		url: string | null;
		scale: number;
		position: Vec3;
		rotation: Vec3;
		hide_procedural: boolean;
	};
	house: HouseSpec;
	compass: { facade_azimuth: number };
	solar: {
		panel: PanelSpec;
		surfaces: SurfaceConfig[];
		mppts: MpptConfig[];
		underperformance_ratio: number;
		min_compare_power: number;
	};
	battery: {
		capacity: number | null;
		modules: number | 'auto';
		position: Vec3 | null;
		rotation: number;
		model_name: string;
	};
	inverter: {
		position: Vec3 | null;
		rotation: number;
		model_name: string;
		extra_entities: string[];
	};
	grid: { position: Vec3 | null };
	rooms: RoomConfig[];
	/** true when `rooms` came from the user, false when derived from the classic load config */
	rooms_configured: boolean;
	exterior_lights: ExteriorLightConfig[];
	colors: FlowColors;
	statistics: {
		summary: SummaryItemId[];
		history: boolean;
		history_hours: number;
		daily_days: number;
		refresh_minutes: number;
	};
}

export interface ConfigIssue {
	level: 'warning' | 'error';
	path: string;
	message: string;
}

export const DEFAULT_PANEL: PanelSpec = {
	width: 1.134,
	height: 1.722,
	thickness: 0.035,
};

/** Default roof layout: east-facing rows on the right roof, south-facing rows on the left roof. */
export const DEFAULT_SURFACES: SurfaceConfig[] = [
	{
		id: 'east',
		roof: 'right',
		offset: [0, -0.6],
		azimuth: 90,
		tilt: 15,
		rows: 2,
		columns: 9,
		orientation: 'portrait',
		column_gap: 0.02,
		mount_height: 0.25,
	},
	{
		id: 'south',
		roof: 'left',
		offset: [0, -0.2],
		azimuth: 180,
		tilt: 15,
		rows: 4,
		columns: 5,
		orientation: 'landscape',
		column_gap: 0.02,
		mount_height: 0.25,
	},
];

export function defaultMppts(count: number): MpptConfig[] {
	const presets: MpptConfig[] = [
		{ id: 1, surface: 'east', panels: 9, start: 0, orientation: 'east' },
		{ id: 2, surface: 'east', panels: 9, start: 9, orientation: 'east' },
		{ id: 3, surface: 'south', panels: 9, start: 0, orientation: 'south' },
		{ id: 4, surface: 'south', panels: 9, start: 10, orientation: 'south' },
	];
	const out: MpptConfig[] = [];
	for (let i = 1; i <= Math.max(0, Math.min(count, 6)); i++) {
		out.push(
			presets[i - 1] ?? {
				id: i,
				surface: i % 2 ? 'east' : 'south',
				panels: 9,
			},
		);
	}
	return out;
}

const VIEW_IDS: CameraViewId[] = [
	'iso',
	'front',
	'rear',
	'left',
	'right',
	'top',
];
const PRESET_IDS: PresetId[] = [
	'overview',
	'solar',
	'battery',
	'rooms',
	'night',
];

function num(
	value: unknown,
	fallback: number,
	min = -Infinity,
	max = Infinity,
): number {
	const n = typeof value === 'string' ? Number(value) : (value as number);
	if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, n));
}

function isVec3(v: unknown): v is Vec3 {
	return (
		Array.isArray(v) &&
		v.length === 3 &&
		v.every((x) => typeof x === 'number' && Number.isFinite(x))
	);
}

function isVec2(v: unknown): v is Vec2 {
	return (
		Array.isArray(v) &&
		v.length === 2 &&
		v.every((x) => typeof x === 'number' && Number.isFinite(x))
	);
}

function str(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() !== '' && value !== 'none'
		? value.trim()
		: undefined;
}

export function slug(text: string): string {
	return (
		text
			.normalize('NFD')
			.replace(/[̀-ͯ]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '_')
			.replace(/^_+|_+$/g, '') || 'item'
	);
}

export function floorIndex(floor: RoomConfig['floor']): 0 | 1 {
	return floor === 1 || floor === 'first' ? 1 : 0;
}

/** Minimal shape of the classic card config that the 3D defaults read. */
export interface ClassicConfigLike {
	view_mode?: string;
	three_d?: ThreeDUserConfig;
	solar?: { mppts?: number; [key: string]: unknown };
	load?: { [key: string]: unknown };
	battery?: { energy?: unknown; [key: string]: unknown };
	entities?: { [key: string]: unknown };
}

export function resolveViewMode(
	config: { view_mode?: unknown } | null | undefined,
): ViewMode {
	return String(config?.view_mode ?? 'classic').toLowerCase() === '3d'
		? '3d'
		: 'classic';
}

const GROUND_WORDS = ['parter', 'ground', 'living', 'bucatarie', 'kitchen'];
const FIRST_WORDS = [
	'etaj',
	'first',
	'upstairs',
	'dormitor',
	'matrimonial',
	'bedroom',
];

function guessFloor(name: string): FloorId {
	const s = slug(name);
	if (FIRST_WORDS.some((w) => s.includes(w))) return 'first';
	if (GROUND_WORDS.some((w) => s.includes(w))) return 'ground';
	return 'ground';
}

function guessType(name: string, icon: string | undefined): DeviceType {
	const s = `${slug(name)} ${icon ?? ''}`;
	if (/air.?condition|daikin|climat|\bac\b|aer/.test(s)) return 'ac';
	if (/tele|\btv\b/.test(s)) return 'tv';
	if (/light|lumin|lamp|bulb/.test(s)) return 'light';
	if (/boiler|water.?heat/.test(s)) return 'boiler';
	if (/pump|pompa/.test(s)) return 'pump';
	if (/heat|incalz|radiator/.test(s)) return 'heater';
	if (/\bev\b|car|masina/.test(s)) return 'ev';
	return 'appliance';
}

/**
 * Rooms derived from the classic card's essential loads (load1..load6), used when the
 * user hasn't configured `three_d.rooms`. Devices are assigned to the ground or first
 * floor by keywords in their name (e.g. "Daikin Etaj" → first floor).
 */
export function deriveRoomsFromClassic(
	config: ClassicConfigLike,
	labels: { ground: string; first: string },
): RoomConfig[] {
	const load = config.load ?? {};
	const entities = config.entities ?? {};
	const count = Math.max(0, Math.min(6, Number(load.additional_loads ?? 0)));
	const ground: DeviceConfig[] = [];
	const first: DeviceConfig[] = [];
	for (let i = 1; i <= count; i++) {
		const name = str(load[`load${i}_name`]) ?? `Load ${i}`;
		const icon = str(load[`load${i}_icon`]);
		const device: DeviceConfig = {
			id: `load${i}`,
			name,
			icon: icon && icon !== 'default' ? icon : undefined,
			type: guessType(name, icon),
			power: str(entities[`essential_load${i}`]),
			energy: str(entities[`essential_load${i}_extra`]),
			state: str(load[`load${i}_switch`]),
		};
		(guessFloor(name) === 'first' ? first : ground).push(device);
	}
	return [
		{ id: 'ground', name: labels.ground, floor: 'ground', devices: ground },
		{ id: 'first', name: labels.first, floor: 'first', devices: first },
	];
}

export function resolveThreeDConfig(
	config: ClassicConfigLike,
	labels: { ground: string; first: string } = {
		ground: 'Ground floor',
		first: 'First floor',
	},
): { config: ThreeDConfig; issues: ConfigIssue[] } {
	const issues: ConfigIssue[] = [];
	const u: ThreeDUserConfig =
		config?.three_d && typeof config.three_d === 'object' ? config.three_d : {};

	const quality: Quality = (
		['auto', 'low', 'medium', 'high'] as const
	).includes(u.quality as Quality)
		? (u.quality as Quality)
		: 'auto';
	if (u.quality !== undefined && quality !== u.quality) {
		issues.push({
			level: 'warning',
			path: 'three_d.quality',
			message: `Unknown quality "${u.quality}", using auto.`,
		});
	}

	let height: string | null = null;
	if (typeof u.height === 'number' && u.height > 0) height = `${u.height}px`;
	else if (typeof u.height === 'string' && u.height.trim()) height = u.height;

	const house: HouseSpec = {
		...DEFAULT_HOUSE,
		...(u.house ?? {}),
		left: { ...DEFAULT_HOUSE.left, ...(u.house?.left ?? {}) },
		right: { ...DEFAULT_HOUSE.right, ...(u.house?.right ?? {}) },
	} as HouseSpec;
	// Clamp to keep the procedural model buildable.
	house.floor_height = num(
		house.floor_height,
		DEFAULT_HOUSE.floor_height,
		2.4,
		5,
	);
	house.left.width = num(house.left.width, DEFAULT_HOUSE.left.width, 3, 30);
	house.left.depth = num(house.left.depth, DEFAULT_HOUSE.left.depth, 3, 30);
	house.right.width = num(house.right.width, DEFAULT_HOUSE.right.width, 3, 30);
	house.right.projection = num(
		house.right.projection,
		DEFAULT_HOUSE.right.projection,
		0,
		15,
	);

	const panel: PanelSpec = {
		width: num(u.solar?.panel?.width, DEFAULT_PANEL.width, 0.5, 3),
		height: num(u.solar?.panel?.height, DEFAULT_PANEL.height, 0.5, 3),
		thickness: num(
			u.solar?.panel?.thickness,
			DEFAULT_PANEL.thickness,
			0.01,
			0.2,
		),
	};

	const surfaces: SurfaceConfig[] = (
		Array.isArray(u.solar?.surfaces) && u.solar!.surfaces!.length
			? u.solar!.surfaces!
			: DEFAULT_SURFACES
	).map((s, i) => {
		const base =
			DEFAULT_SURFACES.find((d) => d.id === s.id) ?? DEFAULT_SURFACES[0];
		return {
			id: str(s.id) ?? `surface_${i + 1}`,
			roof: s.roof === 'right' || s.roof === 'left' ? s.roof : base.roof,
			offset: isVec2(s.offset) ? s.offset : base.offset,
			azimuth: num(s.azimuth, base.azimuth, 0, 360),
			tilt: num(s.tilt, base.tilt, 0, 60),
			rows: Math.round(num(s.rows, base.rows, 1, 20)),
			columns: Math.round(num(s.columns, base.columns, 1, 40)),
			orientation:
				s.orientation === 'landscape' || s.orientation === 'portrait'
					? s.orientation
					: base.orientation,
			row_spacing:
				s.row_spacing !== undefined
					? num(s.row_spacing, 2, 0.5, 10)
					: undefined,
			column_gap: num(s.column_gap, base.column_gap, 0, 1),
			mount_height: num(s.mount_height, base.mount_height, 0, 2),
		};
	});

	const classicMppts = Math.round(num(config.solar?.mppts, 0, 0, 6));
	const mpptSource =
		Array.isArray(u.solar?.mppts) && u.solar!.mppts!.length
			? u.solar!.mppts!
			: defaultMppts(classicMppts || 4);
	const mppts: MpptConfig[] = [];
	for (const [i, m] of mpptSource.entries()) {
		const id = Math.round(num(m.id, i + 1, 1, 6));
		const surface = str(m.surface) ?? surfaces[0]?.id ?? 'east';
		if (!surfaces.some((s) => s.id === surface)) {
			issues.push({
				level: 'error',
				path: `three_d.solar.mppts[${i}].surface`,
				message: `Surface "${surface}" is not defined in three_d.solar.surfaces.`,
			});
			continue;
		}
		mppts.push({
			id,
			name: str(m.name),
			orientation: str(m.orientation),
			surface,
			panels: Math.round(num(m.panels, 9, 0, 60)),
			start:
				m.start !== undefined ? Math.round(num(m.start, 0, 0, 500)) : undefined,
			energy_today: str(m.energy_today),
			panel_power:
				m.panel_power !== undefined
					? num(m.panel_power, 0, 0, 1000)
					: undefined,
		});
	}
	// Check that every string fits on its surface.
	for (const s of surfaces) {
		const slots = s.rows * s.columns;
		let cursor = 0;
		for (const m of mppts.filter((x) => x.surface === s.id)) {
			const start = m.start ?? cursor;
			cursor = start + m.panels;
			if (cursor > slots) {
				issues.push({
					level: 'warning',
					path: `three_d.solar.mppts (MPPT${m.id})`,
					message: `MPPT${m.id} needs slots up to ${cursor} but surface "${s.id}" has ${slots} (${s.rows}×${s.columns}); extra panels are not drawn.`,
				});
			}
		}
	}

	const roomsConfigured = Array.isArray(u.rooms) && u.rooms.length > 0;
	const rooms: RoomConfig[] = roomsConfigured
		? u.rooms!.map((r, i) => ({
				...r,
				id: str(r.id) ?? slug(r.name ?? `room_${i + 1}`),
				name: r.name ?? `Room ${i + 1}`,
				floor: floorIndex(r.floor) === 1 ? 'first' : 'ground',
				devices: (r.devices ?? []).map((d, j) => ({
					...d,
					id:
						str(d.id) ??
						`${slug(r.name ?? 'room')}_${slug(d.name ?? `device_${j + 1}`)}`,
					name: d.name ?? `Device ${j + 1}`,
				})),
			}))
		: deriveRoomsFromClassic(config, labels);

	for (const [i, r] of rooms.entries()) {
		if (r.bounds !== undefined) {
			const b = r.bounds;
			if (
				!Array.isArray(b) ||
				b.length !== 4 ||
				!b.every((x) => typeof x === 'number' && Number.isFinite(x))
			) {
				issues.push({
					level: 'warning',
					path: `three_d.rooms[${i}].bounds`,
					message:
						'bounds must be [x, z, width, depth] in metres; using an automatic layout.',
				});
				r.bounds = undefined;
			}
		}
		for (const [j, d] of (r.devices ?? []).entries()) {
			const control =
				typeof d.control === 'string' ? { entity: d.control } : d.control;
			if (control) {
				const domain = String(control.entity ?? '').split('.')[0];
				if (!CONTROLLABLE_DOMAINS.includes(domain)) {
					issues.push({
						level: 'warning',
						path: `three_d.rooms[${i}].devices[${j}].control`,
						message: `"${control.entity}" can't be controlled from the card (only ${CONTROLLABLE_DOMAINS.join(', ')}).`,
					});
					d.control = undefined;
				} else {
					d.control = {
						entity: control.entity,
						action: control.action ?? 'toggle',
						confirm: control.confirm ?? false,
					};
				}
			}
		}
	}

	const colors: FlowColors = { ...DEFAULT_FLOW_COLORS };
	for (const key of Object.keys(DEFAULT_FLOW_COLORS) as (keyof FlowColors)[]) {
		const value = u.colors?.[key];
		if (typeof value === 'string' && value.trim()) colors[key] = value.trim();
	}

	const summary = Array.isArray(u.statistics?.summary)
		? u.statistics!.summary!.filter((s) => ALL_SUMMARY_ITEMS.includes(s))
		: ALL_SUMMARY_ITEMS;

	const resolved: ThreeDConfig = {
		height,
		language: u.language === 'en' || u.language === 'ro' ? u.language : 'auto',
		show_view_toggle: u.show_view_toggle !== false,
		quality,
		max_fps: num(u.max_fps, 60, 10, 144),
		idle_fps: num(u.idle_fps, 20, 1, 60),
		idle_timeout: num(u.idle_timeout, 90, 5, 3600),
		pixel_ratio_max: num(u.pixel_ratio_max, 2, 0.5, 3),
		animation_intensity: num(u.animation_intensity, 1, 0, 2),
		min_flow_power: num(u.min_flow_power, 10, 0, 10000),
		reduced_motion:
			typeof u.reduced_motion === 'boolean' ? u.reduced_motion : 'auto',
		night_mode:
			u.night_mode === 'on' || u.night_mode === 'off' ? u.night_mode : 'auto',
		sun_entity: str(u.sun_entity) ?? 'sun.sun',
		show_idle_paths: u.show_idle_paths !== false,
		show_labels: u.show_labels !== false,
		solar_overlay: u.solar_overlay === true,
		semi_transparent_floors: u.semi_transparent_floors !== false,
		default_preset: PRESET_IDS.includes(u.default_preset as PresetId)
			? (u.default_preset as PresetId)
			: 'overview',
		camera: {
			default_view: VIEW_IDS.includes(u.camera?.default_view as CameraViewId)
				? (u.camera!.default_view as CameraViewId)
				: 'iso',
			fov: num(u.camera?.fov, 32, 15, 75),
			auto_rotate: u.camera?.auto_rotate === true,
			min_distance: num(u.camera?.min_distance, 8, 1, 200),
			max_distance: num(u.camera?.max_distance, 90, 5, 500),
			transition_ms: num(u.camera?.transition_ms, 900, 0, 5000),
		},
		model: {
			url: str(u.model?.url) ?? null,
			scale: num(u.model?.scale, 1, 0.001, 1000),
			position: isVec3(u.model?.position) ? u.model!.position! : [0, 0, 0],
			rotation: isVec3(u.model?.rotation) ? u.model!.rotation! : [0, 0, 0],
			hide_procedural: u.model?.hide_procedural !== false,
		},
		house,
		compass: {
			facade_azimuth: num(u.compass?.facade_azimuth, 180, 0, 360),
		},
		solar: {
			panel,
			surfaces,
			mppts,
			underperformance_ratio: num(
				u.solar?.underperformance_ratio,
				0.6,
				0.1,
				0.95,
			),
			min_compare_power: num(u.solar?.min_compare_power, 150, 0, 20000),
		},
		battery: {
			capacity:
				u.battery?.capacity !== undefined
					? num(u.battery.capacity, 0, 0, 1e7) || null
					: null,
			modules:
				u.battery?.modules === 'auto' || u.battery?.modules === undefined
					? 'auto'
					: Math.round(num(u.battery.modules, 4, 1, 12)),
			position: isVec3(u.battery?.position) ? u.battery!.position! : null,
			rotation: num(u.battery?.rotation, 0, -360, 360),
			model_name: str(u.battery?.model_name) ?? 'Dyness Tower',
		},
		inverter: {
			position: isVec3(u.inverter?.position) ? u.inverter!.position! : null,
			rotation: num(u.inverter?.rotation, 0, -360, 360),
			model_name: str(u.inverter?.model_name) ?? 'Solis S6-EH3P20K-H',
			extra_entities: Array.isArray(u.inverter?.extra_entities)
				? u.inverter!.extra_entities!.filter(
						(e) => typeof e === 'string' && e.includes('.'),
					)
				: [],
		},
		grid: {
			position: isVec3(u.grid?.position) ? u.grid!.position! : null,
		},
		rooms,
		rooms_configured: roomsConfigured,
		exterior_lights: Array.isArray(u.exterior_lights)
			? u.exterior_lights.filter((l) => l && typeof l.zone === 'string')
			: [],
		colors,
		statistics: {
			summary: summary.length ? summary : ALL_SUMMARY_ITEMS,
			history: u.statistics?.history !== false,
			history_hours: num(u.statistics?.history_hours, 24, 1, 168),
			daily_days: Math.round(num(u.statistics?.daily_days, 7, 1, 31)),
			refresh_minutes: num(u.statistics?.refresh_minutes, 5, 1, 120),
		},
	};

	return { config: resolved, issues };
}

/** Entity domains the card may toggle, and only when `control` is configured explicitly. */
export const CONTROLLABLE_DOMAINS = [
	'light',
	'switch',
	'input_boolean',
	'fan',
	'climate',
	'media_player',
];

/** Keys whose change requires rebuilding the scene geometry (not just new values). */
export function structuralKey(c: ThreeDConfig): string {
	return JSON.stringify({
		house: c.house,
		model: c.model,
		compass: c.compass,
		solar: {
			panel: c.solar.panel,
			surfaces: c.solar.surfaces,
			mppts: c.solar.mppts.map((m) => [m.id, m.surface, m.panels, m.start]),
		},
		battery: [c.battery.modules, c.battery.position, c.battery.rotation],
		inverter: [c.inverter.position, c.inverter.rotation],
		grid: c.grid.position,
		rooms: c.rooms.map((r) => [
			r.id,
			r.floor,
			r.bounds,
			(r.devices ?? []).map((d) => [d.id, d.type, d.position]),
			(r.lights ?? []).length,
		]),
		lights: c.exterior_lights.map((l) => [l.zone, l.color]),
		quality: c.quality,
		fov: c.camera.fov,
	});
}
