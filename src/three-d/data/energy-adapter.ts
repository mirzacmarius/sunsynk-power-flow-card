/**
 * Builds the 3D view's EnergySnapshot from Home Assistant states, the classic card
 * config and the values the classic card already derived (its DataDto).
 *
 * Reuse rule: numbers that involve the card's sign conventions or formulas
 * (battery power incl. the Solis direction flip, total grid power incl. three-phase
 * sums and `invert_grid`, essential/non-essential load) are taken from the
 * classic card's DataDto, so both views always agree. The raw readings are only
 * used to decide whether those numbers are backed by available sensors.
 */
import {
	ConfigIssue,
	DeviceConfig,
	DeviceType,
	FlowColors,
	RoomConfig,
	ThreeDConfig,
	floorIndex,
	slug,
} from '../config';
import {
	BatterySnapshot,
	DeviceSnapshot,
	EnergySnapshot,
	EntityInfo,
	ExteriorLightSnapshot,
	FlowSnapshot,
	GridConnection,
	GridSnapshot,
	HomeSnapshot,
	InverterCategory,
	InverterSnapshot,
	LightSnapshot,
	MpptSnapshot,
	RoomSnapshot,
	SnapshotIssue,
} from './energy-model';
import {
	BASE_UNIT,
	Quantity,
	Reading,
	StatesLike,
	isEntityId,
	readEntity,
	readState,
	sumReadings,
} from './units';

/** The subset of the classic card's DataDto the adapter uses. */
export interface ClassicDerived {
	totalPV?: number;
	batteryPower?: number;
	battery2Power?: number;
	totalGridPower?: number;
	essentialPower?: number;
	nonessentialPower?: number;
	gridStatus?: string;
	inverterStateMsg?: string;
	inverterStateColour?: string;
	inverterModel?: string;
	isFloating?: boolean;
	isFloating2?: boolean;
	batteryEnergy?: number;
	battery2Energy?: number;
	batteryOneShutdown?: number;
	batteryTwoShutdown?: number;
	batteryShutdown?: number;
	batteryShutdown2?: number;
	maximumSOC?: number;
	batteryCapacity?: number;
	battery2Capacity?: number;
	batteryCount?: number;
}

/** The subset of the (merged) classic card config the adapter reads. */
export interface CardConfigLike {
	show_solar?: boolean;
	show_battery?: boolean;
	show_grid?: boolean;
	inverter?: { model?: string; three_phase?: boolean; [k: string]: unknown };
	battery?: { [k: string]: unknown };
	battery2?: { [k: string]: unknown };
	solar?: { [k: string]: unknown };
	load?: { [k: string]: unknown };
	grid?: { [k: string]: unknown };
	entities?: { [k: string]: unknown };
}

export interface AdapterInput {
	states: StatesLike;
	config: CardConfigLike;
	three: ThreeDConfig;
	derived?: ClassicDerived;
	/** today's energy (kWh) per entity id, from recorder statistics */
	todayEnergy?: ReadonlyMap<string, number>;
	configIssues?: ConfigIssue[];
	now?: Date;
}

const GRID_CONNECTED = ['on', '1', 'on-grid', 'on grid', 'ongrid', 'true'];
const GRID_DISCONNECTED = [
	'off',
	'0',
	'off-grid',
	'off grid',
	'offgrid',
	'false',
];
const OFF_STATES = [
	'off',
	'standby',
	'idle',
	'unavailable',
	'unknown',
	'paused',
];

export const PV_POWER_KEYS = [
	'pv1_power_186',
	'pv2_power_187',
	'pv3_power_188',
	'pv4_power_189',
	'pv5_power',
	'pv6_power',
];
export const PV_VOLTAGE_KEYS = [
	'pv1_voltage_109',
	'pv2_voltage_111',
	'pv3_voltage_113',
	'pv4_voltage_115',
	'pv5_voltage',
	'pv6_voltage',
];
export const PV_CURRENT_KEYS = [
	'pv1_current_110',
	'pv2_current_112',
	'pv3_current_114',
	'pv4_current_116',
	'pv5_current',
	'pv6_current',
];

function n(value: unknown, fallback: number): number {
	const v = typeof value === 'string' ? Number(value) : value;
	return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function synthetic(
	value: number | null,
	quantity: Quantity,
	entityId: string | null = null,
): Reading {
	return {
		entityId,
		configured: true,
		available: value !== null && Number.isFinite(value),
		value: value !== null && Number.isFinite(value) ? value : null,
		unit: BASE_UNIT[quantity],
		raw: null,
		problem: value === null ? 'unavailable' : undefined,
	};
}

function notConfigured(quantity: Quantity): Reading {
	return {
		entityId: null,
		configured: false,
		available: false,
		value: null,
		unit: BASE_UNIT[quantity],
		raw: null,
		problem: 'not_configured',
	};
}

function rgbToHex(rgb: [number, number, number]): string {
	return `#${rgb
		.map((c) =>
			Math.max(0, Math.min(255, Math.round(c)))
				.toString(16)
				.padStart(2, '0'),
		)
		.join('')}`;
}

function inverterCategory(colour: string | undefined): InverterCategory {
	switch ((colour ?? '').toLowerCase()) {
		case 'green':
			return 'normal';
		case 'blue':
			return 'standby';
		case 'red':
			return 'alarm';
		case 'purple':
			return 'selftest';
		default:
			return 'unknown';
	}
}

function deviceOn(entityId: string, state: string): boolean {
	const domain = entityId.split('.')[0];
	const s = state.toLowerCase();
	if (domain === 'climate') return s !== 'off';
	if (
		['light', 'switch', 'fan', 'input_boolean', 'binary_sensor'].includes(
			domain,
		)
	) {
		return s === 'on';
	}
	if (domain === 'media_player') return !OFF_STATES.includes(s);
	return !OFF_STATES.includes(s) && s !== '0';
}

export function buildEnergySnapshot(input: AdapterInput): EnergySnapshot {
	const { states, config, three, derived = {}, todayEnergy } = input;
	const entities = config.entities ?? {};
	const solarCfg = config.solar ?? {};
	const batteryCfg = config.battery ?? {};
	const battery2Cfg = config.battery2 ?? {};
	const gridCfg = config.grid ?? {};
	const loadCfg = config.load ?? {};
	const model = String(
		derived.inverterModel ?? config.inverter?.model ?? '',
	).toLowerCase();
	const threePhase = config.inverter?.three_phase === true;
	const minFlow = three.min_flow_power;
	const colors: FlowColors = three.colors;

	const ids = new Set<string>();
	const issues: SnapshotIssue[] = (input.configIssues ?? []).map((i) => ({
		level: i.level,
		code: 'config',
		subject: i.path,
		message: i.message,
	}));
	const reported = new Set<string>();

	const read = (key: string, quantity: Quantity, invert = false): Reading => {
		const id = entities[key];
		const r = readEntity(states, id, quantity, invert);
		if (r.entityId) {
			ids.add(r.entityId);
			if (r.problem === 'unit_mismatch' && !reported.has(r.entityId)) {
				reported.add(r.entityId);
				issues.push({
					level: 'warning',
					code: 'unit_mismatch',
					subject: r.entityId,
					message: `${r.entityId} reports "${r.unit}" but is configured as ${quantity} (entities.${key}).`,
				});
			}
			if (r.problem === 'missing' && !reported.has(r.entityId)) {
				reported.add(r.entityId);
				issues.push({
					level: 'warning',
					code: 'missing_entity',
					subject: r.entityId,
					message: `${r.entityId} (entities.${key}) does not exist in Home Assistant.`,
				});
			}
		}
		return r;
	};
	const readId = (id: unknown, quantity: Quantity, invert = false): Reading => {
		const r = readEntity(states, id, quantity, invert);
		if (r.entityId) ids.add(r.entityId);
		if (
			r.entityId &&
			r.problem === 'unit_mismatch' &&
			!reported.has(r.entityId)
		) {
			reported.add(r.entityId);
			issues.push({
				level: 'warning',
				code: 'unit_mismatch',
				subject: r.entityId,
				message: `${r.entityId} reports "${r.unit}" but is used as ${quantity}.`,
			});
		}
		return r;
	};
	const stateOf = (id: unknown) => {
		const s = readState(states, id);
		if (s.entityId) ids.add(s.entityId);
		return s;
	};
	/** Temperature from a sensor, or a climate entity's current_temperature attribute. */
	const readTemperature = (id: string | undefined): Reading => {
		if (!id) return notConfigured('temperature');
		if (id.startsWith('climate.')) {
			const s = stateOf(id);
			const v = s.attributes.current_temperature;
			const value =
				typeof v === 'number'
					? v
					: typeof v === 'string' &&
						  v.trim() !== '' &&
						  Number.isFinite(Number(v))
						? Number(v)
						: null;
			return {
				entityId: id,
				configured: true,
				available: s.available && value !== null,
				value: s.available ? value : null,
				unit: '°C',
				raw: value === null ? null : String(value),
				problem: s.available && value !== null ? undefined : 'unavailable',
			};
		}
		return readId(id, 'temperature');
	};

	// ---------- Solar ----------
	const solarOff = Math.max(n(solarCfg.off_threshold, 0), minFlow);
	const mpptReadings = three.solar.mppts.map((m) => {
		const idx = m.id - 1;
		return {
			cfg: m,
			power: read(PV_POWER_KEYS[idx], 'power'),
			voltage: read(PV_VOLTAGE_KEYS[idx], 'voltage'),
			current: read(PV_CURRENT_KEYS[idx], 'current'),
			energyToday: m.energy_today
				? readId(m.energy_today, 'energy')
				: notConfigured('energy'),
		};
	});
	const pvTotalConfigured = isEntityId(entities.pv_total);
	const solarTotal: Reading = pvTotalConfigured
		? read('pv_total', 'power')
		: sumReadings(
				mpptReadings.map((m) => m.power),
				'power',
			);
	const mpptSum = mpptReadings.reduce(
		(acc, m) => acc + (m.power.available ? Math.max(0, m.power.value ?? 0) : 0),
		0,
	);
	const env = buildEnvironment();

	const mppts: MpptSnapshot[] = mpptReadings.map((m) => {
		const idx = m.cfg.id - 1;
		const maxPower = n(solarCfg[`pv${idx + 1}_max_power`], 0);
		const value = m.power.available ? Math.max(0, m.power.value ?? 0) : null;
		const share = value !== null && mpptSum > 0 ? value / mpptSum : null;
		const name =
			m.cfg.name ??
			(typeof solarCfg[`pv${idx + 1}_name`] === 'string' &&
			solarCfg[`pv${idx + 1}_name`]
				? String(solarCfg[`pv${idx + 1}_name`])
				: `MPPT${m.cfg.id}`);
		return {
			id: m.cfg.id,
			name,
			orientation: m.cfg.orientation,
			panels: m.cfg.panels,
			power: m.power,
			voltage: m.voltage,
			current: m.current,
			energyToday: m.energyToday,
			share,
			efficiency:
				value !== null && maxPower > 0 ? Math.min(2, value / maxPower) : null,
			status:
				value === null
					? 'unavailable'
					: value > solarOff
						? 'producing'
						: 'idle',
		};
	});
	// Compare strings that share an orientation (or surface): data-backed underperformance only.
	for (const m of mppts) {
		if (m.status === 'unavailable') continue;
		const cfg = three.solar.mppts.find((x) => x.id === m.id)!;
		const group = (x: typeof cfg) => (x.orientation ?? x.surface).toLowerCase();
		const peers = mppts.filter((p) => {
			if (p.id === m.id || p.status === 'unavailable') return false;
			const pc = three.solar.mppts.find((x) => x.id === p.id)!;
			return group(pc) === group(cfg);
		});
		if (!peers.length) continue;
		const perPanel = (x: MpptSnapshot) =>
			(x.power.value ?? 0) / Math.max(1, x.panels);
		const best = peers.reduce((a, b) => (perPanel(b) > perPanel(a) ? b : a));
		if ((best.power.value ?? 0) < three.solar.min_compare_power) continue;
		const ratio = perPanel(m) / Math.max(1e-6, perPanel(best));
		m.peerId = best.id;
		m.peerRatio = Math.max(0, Math.min(1, ratio));
		const voltage = m.voltage.available ? (m.voltage.value ?? 0) : null;
		if ((m.power.value ?? 0) <= solarOff) {
			m.status = voltage !== null && voltage < 50 ? 'no_voltage' : 'inactive';
		} else if (ratio < three.solar.underperformance_ratio) {
			m.status = 'underperforming';
		}
	}

	// ---------- Batteries ----------
	const batteryCount =
		n(derived.batteryCount ?? batteryCfg.count, 1) === 2 ? 2 : 1;
	const batteries: BatterySnapshot[] = [];
	if (config.show_battery !== false) {
		for (let b = 1; b <= batteryCount; b++) {
			batteries.push(buildBattery(b));
		}
	}
	const batteryPower: Reading = batteries.length
		? (() => {
				const parts = batteries.map((x) => x.power);
				const broken = parts.find((p) => p.configured && !p.available);
				if (broken || !parts.some((p) => p.available)) {
					return { ...(broken ?? parts[0]), entityId: null };
				}
				return synthetic(
					parts.reduce((acc, p) => acc + (p.value ?? 0), 0),
					'power',
				);
			})()
		: notConfigured('power');

	// ---------- Grid ----------
	const grid = buildGrid();

	// ---------- Home ----------
	const home = buildHome();

	// ---------- Inverter ----------
	const inverter = buildInverter();

	// ---------- Flows ----------
	const flows: FlowSnapshot[] = [];
	const ratio = (power: number, max: number) =>
		max > 0 ? Math.max(0, Math.min(1, power / max)) : 0;
	const solarMaxTotal = n(solarCfg.max_power, 0);
	for (const m of mppts) {
		const value = m.power.available ? Math.max(0, m.power.value ?? 0) : 0;
		const max =
			n(solarCfg[`pv${m.id}_max_power`], 0) ||
			(solarMaxTotal ? solarMaxTotal / Math.max(1, mppts.length) : 5000);
		flows.push({
			id: `mppt${m.id}`,
			kind: 'solar',
			powerW: value,
			direction: 1,
			active: m.power.available && value > solarOff,
			available: m.power.available,
			ratio: ratio(value, max),
			color: colors.solar,
		});
	}
	if (batteries.length) {
		const p = batteryPower.available ? (batteryPower.value ?? 0) : 0;
		flows.push({
			id: 'battery',
			kind: 'battery',
			powerW: Math.abs(p),
			direction: p >= 0 ? 1 : -1,
			active:
				batteryPower.available &&
				Math.abs(p) > minFlow &&
				!batteries.every((x) => x.state === 'floating'),
			available: batteryPower.available,
			ratio: ratio(Math.abs(p), n(batteryCfg.max_power, 5000)),
			color: p >= 0 ? colors.battery_discharge : colors.battery_charge,
		});
	}
	if (config.show_grid !== false) {
		const p = grid.power.available ? (grid.power.value ?? 0) : 0;
		const gridOff = Math.max(n(gridCfg.off_threshold, 0), minFlow);
		flows.push({
			id: 'grid',
			kind: 'grid',
			powerW: Math.abs(p),
			direction: p >= 0 ? 1 : -1,
			active:
				grid.connection !== 'disconnected' &&
				grid.power.available &&
				Math.abs(p) > gridOff,
			available: grid.power.available && grid.connection !== 'disconnected',
			ratio: ratio(Math.abs(p), n(gridCfg.max_power, 10000)),
			color: p >= 0 ? colors.grid_import : colors.grid_export,
		});
	}
	{
		const p = home.essential.available
			? Math.max(0, home.essential.value ?? 0)
			: 0;
		const loadOff = Math.max(n(loadCfg.off_threshold, 0), minFlow);
		flows.push({
			id: 'home',
			kind: 'home',
			powerW: p,
			direction: 1,
			active: home.essential.available && p > loadOff,
			available: home.essential.available,
			ratio: ratio(p, n(loadCfg.max_power, 10000)),
			color: colors.home,
		});
	}
	if (home.nonessential) {
		const p = home.nonessential.available
			? Math.max(0, home.nonessential.value ?? 0)
			: 0;
		flows.push({
			id: 'nonessential',
			kind: 'nonessential',
			powerW: p,
			direction: 1,
			active: home.nonessential.available && p > minFlow,
			available: home.nonessential.available,
			ratio: ratio(p, n(gridCfg.max_power, 10000)),
			color: colors.home,
		});
	}

	// ---------- Rooms ----------
	const rooms = three.rooms.map((r) => buildRoom(r));

	// ---------- Exterior lights ----------
	const exteriorLights: ExteriorLightSnapshot[] = three.exterior_lights.map(
		(l) => {
			if (!l.entity) {
				return {
					zone: l.zone,
					entityId: null,
					on: null,
					color: l.color ?? null,
					brightness: 1,
				};
			}
			const s = stateOf(l.entity);
			const rgb = Array.isArray(s.attributes.rgb_color)
				? (s.attributes.rgb_color as [number, number, number])
				: null;
			const on = s.available ? s.state === 'on' : null;
			return {
				zone: l.zone,
				entityId: s.entityId,
				on,
				color: rgb ? rgbToHex(rgb) : (l.color ?? null),
				brightness:
					typeof s.attributes.brightness === 'number'
						? Math.max(0.05, (s.attributes.brightness as number) / 255)
						: 1,
			};
		},
	);

	return {
		timestamp: (input.now ?? new Date()).getTime(),
		solar: {
			available: solarTotal.available || mppts.some((m) => m.power.available),
			total: solarTotal,
			todayEnergy: read('day_pv_energy_108', 'energy'),
			remainingForecast: read('remaining_solar', 'energy'),
			mppts,
		},
		batteries,
		batteryPower,
		grid,
		home,
		inverter,
		flows,
		rooms,
		exteriorLights,
		environment: env,
		issues,
		entityIds: [...ids],
	};

	// ===== helpers (function declarations are hoisted) =====

	function buildEnvironment() {
		const sun = stateOf(three.sun_entity);
		const above =
			sun.available && sun.state
				? sun.state === 'above_horizon'
					? true
					: sun.state === 'below_horizon'
						? false
						: null
				: null;
		const azimuth =
			typeof sun.attributes.azimuth === 'number'
				? (sun.attributes.azimuth as number)
				: null;
		const elevation =
			typeof sun.attributes.elevation === 'number'
				? (sun.attributes.elevation as number)
				: null;
		let night: boolean;
		let nightSource: 'config' | 'sun' | 'clock';
		if (three.night_mode === 'on' || three.night_mode === 'off') {
			night = three.night_mode === 'on';
			nightSource = 'config';
		} else if (above !== null) {
			night = !above;
			nightSource = 'sun';
		} else {
			const hour = (input.now ?? new Date()).getHours();
			night = hour < 7 || hour >= 20;
			nightSource = 'clock';
		}
		return {
			sunAvailable: sun.available,
			aboveHorizon: above,
			azimuth,
			elevation,
			night,
			nightSource,
			outsideTemperature: read('environment_temp', 'temperature'),
		};
	}

	function buildBattery(index: 1 | 2 | number): BatterySnapshot {
		const p = index === 1 ? 'battery' : 'battery2';
		const cfg = index === 1 ? batteryCfg : battery2Cfg;
		const soc = read(`${p}_soc_184`, 'percent');
		const voltage = read(`${p}_voltage_183`, 'voltage');
		const current = read(`${p}_current_191`, 'current');
		const temperature = read(`${p}_temp_182`, 'temperature');
		const soh = read(`${p}_soh`, 'percent');
		const rawPower = read(`${p}_power_190`, 'power', cfg.invert_power === true);
		let powerAvailable = rawPower.available;
		// Solis reports an unsigned power plus a direction register (0 = charging).
		let raw = rawPower.value ?? 0;
		const dirKey = `${p}_current_direction`;
		if (model === 'solis' && isEntityId(entities[dirKey])) {
			const dir = read(dirKey, 'number');
			if (!dir.available) powerAvailable = false;
			else if (dir.value === 0) raw = -raw;
		}
		const derivedPower =
			index === 1 ? derived.batteryPower : derived.battery2Power;
		const native =
			typeof derivedPower === 'number' && Number.isFinite(derivedPower)
				? derivedPower
				: raw;
		// Classic semantics: invert_flow=false → positive = discharging.
		const normalised = cfg.invert_flow === true ? -native : native;
		const power: Reading = powerAvailable
			? { ...rawPower, value: normalised, unit: 'W' }
			: { ...rawPower, available: false, value: null };

		const threeCap = index === 1 ? three.battery.capacity : null;
		const derivedCap =
			index === 1 ? derived.batteryEnergy : derived.battery2Energy;
		const ratedConfigured = isEntityId(entities[`${p}_rated_capacity`]);
		let capacityWh: number | null = null;
		let capacitySource: BatterySnapshot['capacitySource'] = null;
		if (threeCap) {
			capacityWh = threeCap;
			capacitySource = 'three_d';
		} else if (typeof derivedCap === 'number' && derivedCap > 0) {
			capacityWh = derivedCap;
			capacitySource = ratedConfigured ? 'rated_capacity' : 'battery.energy';
		} else if (n(cfg.energy, 0) > 0) {
			capacityWh = n(cfg.energy, 0);
			capacitySource = 'battery.energy';
		}

		const shutdownDerived =
			index === 1 ? derived.batteryOneShutdown : derived.batteryTwoShutdown;
		const shutdownSoc =
			typeof shutdownDerived === 'number' && Number.isFinite(shutdownDerived)
				? shutdownDerived
				: n(cfg.shutdown_soc, NaN);
		const shutdown = Number.isFinite(shutdownSoc) ? shutdownSoc : null;
		const toShutdown = cfg.remaining_energy_to_shutdown === true;
		const socValue = soc.available ? (soc.value ?? 0) : null;

		let remainingWh: number | null = null;
		if (capacityWh !== null && socValue !== null) {
			const floor = toShutdown && shutdown !== null ? shutdown : 0;
			remainingWh = Math.max(0, (capacityWh * (socValue - floor)) / 100);
		}

		const floating =
			index === 1 ? derived.isFloating === true : derived.isFloating2 === true;
		const pv = power.available ? (power.value ?? 0) : 0;
		let state: BatterySnapshot['state'];
		if (!power.available) state = 'unavailable';
		else if (floating) state = 'floating';
		else if (Math.abs(pv) <= minFlow) state = 'idle';
		else state = pv > 0 ? 'discharging' : 'charging';

		const maxSoc = n(derived.maximumSOC ?? cfg.soc_end_of_charge, 100);
		const derivedTarget =
			index === 1 ? derived.batteryCapacity : derived.battery2Capacity;
		let targetSoc: number | null = null;
		let runtimeSeconds: number | null = null;
		let runtimeKind: BatterySnapshot['runtimeKind'] = null;
		if (
			capacityWh !== null &&
			socValue !== null &&
			(state === 'charging' || state === 'discharging')
		) {
			if (state === 'discharging') {
				targetSoc =
					typeof derivedTarget === 'number' &&
					derivedTarget > 0 &&
					derivedTarget < socValue
						? derivedTarget
						: (shutdown ?? 0);
				runtimeKind = 'to_shutdown';
			} else {
				targetSoc =
					typeof derivedTarget === 'number' && derivedTarget > socValue
						? derivedTarget
						: maxSoc;
				runtimeKind = 'to_full';
			}
			const energy = (capacityWh * Math.abs(socValue - targetSoc)) / 100;
			runtimeSeconds = Math.abs(pv) > 0 ? (energy / Math.abs(pv)) * 3600 : null;
		}

		return {
			index,
			available: power.available || soc.available,
			soc,
			voltage,
			current,
			power,
			temperature,
			soh,
			state,
			capacityWh,
			capacitySource,
			remainingWh,
			remainingToShutdown: toShutdown,
			shutdownSoc: shutdown,
			targetSoc,
			runtimeSeconds,
			runtimeKind,
			todayCharge: read(
				index === 1 ? 'day_battery_charge_70' : 'day_battery2_charge_70',
				'energy',
			),
			todayDischarge: read(
				index === 1 ? 'day_battery_discharge_71' : 'day_battery2_discharge_71',
				'energy',
			),
		};
	}

	function buildGrid(): GridSnapshot {
		const invertGrid = gridCfg.invert_grid === true;
		const ct = read('grid_ct_power_172', 'power', invertGrid);
		const ctL2 = read('grid_ct_power_L2', 'power', invertGrid);
		const ctL3 = read('grid_ct_power_L3', 'power', invertGrid);
		const ctTotalConfigured = isEntityId(entities.grid_ct_power_total);
		let availability: Reading;
		if (threePhase && ctTotalConfigured)
			availability = read('grid_ct_power_total', 'power', invertGrid);
		else if (threePhase) availability = sumReadings([ct, ctL2, ctL3], 'power');
		else availability = ct;
		const value =
			typeof derived.totalGridPower === 'number' &&
			Number.isFinite(derived.totalGridPower)
				? derived.totalGridPower
				: availability.value;
		const power: Reading = availability.available
			? { ...availability, value, unit: 'W' }
			: availability;

		const voltage = read('grid_voltage', 'voltage');
		let connection: GridConnection = 'connected';
		let connectionSource: GridSnapshot['connectionSource'] = 'assumed';
		if (model === 'solis' && voltage.configured) {
			connectionSource = 'grid_voltage';
			// Same 50 V rule the classic card uses, but an unreadable voltage stays "unknown".
			connection = voltage.available
				? (voltage.value ?? 0) > 50
					? 'connected'
					: 'disconnected'
				: 'unknown';
		} else if (isEntityId(entities.grid_connected_status_194)) {
			connectionSource = 'status_entity';
			const s = stateOf(entities.grid_connected_status_194);
			const v = (s.state ?? '').toLowerCase();
			connection = !s.available
				? 'unknown'
				: GRID_CONNECTED.includes(v)
					? 'connected'
					: GRID_DISCONNECTED.includes(v)
						? 'disconnected'
						: 'unknown';
		}
		const gridOff = Math.max(n(gridCfg.off_threshold, 0), minFlow);
		const pv = power.available ? (power.value ?? 0) : 0;
		let state: GridSnapshot['state'];
		if (connection === 'disconnected') state = 'disconnected';
		else if (!power.available) state = 'unavailable';
		else if (Math.abs(pv) <= gridOff) state = 'idle';
		else state = pv > 0 ? 'importing' : 'exporting';

		return {
			power,
			connection,
			connectionSource,
			state,
			voltage,
			frequency: read('load_frequency_192', 'frequency'),
			todayImport: read('day_grid_import_76', 'energy'),
			todayExport: read('day_grid_export_77', 'energy'),
			phases: threePhase ? [ct, ctL2, ctL3].filter((r) => r.configured) : [],
		};
	}

	function buildHome(): HomeSnapshot {
		const invertLoad = loadCfg.invert_load === true;
		const ess = entities.essential_power;
		const l1 = read('load_power_L1', 'power', invertLoad);
		const l2 = read('load_power_L2', 'power', invertLoad);
		const l3 = read('load_power_L3', 'power', invertLoad);
		let availability: Reading;
		let essentialSource: HomeSnapshot['essentialSource'];
		if (isEntityId(ess)) {
			availability = read('essential_power', 'power', invertLoad);
			essentialSource = 'essential_power';
		} else if (
			threePhase &&
			isEntityId(entities.load_power_L1) &&
			isEntityId(entities.load_power_L2)
		) {
			availability = sumReadings([l1, l2, l3], 'power');
			essentialSource = 'phase_sum';
		} else {
			const parts = [
				read('inverter_power_175', 'power'),
				read('grid_power_169', 'power'),
			];
			const aux = read('aux_power_166', 'power');
			if (aux.configured) parts.push(aux);
			availability = sumReadings(parts, 'power');
			essentialSource = 'computed';
		}
		const essentialValue =
			typeof derived.essentialPower === 'number' &&
			Number.isFinite(derived.essentialPower)
				? derived.essentialPower
				: availability.value;
		const essential: Reading = availability.available
			? { ...availability, value: essentialValue, unit: 'W' }
			: availability;

		let nonessential: Reading | null = null;
		if (gridCfg.show_nonessential === true) {
			const neAvail = isEntityId(entities.nonessential_power)
				? read('nonessential_power', 'power')
				: sumReadings(
						[
							read('grid_ct_power_172', 'power'),
							read('grid_power_169', 'power'),
						],
						'power',
					);
			const v =
				typeof derived.nonessentialPower === 'number' &&
				Number.isFinite(derived.nonessentialPower)
					? Math.max(0, derived.nonessentialPower)
					: neAvail.value;
			nonessential = neAvail.available
				? { ...neAvail, value: v, unit: 'W' }
				: neAvail;
		}
		const total: Reading =
			nonessential && essential.available && nonessential.available
				? synthetic((essential.value ?? 0) + (nonessential.value ?? 0), 'power')
				: nonessential && !nonessential.available
					? { ...nonessential, entityId: null }
					: essential;
		return {
			essential,
			essentialSource,
			nonessential,
			total,
			todayEnergy: read('day_load_energy_84', 'energy'),
			phases: [l1, l2, l3].filter((r) => r.configured),
		};
	}

	function buildInverter(): InverterSnapshot {
		const status = stateOf(entities.inverter_status_59);
		let code: string | null = status.available ? status.state : null;
		if (code !== null && model === 'solis' && Number.isFinite(Number(code))) {
			code = String(Math.round(Number(code)));
		}
		const category = status.available
			? inverterCategory(derived.inverterStateColour)
			: 'unknown';
		const voltages = [
			'inverter_voltage_154',
			'inverter_voltage_L2',
			'inverter_voltage_L3',
		]
			.map((k) => read(k, 'voltage'))
			.filter((r) => r.configured);
		const currents = [
			'inverter_current_164',
			'inverter_current_L2',
			'inverter_current_L3',
		]
			.map((k) => read(k, 'current'))
			.filter((r) => r.configured);

		const entityList: EntityInfo[] = [];
		const seen = new Set<string>();
		const addInfo = (id: string, label: string) => {
			if (seen.has(id)) return;
			seen.add(id);
			const st = states[id];
			ids.add(id);
			const s = st?.state ?? '';
			entityList.push({
				entityId: id,
				name: (st?.attributes?.friendly_name as string) || label,
				state: st ? String(s) : 'missing',
				unit: String(st?.attributes?.unit_of_measurement ?? ''),
				available:
					!!st && !['unavailable', 'unknown'].includes(String(s).toLowerCase()),
				lastChanged: st?.last_changed,
			});
		};
		for (const [key, value] of Object.entries(entities)) {
			if (isEntityId(value)) addInfo(value, key);
		}
		for (const id of three.inverter.extra_entities) addInfo(id, id);

		// Energy balance over the hub; only meaningful when every term is backed by data.
		let balanceResidualW: number | null = null;
		const solarOk = config.show_solar === false || solarTotal.available;
		const batOk = !batteries.length || batteryPower.available;
		const gridOk =
			config.show_grid === false ||
			grid.connection === 'disconnected' ||
			grid.power.available;
		if (solarOk && batOk && gridOk && home.total.available) {
			const solarW =
				config.show_solar === false ? 0 : Math.max(0, solarTotal.value ?? 0);
			const bat = batteries.length ? (batteryPower.value ?? 0) : 0;
			const g =
				grid.connection === 'disconnected' || config.show_grid === false
					? 0
					: (grid.power.value ?? 0);
			const sources = solarW + Math.max(0, bat) + Math.max(0, g);
			const sinks =
				(home.total.value ?? 0) + Math.max(0, -bat) + Math.max(0, -g);
			balanceResidualW = sources - sinks;
		}

		return {
			modelName: three.inverter.model_name,
			brand: model || 'sunsynk',
			status: {
				code,
				message: status.available ? (derived.inverterStateMsg ?? '') : '',
				color: status.available
					? (derived.inverterStateColour ?? 'transparent')
					: 'transparent',
				category,
				available: status.available,
			},
			fault: category === 'alarm',
			power: read('inverter_power_175', 'power'),
			temperature: read('radiator_temp_91', 'temperature'),
			dcTemperature: read('dc_transformer_temp_90', 'temperature'),
			frequency: read('load_frequency_192', 'frequency'),
			voltages,
			currents,
			entities: entityList,
			balanceResidualW,
		};
	}

	function todayFromStats(id: string | undefined): Reading {
		if (!id || !isEntityId(id)) return notConfigured('energy');
		const v = todayEnergy?.get(id);
		return v === undefined
			? {
					...notConfigured('energy'),
					configured: true,
					entityId: id,
					problem: 'unavailable',
				}
			: synthetic(v, 'energy', id);
	}

	function buildDevice(
		roomId: string,
		d: DeviceConfig,
		index: number,
	): DeviceSnapshot {
		const power = d.power ? readId(d.power, 'power') : notConfigured('power');
		const energyTotal = d.energy
			? readId(d.energy, 'energy')
			: notConfigured('energy');
		const energyToday = d.energy_today
			? readId(d.energy_today, 'energy')
			: d.energy
				? todayFromStats(d.energy)
				: notConfigured('energy');
		const temperature = readTemperature(d.temperature);
		const control =
			typeof d.control === 'string'
				? { entity: d.control, action: 'toggle' as const }
				: (d.control ?? null);
		const stateEntityId = d.state ?? (control ? control.entity : undefined);
		let on: boolean | null = null;
		let onSource: DeviceSnapshot['onSource'] = null;
		let stateText: string | null = null;
		if (stateEntityId) {
			const s = stateOf(stateEntityId);
			if (s.available && s.state !== null) {
				on = deviceOn(stateEntityId, s.state);
				onSource = 'state';
				const action = s.attributes.hvac_action;
				stateText =
					typeof action === 'string' ? `${s.state} · ${action}` : s.state;
			}
		}
		if (on === null && power.available) {
			on = (power.value ?? 0) > Math.max(5, n(loadCfg.off_threshold, 0));
			onSource = 'power';
		}
		if (control?.entity) ids.add(control.entity);
		return {
			id: d.id ?? `${roomId}_${index}`,
			roomId,
			name: d.name,
			type: (d.type ?? 'appliance') as DeviceType,
			icon: d.icon,
			power,
			energyToday,
			energyTotal,
			temperature,
			stateEntity: stateEntityId ?? null,
			stateText,
			on,
			onSource,
			control: control
				? { action: 'toggle', confirm: false, ...control }
				: null,
		};
	}

	function buildRoom(r: RoomConfig): RoomSnapshot {
		const id = r.id ?? slug(r.name);
		const devices = (r.devices ?? []).map((d, i) => buildDevice(id, d, i));
		let power: Reading;
		let powerSource: RoomSnapshot['powerSource'] = null;
		if (r.power) {
			power = readId(r.power, 'power');
			powerSource = 'entity';
		} else {
			const avail = devices.filter((d) => d.power.available);
			if (avail.length) {
				power = synthetic(
					avail.reduce((acc, d) => acc + Math.max(0, d.power.value ?? 0), 0),
					'power',
				);
				powerSource = 'devices';
			} else power = notConfigured('power');
		}
		let energyToday: Reading;
		if (r.energy_today) energyToday = readId(r.energy_today, 'energy');
		else if (r.energy) energyToday = todayFromStats(r.energy);
		else {
			const parts = devices.filter((d) => d.energyToday.available);
			energyToday = parts.length
				? synthetic(
						parts.reduce((acc, d) => acc + (d.energyToday.value ?? 0), 0),
						'energy',
					)
				: notConfigured('energy');
		}
		const lights: LightSnapshot[] = (r.lights ?? []).map((lid) => {
			const s = stateOf(lid);
			const rgb = Array.isArray(s.attributes.rgb_color)
				? (s.attributes.rgb_color as [number, number, number])
				: null;
			return {
				entityId: lid,
				available: s.available,
				on: s.available && s.state === 'on',
				brightness:
					typeof s.attributes.brightness === 'number'
						? Math.max(0.05, (s.attributes.brightness as number) / 255)
						: 1,
				rgb,
				name: (s.attributes.friendly_name as string) || lid,
			};
		});
		return {
			id,
			name: r.name,
			floor: floorIndex(r.floor) === 1 ? 'first' : 'ground',
			power,
			powerSource,
			energyToday,
			energyTotal: r.energy
				? readId(r.energy, 'energy')
				: notConfigured('energy'),
			temperature: readTemperature(r.temperature),
			humidity: r.humidity
				? readId(r.humidity, 'percent')
				: notConfigured('percent'),
			lights,
			devices,
		};
	}
}

/** Energy entity ids whose "today" value should come from recorder statistics. */
export function statisticsEnergyIds(three: ThreeDConfig): string[] {
	const out = new Set<string>();
	for (const r of three.rooms) {
		if (r.energy && !r.energy_today) out.add(r.energy);
		for (const d of r.devices ?? []) {
			if (d.energy && !d.energy_today) out.add(d.energy);
		}
	}
	return [...out];
}
