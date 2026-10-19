/**
 * History for the dashboard's bottom charts, read from Home Assistant's recorder
 * through the card's existing `hass` connection (`hass.callWS`), never a new socket.
 *
 * Long-term statistics (5-minute means) are used when the entity has them; plain
 * state history is the fallback. Derived series use the same formulas and sign
 * conventions as the live adapter.
 */
import { isEntityId, StatesLike } from './units';
import type { CardConfigLike } from './energy-adapter';
import { PV_POWER_KEYS } from './energy-adapter';

export interface HassWsLike {
	states: StatesLike;
	callWS<T>(msg: Record<string, unknown>): Promise<T>;
}

export interface Series {
	/** bin start times (ms) */
	t: number[];
	/** values (W), null when unknown */
	v: (number | null)[];
}

export interface PowerHistory {
	solar: Series | null;
	home: Series | null;
	battery: Series | null;
	grid: Series | null;
	from: number;
	to: number;
}

export interface DailyRow {
	date: number;
	solar: number | null;
	home: number | null;
	import: number | null;
	export: number | null;
	charge: number | null;
	discharge: number | null;
}

const BIN_MS = 5 * 60 * 1000;

type StatRow = {
	start: number | string;
	mean?: number | null;
	change?: number | null;
};

function toMs(v: number | string): number {
	if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
	return Date.parse(v);
}

function unitFactor(unit: string): number {
	const u = unit.toLowerCase();
	if (u === 'kw') return 1000;
	if (u === 'mw') return 1e6;
	return 1;
}

interface Recipe {
	terms: { id: string; sign: number }[];
	/** Solis: flip the sign of the sum when this entity's value is 0 */
	directionId?: string;
	/** apply after summing */
	invert?: boolean;
}

function ent(config: CardConfigLike, key: string): string | null {
	const v = config.entities?.[key];
	return isEntityId(v) ? (v as string) : null;
}

/** Same composition rules as the live adapter / classic card. */
export function historyRecipes(
	config: CardConfigLike,
	mpptCount: number,
): Record<'solar' | 'home' | 'battery' | 'grid', Recipe | null> {
	const threePhase = config.inverter?.three_phase === true;
	const solarIds = ent(config, 'pv_total')
		? [ent(config, 'pv_total')!]
		: PV_POWER_KEYS.slice(0, Math.max(1, mpptCount))
				.map((k) => ent(config, k))
				.filter((x): x is string => !!x);
	const solar: Recipe | null = solarIds.length
		? { terms: solarIds.map((id) => ({ id, sign: 1 })) }
		: null;

	let home: Recipe | null = null;
	const invertLoad = config.load?.invert_load === true ? -1 : 1;
	if (ent(config, 'essential_power'))
		home = {
			terms: [{ id: ent(config, 'essential_power')!, sign: invertLoad }],
		};
	else if (
		threePhase &&
		ent(config, 'load_power_L1') &&
		ent(config, 'load_power_L2')
	) {
		home = {
			terms: ['load_power_L1', 'load_power_L2', 'load_power_L3']
				.map((k) => ent(config, k))
				.filter((x): x is string => !!x)
				.map((id) => ({ id, sign: invertLoad })),
		};
	} else if (
		ent(config, 'inverter_power_175') &&
		ent(config, 'grid_power_169')
	) {
		home = {
			terms: [
				{ id: ent(config, 'inverter_power_175')!, sign: 1 },
				{ id: ent(config, 'grid_power_169')!, sign: 1 },
				...(ent(config, 'aux_power_166')
					? [{ id: ent(config, 'aux_power_166')!, sign: -1 }]
					: []),
			],
		};
	}

	let battery: Recipe | null = null;
	const bp = ent(config, 'battery_power_190');
	if (bp && config.show_battery !== false) {
		const invertPower = config.battery?.invert_power === true;
		const model = String(config.inverter?.model ?? '').toLowerCase();
		battery = {
			terms: [{ id: bp, sign: invertPower ? -1 : 1 }],
			directionId:
				model === 'solis'
					? (ent(config, 'battery_current_direction') ?? undefined)
					: undefined,
			invert: config.battery?.invert_flow === true,
		};
	}

	let grid: Recipe | null = null;
	const invertGrid = config.grid?.invert_grid === true ? -1 : 1;
	if (threePhase && ent(config, 'grid_ct_power_total')) {
		grid = {
			terms: [{ id: ent(config, 'grid_ct_power_total')!, sign: invertGrid }],
		};
	} else if (ent(config, 'grid_ct_power_172')) {
		const keys = threePhase
			? ['grid_ct_power_172', 'grid_ct_power_L2', 'grid_ct_power_L3']
			: ['grid_ct_power_172'];
		grid = {
			terms: keys
				.map((k) => ent(config, k))
				.filter((x): x is string => !!x)
				.map((id) => ({ id, sign: invertGrid })),
		};
	}
	if (config.show_grid === false) grid = null;
	return { solar, home, battery, grid };
}

export class HistoryService {
	constructor(private readonly getHass: () => HassWsLike | undefined) {}

	private async statistics(
		ids: string[],
		start: number,
		end: number,
		period: '5minute' | 'hour' | 'day',
		types: string[],
	) {
		const hass = this.getHass();
		if (!hass || !ids.length) return {} as Record<string, StatRow[]>;
		try {
			return await hass.callWS<Record<string, StatRow[]>>({
				type: 'recorder/statistics_during_period',
				start_time: new Date(start).toISOString(),
				end_time: new Date(end).toISOString(),
				statistic_ids: ids,
				period,
				types,
				units: { power: 'W', energy: 'kWh' },
			});
		} catch {
			return {} as Record<string, StatRow[]>;
		}
	}

	private async history(ids: string[], start: number, end: number) {
		const hass = this.getHass();
		if (!hass || !ids.length)
			return {} as Record<string, { s: string; lu: number }[]>;
		try {
			return await hass.callWS<Record<string, { s: string; lu: number }[]>>({
				type: 'history/history_during_period',
				start_time: new Date(start).toISOString(),
				end_time: new Date(end).toISOString(),
				entity_ids: ids,
				minimal_response: true,
				no_attributes: true,
				significant_changes_only: false,
			});
		} catch {
			return {} as Record<string, { s: string; lu: number }[]>;
		}
	}

	/** Power series on a 5-minute grid for the last `hours`. */
	async loadPower(
		config: CardConfigLike,
		mpptCount: number,
		hours: number,
		now = Date.now(),
	): Promise<PowerHistory> {
		const to = Math.floor(now / BIN_MS) * BIN_MS + BIN_MS;
		const from = to - hours * 3600 * 1000;
		const recipes = historyRecipes(config, mpptCount);
		const ids = new Set<string>();
		for (const r of Object.values(recipes)) {
			if (!r) continue;
			r.terms.forEach((x) => ids.add(x.id));
			if (r.directionId) ids.add(r.directionId);
		}
		const bins = Math.round((to - from) / BIN_MS);
		const t = Array.from({ length: bins }, (_, i) => from + i * BIN_MS);
		const values = new Map<string, (number | null)[]>();
		const stats = await this.statistics([...ids], from, to, '5minute', [
			'mean',
		]);
		const missing: string[] = [];
		for (const id of ids) {
			const rows = stats[id];
			if (!rows || !rows.length) {
				missing.push(id);
				continue;
			}
			const arr: (number | null)[] = new Array(bins).fill(null);
			for (const row of rows) {
				const i = Math.floor((toMs(row.start) - from) / BIN_MS);
				if (i >= 0 && i < bins && typeof row.mean === 'number')
					arr[i] = row.mean;
			}
			values.set(id, arr);
		}
		if (missing.length) {
			const hist = await this.history(missing, from, to);
			const states = this.getHass()?.states ?? {};
			for (const id of missing) {
				const rows = hist[id];
				if (!rows || !rows.length) continue;
				const factor = unitFactor(
					String(states[id]?.attributes?.unit_of_measurement ?? ''),
				);
				values.set(id, resampleSteps(rows, from, bins, factor));
			}
		}
		const build = (r: Recipe | null): Series | null => {
			if (!r) return null;
			const parts = r.terms.map((x) => ({ v: values.get(x.id), sign: x.sign }));
			if (parts.some((p) => !p.v)) return null;
			const dir = r.directionId ? values.get(r.directionId) : undefined;
			if (r.directionId && !dir) return null;
			const v = t.map((_, i) => {
				let sum = 0;
				for (const p of parts) {
					const x = p.v![i];
					if (x === null || x === undefined) return null;
					sum += x * p.sign;
				}
				if (dir) {
					const d = dir[i];
					if (d === null || d === undefined) return null;
					if (d < 0.5) sum = -sum;
				}
				return r.invert ? -sum : sum;
			});
			return v.some((x) => x !== null) ? { t, v } : null;
		};
		return {
			solar: build(recipes.solar),
			home: build(recipes.home),
			battery: build(recipes.battery),
			grid: build(recipes.grid),
			from,
			to,
		};
	}

	/** Daily energy totals (kWh) for the last `days`, from the classic card's daily sensors. */
	async loadDaily(
		config: CardConfigLike,
		days: number,
		now = new Date(),
	): Promise<DailyRow[]> {
		const keys = {
			solar: 'day_pv_energy_108',
			home: 'day_load_energy_84',
			import: 'day_grid_import_76',
			export: 'day_grid_export_77',
			charge: 'day_battery_charge_70',
			discharge: 'day_battery_discharge_71',
		} as const;
		const ids: Record<string, string> = {};
		for (const [k, key] of Object.entries(keys)) {
			const id = ent(config, key);
			if (id) ids[k] = id;
		}
		const start = new Date(now);
		start.setHours(0, 0, 0, 0);
		start.setDate(start.getDate() - (days - 1));
		const stats = await this.statistics(
			Object.values(ids),
			start.getTime(),
			now.getTime(),
			'day',
			['change'],
		);
		const rows: DailyRow[] = [];
		for (let i = 0; i < days; i++) {
			const d = new Date(start);
			d.setDate(start.getDate() + i);
			rows.push({
				date: d.getTime(),
				solar: null,
				home: null,
				import: null,
				export: null,
				charge: null,
				discharge: null,
			});
		}
		for (const [k, id] of Object.entries(ids)) {
			for (const row of stats[id] ?? []) {
				const ms = toMs(row.start);
				const idx = rows.findIndex(
					(r) => Math.abs(r.date - ms) < 13 * 3600 * 1000,
				);
				if (idx >= 0 && typeof row.change === 'number')
					(rows[idx] as unknown as Record<string, number | null>)[k] =
						row.change;
			}
		}
		return rows;
	}

	/** Today's consumption (kWh) of total-increasing energy sensors, via statistics. */
	async loadTodayChange(ids: string[]): Promise<Map<string, number>> {
		const out = new Map<string, number>();
		const hass = this.getHass();
		if (!hass) return out;
		await Promise.all(
			ids.map(async (id) => {
				try {
					const r = await hass.callWS<{ change?: number | null }>({
						type: 'recorder/statistic_during_period',
						statistic_id: id,
						calendar: { period: 'day' },
						types: ['change'],
						units: { energy: 'kWh' },
					});
					if (typeof r?.change === 'number') out.set(id, r.change);
				} catch {
					/* entity without statistics */
				}
			}),
		);
		return out;
	}

	/** One entity's 5-minute history (for the device detail sparkline). */
	async loadEntity(
		id: string,
		hours: number,
		now = Date.now(),
	): Promise<Series | null> {
		const to = Math.floor(now / BIN_MS) * BIN_MS + BIN_MS;
		const from = to - hours * 3600 * 1000;
		const bins = Math.round((to - from) / BIN_MS);
		const t = Array.from({ length: bins }, (_, i) => from + i * BIN_MS);
		const stats = await this.statistics([id], from, to, '5minute', ['mean']);
		let v: (number | null)[] | null = null;
		if (stats[id]?.length) {
			v = new Array(bins).fill(null);
			for (const row of stats[id]) {
				const i = Math.floor((toMs(row.start) - from) / BIN_MS);
				if (i >= 0 && i < bins && typeof row.mean === 'number') v[i] = row.mean;
			}
		} else {
			const hist = await this.history([id], from, to);
			if (hist[id]?.length) {
				const factor = unitFactor(
					String(
						this.getHass()?.states?.[id]?.attributes?.unit_of_measurement ?? '',
					),
				);
				v = resampleSteps(hist[id], from, bins, factor);
			}
		}
		return v && v.some((x) => x !== null) ? { t, v } : null;
	}
}

/** Time-weighted 5-minute means of a step series (HA minimal history rows). */
export function resampleSteps(
	rows: { s: string; lu: number }[],
	from: number,
	bins: number,
	factor = 1,
): (number | null)[] {
	const out: (number | null)[] = new Array(bins).fill(null);
	const pts = rows
		.map((r) => ({ t: toMs(r.lu), v: Number(r.s) }))
		.filter((p) => Number.isFinite(p.t))
		.sort((a, b) => a.t - b.t);
	if (!pts.length) return out;
	for (let i = 0; i < bins; i++) {
		const b0 = from + i * BIN_MS;
		const b1 = b0 + BIN_MS;
		let acc = 0;
		let covered = 0;
		for (let k = 0; k < pts.length; k++) {
			const s0 = Math.max(pts[k].t, b0);
			const s1 = Math.min(k + 1 < pts.length ? pts[k + 1].t : Date.now(), b1);
			if (s1 <= s0 || !Number.isFinite(pts[k].v)) continue;
			acc += pts[k].v * factor * (s1 - s0);
			covered += s1 - s0;
		}
		out[i] = covered > BIN_MS * 0.2 ? acc / covered : null;
	}
	return out;
}
