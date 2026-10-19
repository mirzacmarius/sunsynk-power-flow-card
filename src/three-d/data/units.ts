/**
 * Reading Home Assistant states safely and normalising units.
 *
 * Every reading says whether it is usable. `unknown`, `unavailable`, missing
 * entities and non-numeric states are reported as unavailable (value `null`),
 * never silently turned into 0.
 */

export type Quantity =
	| 'power'
	| 'energy'
	| 'voltage'
	| 'current'
	| 'percent'
	| 'temperature'
	| 'frequency'
	| 'number';

export type ReadingProblem =
	| 'not_configured'
	| 'missing'
	| 'unavailable'
	| 'unknown'
	| 'non_numeric'
	| 'unit_mismatch';

export interface Reading {
	entityId: string | null;
	configured: boolean;
	available: boolean;
	/** normalised value: W, kWh, V, A, %, °C/°F (as reported), Hz */
	value: number | null;
	/** unit after normalisation */
	unit: string;
	/** raw state string from HA */
	raw: string | null;
	problem?: ReadingProblem;
	friendlyName?: string;
	lastChanged?: string;
}

export interface HassStateLike {
	entity_id?: string;
	state: string;
	attributes?: Record<string, unknown>;
	last_changed?: string;
	last_updated?: string;
}

export type StatesLike = Record<string, HassStateLike | undefined>;

const UNAVAILABLE_STATES = new Set(['unavailable', 'none', 'null', '']);

const POWER_FACTORS: Record<string, number> = {
	w: 1,
	kw: 1000,
	mw: 1_000_000,
	gw: 1_000_000_000,
};
const ENERGY_FACTORS: Record<string, number> = {
	wh: 0.001,
	kwh: 1,
	mwh: 1000,
	gwh: 1_000_000,
};
const VOLTAGE_FACTORS: Record<string, number> = { v: 1, mv: 0.001, kv: 1000 };
const CURRENT_FACTORS: Record<string, number> = { a: 1, ma: 0.001 };

export const BASE_UNIT: Record<Quantity, string> = {
	power: 'W',
	energy: 'kWh',
	voltage: 'V',
	current: 'A',
	percent: '%',
	temperature: '°C',
	frequency: 'Hz',
	number: '',
};

export function isEntityId(id: unknown): id is string {
	return (
		typeof id === 'string' &&
		id !== 'none' &&
		/^[a-z_]+\.[a-z0-9_]+$/i.test(id.trim())
	);
}

function factorFor(
	quantity: Quantity,
	unit: string,
): number | null | 'mismatch' {
	const u = unit.trim().toLowerCase();
	switch (quantity) {
		case 'power':
			if (u === '') return 1; // many template sensors omit the unit; assume W
			if (u in POWER_FACTORS) return POWER_FACTORS[u];
			if (u in ENERGY_FACTORS) return 'mismatch';
			return null;
		case 'energy':
			if (u === '') return 1; // assume kWh
			if (u in ENERGY_FACTORS) return ENERGY_FACTORS[u];
			if (u in POWER_FACTORS) return 'mismatch';
			return null;
		case 'voltage':
			if (u === '') return 1;
			return u in VOLTAGE_FACTORS ? VOLTAGE_FACTORS[u] : null;
		case 'current':
			if (u === '') return 1;
			return u in CURRENT_FACTORS ? CURRENT_FACTORS[u] : null;
		default:
			return 1;
	}
}

/**
 * Read one entity and normalise it.
 * @param states  hass.states
 * @param entityId configured id (may be undefined/'none')
 * @param quantity what the value represents
 * @param invert   multiply by -1 (sign convention from config)
 */
export function readEntity(
	states: StatesLike | undefined,
	entityId: unknown,
	quantity: Quantity,
	invert = false,
): Reading {
	if (!isEntityId(entityId)) {
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
	const id = entityId.trim();
	const st = states?.[id];
	if (!st) {
		return {
			entityId: id,
			configured: true,
			available: false,
			value: null,
			unit: BASE_UNIT[quantity],
			raw: null,
			problem: 'missing',
		};
	}
	const raw =
		st.state === undefined || st.state === null ? '' : String(st.state);
	const base: Pick<
		Reading,
		'entityId' | 'configured' | 'raw' | 'friendlyName' | 'lastChanged'
	> = {
		entityId: id,
		configured: true,
		raw,
		friendlyName:
			typeof st.attributes?.friendly_name === 'string'
				? (st.attributes.friendly_name as string)
				: undefined,
		lastChanged: st.last_changed,
	};
	const lower = raw.trim().toLowerCase();
	if (lower === 'unknown') {
		return {
			...base,
			available: false,
			value: null,
			unit: BASE_UNIT[quantity],
			problem: 'unknown',
		};
	}
	if (UNAVAILABLE_STATES.has(lower)) {
		return {
			...base,
			available: false,
			value: null,
			unit: BASE_UNIT[quantity],
			problem: 'unavailable',
		};
	}
	const n = Number(raw);
	if (!Number.isFinite(n)) {
		return {
			...base,
			available: false,
			value: null,
			unit: BASE_UNIT[quantity],
			problem: 'non_numeric',
		};
	}
	const unit = String(st.attributes?.unit_of_measurement ?? '');
	const factor = factorFor(quantity, unit);
	if (factor === 'mismatch') {
		return {
			...base,
			available: false,
			value: null,
			unit,
			problem: 'unit_mismatch',
		};
	}
	if (quantity === 'temperature') {
		return {
			...base,
			available: true,
			value: invert ? -n : n,
			unit: unit || '°C',
		};
	}
	const f = factor ?? 1;
	const value = n * f * (invert ? -1 : 1);
	return {
		...base,
		available: true,
		value,
		unit: factor === null ? unit : BASE_UNIT[quantity],
	};
}

/** Read a non-numeric state (status text, on/off). */
export function readState(
	states: StatesLike | undefined,
	entityId: unknown,
): {
	entityId: string | null;
	available: boolean;
	state: string | null;
	attributes: Record<string, unknown>;
} {
	if (!isEntityId(entityId)) {
		return { entityId: null, available: false, state: null, attributes: {} };
	}
	const st = states?.[entityId.trim()];
	if (!st)
		return {
			entityId: entityId.trim(),
			available: false,
			state: null,
			attributes: {},
		};
	const lower = String(st.state ?? '').toLowerCase();
	return {
		entityId: entityId.trim(),
		available: lower !== 'unavailable' && lower !== 'unknown' && lower !== '',
		state: String(st.state ?? ''),
		attributes: st.attributes ?? {},
	};
}

/** Sum readings; available only when at least one part is available and none is configured-but-broken. */
export function sumReadings(parts: Reading[], quantity: Quantity): Reading {
	const configured = parts.filter((p) => p.configured);
	if (!configured.length) {
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
	const broken = configured.find((p) => !p.available);
	if (broken) {
		return { ...broken, entityId: null, raw: null };
	}
	return {
		entityId: null,
		configured: true,
		available: true,
		value: configured.reduce((acc, p) => acc + (p.value ?? 0), 0),
		unit: BASE_UNIT[quantity],
		raw: null,
	};
}

export interface NumberFormatOptions {
	locale?: string;
	useGrouping?: boolean;
}

/** Locale resolution mirrors Utils.formatNumberLocale (HA number_format setting). */
export function resolveNumberLocale(hass: unknown): NumberFormatOptions {
	const h = hass as {
		locale?: { number_format?: string; language?: string };
		language?: string;
		selectedLanguage?: string;
	} | null;
	const lang = h?.selectedLanguage || h?.locale?.language || h?.language;
	switch (h?.locale?.number_format) {
		case 'comma_decimal':
			return { locale: 'en-US' };
		case 'decimal_comma':
			return { locale: 'de-DE' };
		case 'space_comma':
			return { locale: 'fr-FR' };
		case 'none':
			return { locale: lang, useGrouping: false };
		case 'system':
			return { locale: undefined };
		default:
			return { locale: lang };
	}
}

export function formatNumber(
	value: number,
	decimals: number,
	opts: NumberFormatOptions = {},
): string {
	try {
		return value.toLocaleString(opts.locale, {
			minimumFractionDigits: decimals,
			maximumFractionDigits: decimals,
			useGrouping: opts.useGrouping ?? true,
		});
	} catch {
		return value.toFixed(decimals);
	}
}

export interface Formatted {
	value: string;
	unit: string;
}

/** W → "850 W" / "4.25 kW" / "1.20 MW". */
export function formatPower(
	watts: number | null | undefined,
	decimals = 2,
	opts: NumberFormatOptions = {},
	absolute = false,
): Formatted {
	if (watts === null || watts === undefined || !Number.isFinite(watts)) {
		return { value: '—', unit: '' };
	}
	const w = absolute ? Math.abs(watts) : watts;
	const a = Math.abs(w);
	if (a >= 1_000_000)
		return { value: formatNumber(w / 1_000_000, decimals, opts), unit: 'MW' };
	if (a >= 1000)
		return { value: formatNumber(w / 1000, decimals, opts), unit: 'kW' };
	return { value: formatNumber(Math.round(w), 0, opts), unit: 'W' };
}

/** kWh → "350 Wh" / "12.4 kWh" / "1.25 MWh". */
export function formatEnergy(
	kwh: number | null | undefined,
	decimals = 1,
	opts: NumberFormatOptions = {},
): Formatted {
	if (kwh === null || kwh === undefined || !Number.isFinite(kwh)) {
		return { value: '—', unit: '' };
	}
	const a = Math.abs(kwh);
	if (a >= 1000)
		return { value: formatNumber(kwh / 1000, 2, opts), unit: 'MWh' };
	if (a < 1 && a > 0)
		return { value: formatNumber(Math.round(kwh * 1000), 0, opts), unit: 'Wh' };
	return { value: formatNumber(kwh, decimals, opts), unit: 'kWh' };
}

export function formatPlain(
	value: number | null | undefined,
	unit: string,
	decimals = 1,
	opts: NumberFormatOptions = {},
): Formatted {
	if (value === null || value === undefined || !Number.isFinite(value)) {
		return { value: '—', unit: '' };
	}
	return { value: formatNumber(value, decimals, opts), unit };
}

/** seconds → "3 h 25 min" style parts, in the caller's words. */
export function splitDuration(seconds: number): {
	days: number;
	hours: number;
	minutes: number;
} {
	const s = Math.max(0, Math.floor(seconds));
	return {
		days: Math.floor(s / 86400),
		hours: Math.floor((s % 86400) / 3600),
		minutes: Math.floor((s % 3600) / 60),
	};
}
