/**
 * A small stand-in for Home Assistant's `hass` object, for visual testing without
 * a real instance: states for every entity in demo-config.js, scenario presets,
 * gentle live jitter, `callService` (switches/lights toggle) and `callWS` answers
 * for the recorder statistics/history the 3D view asks for.
 */
const S = 'sensor.solis_s6_eh3p_';

const UNITS = {
	power: 'W',
	energy: 'kWh',
	voltage: 'V',
	current: 'A',
	temp: '°C',
	pct: '%',
	hz: 'Hz',
};

function sensor(state, unit = '', extra = {}) {
	return {
		state: String(state),
		attributes: { unit_of_measurement: unit, ...extra },
	};
}

/** Scenario presets: the numbers an installation like this one would report. */
export const SCENARIOS = {
	sunny_export: {
		label: 'Sunny midday · exporting',
		pv: [2100, 2000, 2600, 2500],
		pvV: [482, 474, 521, 515],
		soc: 64,
		battery: -3000, // + discharging, - charging (physical)
		home: 1200,
		grid: -5000, // + import, - export
		gridV: 231,
		status: 3,
		sun: { state: 'above_horizon', azimuth: 165, elevation: 34 },
		devices: { parter: 800, etaj: 3, tv: 110, lumini: 4.2 },
		lights: {
			matrimonial: 'off',
			dormitor: 'off',
			bucatarie: 'off',
			balcoane: 'off',
			terasa: 'off',
		},
		today: { pv: 19.9, load: 4.7, imp: 0.4, exp: 6.2, chg: 13.0, dis: 5.1 },
	},
	evening_discharge: {
		label: 'Evening · battery discharging',
		pv: [120, 110, 40, 35],
		pvV: [310, 300, 210, 205],
		soc: 48,
		battery: 2250,
		home: 2550,
		grid: 40,
		gridV: 229,
		status: 3,
		sun: { state: 'below_horizon', azimuth: 262, elevation: -4 },
		devices: { parter: 1200, etaj: 650, tv: 115, lumini: 85 },
		lights: {
			matrimonial: 'on',
			dormitor: 'on',
			bucatarie: 'on',
			balcoane: 'on',
			terasa: 'on',
		},
		today: { pv: 24.1, load: 11.2, imp: 0.6, exp: 6.9, chg: 13.4, dis: 7.8 },
	},
	night_grid_charge: {
		label: 'Night · charging from grid',
		pv: [0, 0, 0, 0],
		pvV: [3, 2, 3, 4],
		soc: 31,
		battery: -4000,
		home: 760,
		grid: 4790,
		gridV: 232,
		status: 3,
		sun: { state: 'below_horizon', azimuth: 20, elevation: -40 },
		devices: { parter: 3, etaj: 3, tv: 0, lumini: 12 },
		lights: {
			matrimonial: 'off',
			dormitor: 'off',
			bucatarie: 'off',
			balcoane: 'on',
			terasa: 'off',
		},
		today: { pv: 0, load: 1.1, imp: 3.9, exp: 0, chg: 3.2, dis: 0.4 },
	},
	grid_outage: {
		label: 'Grid outage · off-grid',
		pv: [900, 850, 700, 650],
		pvV: [455, 450, 470, 468],
		soc: 72,
		battery: 450,
		home: 3500,
		grid: 0,
		gridV: 0,
		status: 3,
		sun: { state: 'above_horizon', azimuth: 140, elevation: 22 },
		devices: { parter: 1400, etaj: 1100, tv: 110, lumini: 6 },
		lights: {
			matrimonial: 'off',
			dormitor: 'off',
			bucatarie: 'off',
			balcoane: 'off',
			terasa: 'off',
		},
		today: { pv: 9.4, load: 9.9, imp: 0, exp: 0, chg: 2.1, dis: 3.4 },
	},
	string_fault: {
		label: 'MPPT2 string fault',
		pv: [2300, 0, 2700, 1200],
		pvV: [486, 2.2, 519, 498],
		soc: 80,
		battery: -1500,
		home: 1100,
		grid: -3600,
		gridV: 230,
		status: 3,
		sun: { state: 'above_horizon', azimuth: 175, elevation: 38 },
		devices: { parter: 650, etaj: 3, tv: 0, lumini: 4.2 },
		lights: {
			matrimonial: 'off',
			dormitor: 'off',
			bucatarie: 'off',
			balcoane: 'off',
			terasa: 'off',
		},
		today: { pv: 14.2, load: 3.9, imp: 0.2, exp: 4.4, chg: 9.0, dis: 2.2 },
	},
	inverter_alarm: {
		label: 'Inverter alarm',
		pv: [0, 0, 0, 0],
		pvV: [480, 475, 520, 512],
		soc: 55,
		battery: 0,
		home: 650,
		grid: 650,
		gridV: 231,
		status: 4100,
		sun: { state: 'above_horizon', azimuth: 200, elevation: 30 },
		devices: { parter: 3, etaj: 3, tv: 110, lumini: 4 },
		lights: {
			matrimonial: 'off',
			dormitor: 'off',
			bucatarie: 'off',
			balcoane: 'off',
			terasa: 'off',
		},
		today: { pv: 6.0, load: 5.1, imp: 2.2, exp: 1.0, chg: 4.0, dis: 2.4 },
	},
	unavailable: {
		label: 'Sensors unavailable / missing',
		pv: [2100, 'unavailable', 2600, 2500],
		pvV: [482, 'unknown', 521, 515],
		soc: 'unavailable',
		battery: -3000,
		batteryDirection: 'unavailable',
		home: 1200,
		grid: 'unknown',
		gridV: 'unavailable',
		status: 'unavailable',
		sun: null,
		devices: { parter: 'unavailable', etaj: 3, tv: 110, lumini: 4.2 },
		lights: {
			matrimonial: 'unavailable',
			dormitor: 'off',
			bucatarie: 'off',
			balcoane: 'off',
			terasa: 'off',
		},
		today: {
			pv: 'unavailable',
			load: 4.7,
			imp: 0.4,
			exp: 'unknown',
			chg: 13.0,
			dis: 5.1,
		},
		missing: [`${S}pv_power_4`, 'sensor.tv_matrimonial_power'],
	},
};

function num(v, jitter) {
	if (typeof v !== 'number') return v;
	return v + (jitter ? (Math.random() - 0.5) * jitter : 0);
}

export function buildStates(name, { jitter = false } = {}) {
	const sc = SCENARIOS[name] ?? SCENARIOS.sunny_export;
	const j = (v, amount) =>
		jitter && typeof v === 'number' && v !== 0
			? num(v, Math.abs(v) * amount)
			: v;
	const r1 = (v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v);
	const r0 = (v) => (typeof v === 'number' ? Math.round(v) : v);
	const pv = sc.pv.map((p) => r0(j(p, 0.06)));
	const pvV = sc.pvV.map((v) => r1(j(v, 0.01)));
	const pvTotal = pv.every((p) => typeof p === 'number')
		? pv.reduce((a, b) => a + b, 0)
		: 'unavailable';
	const battery =
		typeof sc.battery === 'number' ? r0(j(sc.battery, 0.05)) : sc.battery;
	const home = r0(j(sc.home, 0.05));
	const grid = typeof sc.grid === 'number' ? r0(j(sc.grid, 0.05)) : sc.grid;
	const st = {};
	const put = (id, s) =>
		(st[id] = {
			entity_id: id,
			last_changed: new Date().toISOString(),
			last_updated: new Date().toISOString(),
			...s,
		});
	pv.forEach((p, i) => {
		put(
			`${S}pv_power_${i + 1}`,
			sensor(p, UNITS.power, {
				friendly_name: `Invertor Solis PV Power ${i + 1}`,
				device_class: 'power',
				state_class: 'measurement',
			}),
		);
		put(
			`${S}pv_voltage_${i + 1}`,
			sensor(pvV[i], UNITS.voltage, {
				friendly_name: `Invertor Solis PV Voltage ${i + 1}`,
			}),
		);
		const cur =
			typeof p === 'number' && typeof pvV[i] === 'number' && pvV[i] > 1
				? Math.round((p / pvV[i]) * 10) / 10
				: typeof p === 'number'
					? 0
					: 'unavailable';
		put(
			`${S}pv_current_${i + 1}`,
			sensor(cur, UNITS.current, {
				friendly_name: `Invertor Solis PV Current ${i + 1}`,
			}),
		);
	});
	put(
		`${S}total_pv_power`,
		sensor(pvTotal, UNITS.power, {
			friendly_name: 'Invertor Solis Total PV Power',
			state_class: 'measurement',
		}),
	);
	put(
		`${S}pv_today_energy_generation`,
		sensor(sc.today.pv, UNITS.energy, {
			friendly_name: 'Invertor Solis PV Today Energy Generation',
			state_class: 'total_increasing',
		}),
	);
	put(
		'sensor.solcast_pv_forecast_forecast_remaining_today',
		sensor(sc.sun?.state === 'above_horizon' ? 7.4 : 0, UNITS.energy, {
			friendly_name: 'Solcast Forecast Remaining Today',
		}),
	);
	put(
		'sensor.temperatura_exterioara',
		sensor(13.5, UNITS.temp, { friendly_name: 'Temperatura exterioară' }),
	);
	// battery: Solis reports unsigned power + direction (1 = discharging, 0 = charging);
	// the user's template sensor exposes -abs(power) and the card inverts it.
	const absB = typeof battery === 'number' ? Math.abs(battery) : battery;
	put(
		'sensor.solis_putere_baterie_incarcare',
		sensor(typeof absB === 'number' ? -absB : absB, UNITS.power, {
			friendly_name: 'Putere baterie (card)',
			state_class: 'measurement',
		}),
	);
	put(
		`${S}battery_power`,
		sensor(absB, UNITS.power, {
			friendly_name: 'Invertor Solis Battery Power',
		}),
	);
	put(
		`${S}battery_current_direction`,
		sensor(
			sc.batteryDirection ??
				(typeof battery === 'number' ? (battery > 0 ? 1 : 0) : 'unavailable'),
			'',
			{ friendly_name: 'Invertor Solis Battery Current Direction' },
		),
	);
	put(
		`${S}battery_soc`,
		sensor(sc.soc, UNITS.pct, {
			friendly_name: 'Invertor Solis Battery SOC',
			device_class: 'battery',
		}),
	);
	put(
		`${S}battery_soh`,
		sensor(100, UNITS.pct, { friendly_name: 'Invertor Solis Battery SOH' }),
	);
	put(
		`${S}battery_voltage`,
		sensor(
			typeof sc.soc === 'number'
				? Math.round((250 + sc.soc * 0.25) * 10) / 10
				: 'unavailable',
			UNITS.voltage,
			{ friendly_name: 'Invertor Solis Battery Voltage' },
		),
	);
	put(
		`${S}battery_voltage_bms`,
		sensor(265.5, UNITS.voltage, {
			friendly_name: 'Invertor Solis Battery Voltage (BMS)',
		}),
	);
	put(
		`${S}battery_current`,
		sensor(
			typeof absB === 'number'
				? Math.round((absB / 262) * 10) / 10
				: 'unavailable',
			UNITS.current,
			{ friendly_name: 'Invertor Solis Battery Current' },
		),
	);
	put(
		`${S}today_battery_charge_energy`,
		sensor(sc.today.chg, UNITS.energy, {
			friendly_name: 'Invertor Solis Today Battery Charge Energy',
			state_class: 'total_increasing',
		}),
	);
	put(
		`${S}today_battery_discharge_energy`,
		sensor(sc.today.dis, UNITS.energy, {
			friendly_name: 'Invertor Solis Today Battery Discharge Energy',
			state_class: 'total_increasing',
		}),
	);
	put(
		'sensor.consum_casa',
		sensor(home, UNITS.power, {
			friendly_name: 'Consum casă',
			state_class: 'measurement',
		}),
	);
	const phase = (k) => (typeof home === 'number' ? Math.round(home * k) : home);
	put(
		'sensor.solis_consum_faza_l1',
		sensor(phase(0.45), UNITS.power, { friendly_name: 'Consum faza L1' }),
	);
	put(
		'sensor.solis_consum_faza_l2',
		sensor(phase(0.3), UNITS.power, { friendly_name: 'Consum faza L2' }),
	);
	put(
		'sensor.solis_consum_faza_l3',
		sensor(phase(0.25), UNITS.power, { friendly_name: 'Consum faza L3' }),
	);
	put(
		`${S}backup_load_power`,
		sensor(home, UNITS.power, {
			friendly_name: 'Invertor Solis Backup Load power',
		}),
	);
	put(
		`${S}today_energy_consumption`,
		sensor(sc.today.load, UNITS.energy, {
			friendly_name: 'Invertor Solis Today Energy Consumption',
			state_class: 'total_increasing',
		}),
	);
	put(
		'sensor.putere_retea',
		sensor(grid, UNITS.power, {
			friendly_name: 'Putere rețea',
			state_class: 'measurement',
		}),
	);
	put(
		`${S}a_phase_voltage`,
		sensor(sc.gridV, UNITS.voltage, {
			friendly_name: 'Invertor Solis A Phase Voltage',
		}),
	);
	put(
		`${S}grid_frequency`,
		sensor(
			typeof sc.gridV === 'number' && sc.gridV > 50 ? 50.01 : 0,
			UNITS.hz,
			{ friendly_name: 'Invertor Solis Grid Frequency' },
		),
	);
	put(
		`${S}today_energy_imported_from_grid`,
		sensor(sc.today.imp, UNITS.energy, {
			friendly_name: 'Invertor Solis Today Energy Imported From Grid',
			state_class: 'total_increasing',
		}),
	);
	put(
		`${S}today_energy_fed_into_grid`,
		sensor(sc.today.exp, UNITS.energy, {
			friendly_name: 'Invertor Solis Today Energy Fed Into Grid',
			state_class: 'total_increasing',
		}),
	);
	['a', 'b', 'c'].forEach((p, i) => {
		put(
			`${S}backup_ac_voltage_phase_${p}`,
			sensor([231.3, 227.5, 232.6][i], UNITS.voltage, {
				friendly_name: `Invertor Solis Backup AC Voltage Phase ${p.toUpperCase()}`,
			}),
		);
		put(
			`${S}backup_ac_current_phase_${p}`,
			sensor(
				typeof home === 'number'
					? Math.round(((home * [0.45, 0.3, 0.25][i]) / 230) * 10) / 10
					: 'unavailable',
				UNITS.current,
				{
					friendly_name: `Invertor Solis Backup AC Current Phase ${p.toUpperCase()}`,
				},
			),
		);
	});
	put(
		`${S}temperature`,
		sensor(36.5, UNITS.temp, { friendly_name: 'Invertor Solis Temperature' }),
	);
	put(
		`${S}status_string`,
		sensor(
			sc.status === 4100
				? 'Alarm / Grid Overvoltage'
				: 'Bypass / Inverting / Running',
			'',
			{ friendly_name: 'Invertor Solis Status String' },
		),
	);
	put(
		`${S}pv_bus_voltage`,
		sensor(786.1, UNITS.voltage, {
			friendly_name: 'Invertor Solis PV Bus Voltage',
		}),
	);
	put(
		`${S}alarm_code_data`,
		sensor(sc.status === 4100 ? 4100 : 0, '', {
			friendly_name: 'Invertor Solis Alarm code data',
		}),
	);
	put(
		'sensor.solis_cod_stare_card',
		sensor(sc.status, '', { friendly_name: 'Solis cod stare (card)' }),
	);
	// loads
	const d = sc.devices;
	put(
		'sensor.daikin_parter_power',
		sensor(
			typeof d.parter === 'number' ? r0(j(d.parter, 0.05)) : d.parter,
			UNITS.power,
			{ friendly_name: 'Daikin Parter Power', state_class: 'measurement' },
		),
	);
	put(
		'sensor.daikin_etaj_power',
		sensor(r0(j(d.etaj, 0.05)), UNITS.power, {
			friendly_name: 'Daikin Etaj Power',
			state_class: 'measurement',
		}),
	);
	put(
		'sensor.tv_matrimonial_power',
		sensor(r0(j(d.tv, 0.03)), UNITS.power, {
			friendly_name: 'TV Matrimonial Power',
			state_class: 'measurement',
		}),
	);
	put(
		'sensor.lumini_estimat_power',
		sensor(r1(d.lumini), UNITS.power, {
			friendly_name: 'Lumini (estimat) power',
			state_class: 'measurement',
		}),
	);
	put(
		'sensor.daikin_parter_energy',
		sensor(41.37, UNITS.energy, {
			friendly_name: 'Daikin Parter Energy',
			state_class: 'total_increasing',
		}),
	);
	put(
		'sensor.daikin_etaj_energy',
		sensor(28.02, UNITS.energy, {
			friendly_name: 'Daikin Etaj Energy',
			state_class: 'total_increasing',
		}),
	);
	put(
		'sensor.tv_matrimonial_energy',
		sensor(12.58, UNITS.energy, {
			friendly_name: 'TV Matrimonial Energy',
			state_class: 'total_increasing',
		}),
	);
	put(
		'sensor.lumini_estimat_energy',
		sensor(3.8, UNITS.energy, {
			friendly_name: 'Lumini (estimat) energy',
			state_class: 'total',
		}),
	);
	put(
		'sensor.daikin_parter_inside_temperature',
		sensor(21.5, UNITS.temp, {
			friendly_name: 'Daikin Parter Temperatura interioară',
		}),
	);
	put(
		'sensor.daikin_etaj_temperatura_interioara',
		sensor(22.0, UNITS.temp, {
			friendly_name: 'Daikin Etaj Temperatura interioară',
		}),
	);
	const acOn = (p) => typeof p === 'number' && p > 50;
	put('switch.daikin_parter_power', {
		state: acOn(d.parter) ? 'on' : 'off',
		attributes: { friendly_name: 'Daikin Parter Power' },
	});
	put('switch.daikin_etaj_power', {
		state: acOn(d.etaj) ? 'on' : 'off',
		attributes: { friendly_name: 'Daikin Etaj Power' },
	});
	put('climate.daikin_parter', {
		state: acOn(d.parter) ? 'heat' : 'off',
		attributes: {
			friendly_name: 'Daikin Parter',
			hvac_action: acOn(d.parter) ? 'heating' : 'off',
			current_temperature: 21.5,
		},
	});
	put('climate.daikin_etaj', {
		state: acOn(d.etaj) ? 'heat' : 'off',
		attributes: {
			friendly_name: 'Daikin Etaj',
			hvac_action: acOn(d.etaj) ? 'heating' : 'off',
			current_temperature: 22,
		},
	});
	put('climate.termostat_living', {
		state: 'heat',
		attributes: {
			friendly_name: 'Încălzire Living',
			current_temperature: 21.8,
		},
	});
	put('climate.termostat_matrimonial', {
		state: 'heat',
		attributes: {
			friendly_name: 'Încălzire Matrimonial',
			current_temperature: 20.6,
		},
	});
	put('media_player.samsung_qn85aa_55_tv', {
		state: typeof d.tv === 'number' && d.tv > 20 ? 'on' : 'off',
		attributes: { friendly_name: 'Samsung QN85A 55' },
	});
	const L = sc.lights;
	const light = (id, state, name, rgb) =>
		put(id, {
			state,
			attributes: {
				friendly_name: name,
				brightness: 200,
				...(rgb ? { rgb_color: rgb } : {}),
			},
		});
	light('light.lumini_matrimonial', L.matrimonial, 'Lumini matrimonial');
	light('light.lumini_dormitor', L.dormitor, 'Lumini dormitor');
	light('light.lumini_geam_bucatarie', L.bucatarie, 'Lumini geam bucătărie');
	light('light.lumini_balcoane', L.balcoane, 'Lumini balcoane', [217, 70, 239]);
	light('light.lumini_terasa', L.terasa, 'Lumini terasă', [34, 211, 238]);
	if (sc.sun)
		put('sun.sun', {
			state: sc.sun.state,
			attributes: {
				friendly_name: 'Sun',
				azimuth: sc.sun.azimuth,
				elevation: sc.sun.elevation,
			},
		});
	for (const id of sc.missing ?? []) delete st[id];
	return st;
}

// ---------------------------------------------------------------- recorder answers

const BIN = 5 * 60 * 1000;

function solarCurve(t) {
	const d = new Date(t);
	const h = d.getHours() + d.getMinutes() / 60;
	if (h < 7.2 || h > 18.4) return 0;
	const x = (h - 7.2) / (18.4 - 7.2);
	return Math.pow(Math.sin(Math.PI * x), 1.6);
}

function homeCurve(t) {
	const d = new Date(t);
	const h = d.getHours() + d.getMinutes() / 60;
	let w = 380 + 120 * Math.sin(t / 3.7e6);
	if (h > 6.5 && h < 8.5) w += 900;
	if (h > 12 && h < 13.5) w += 1400;
	if (h > 18 && h < 22.5) w += 1800 + 400 * Math.sin(t / 9e5);
	return w;
}

/** Physically consistent synthetic day: battery covers home at night, solar charges then exports. */
function simulate(from, to) {
	const out = {};
	let soc = 38;
	for (let t = from; t < to; t += BIN) {
		const pvTotal = 9800 * solarCurve(t) * (0.85 + 0.15 * Math.sin(t / 2.1e6));
		const parts = [0.22, 0.21, 0.29, 0.28].map(
			(k, i) =>
				pvTotal *
				k *
				(i < 2 ? 1 + 0.25 * Math.cos((new Date(t).getHours() - 9) / 4) : 1),
		);
		const home = homeCurve(t);
		let surplus = pvTotal - home;
		let battery = 0; // + discharge
		if (surplus > 0 && soc < 99) battery = -Math.min(surplus, 6000);
		else if (surplus < 0 && soc > 12) battery = Math.min(-surplus, 6000);
		const grid = home - pvTotal - battery; // + import
		// W × ms → kWh, as % of a 25.6 kWh battery
		soc = Math.max(
			10,
			Math.min(100, soc - ((battery * BIN) / 3.6e9 / 25.6) * 100),
		);
		out[t] = { parts, pvTotal, home, battery, grid };
	}
	return out;
}

export function makeCallWS(getStates) {
	return async (msg) => {
		await new Promise((r) => setTimeout(r, 120));
		const now = Date.now();
		if (msg.type === 'recorder/statistics_during_period') {
			const from = Date.parse(msg.start_time);
			const to = Date.parse(msg.end_time ?? new Date(now).toISOString());
			const res = {};
			if (msg.period === '5minute') {
				const sim = simulate(
					Math.floor(from / BIN) * BIN,
					Math.min(to, now - BIN),
				);
				const map = {
					[`${S}total_pv_power`]: (x) => x.pvTotal,
					[`${S}pv_power_1`]: (x) => x.parts[0],
					[`${S}pv_power_2`]: (x) => x.parts[1],
					[`${S}pv_power_3`]: (x) => x.parts[2],
					[`${S}pv_power_4`]: (x) => x.parts[3],
					'sensor.consum_casa': (x) => x.home,
					// the template sensor is -abs(battery); direction gives the sign
					'sensor.solis_putere_baterie_incarcare': (x) => -Math.abs(x.battery),
					[`${S}battery_current_direction`]: (x) => (x.battery > 0 ? 1 : 0),
					'sensor.putere_retea': (x) => x.grid,
					'sensor.daikin_parter_power': (x) => Math.max(0, x.home * 0.4 - 100),
					'sensor.daikin_etaj_power': (x) => Math.max(0, x.home * 0.2 - 80),
					'sensor.tv_matrimonial_power': (x) =>
						new Date(Number(x.t)).getHours() > 19 ? 110 : 0,
					'sensor.lumini_estimat_power': () => 6,
				};
				for (const id of msg.statistic_ids) {
					const f = map[id];
					if (!f) continue;
					res[id] = Object.entries(sim).map(([t, x]) => ({
						start: Number(t),
						end: Number(t) + BIN,
						mean: f({ ...x, t }),
					}));
				}
			} else if (msg.period === 'day') {
				const days = [];
				for (let t = from; t < to; t += 86400000) days.push(t);
				const base = { pv: 21, load: 9, imp: 2.4, exp: 7.5, chg: 11, dis: 8 };
				const keyOf = {
					[`${S}pv_today_energy_generation`]: 'pv',
					[`${S}today_energy_consumption`]: 'load',
					[`${S}today_energy_imported_from_grid`]: 'imp',
					[`${S}today_energy_fed_into_grid`]: 'exp',
					[`${S}today_battery_charge_energy`]: 'chg',
					[`${S}today_battery_discharge_energy`]: 'dis',
				};
				for (const id of msg.statistic_ids) {
					const k = keyOf[id];
					if (!k) continue;
					res[id] = days.map((t, i) => ({
						start: t,
						end: t + 86400000,
						change:
							Math.round(
								base[k] *
									(0.55 + 0.45 * Math.abs(Math.sin(i * 1.7 + k.length))) *
									10,
							) / 10,
					}));
				}
			}
			return res;
		}
		if (msg.type === 'recorder/statistic_during_period') {
			const today = {
				'sensor.daikin_parter_energy': 3.42,
				'sensor.daikin_etaj_energy': 1.86,
				'sensor.tv_matrimonial_energy': 0.41,
				'sensor.lumini_estimat_energy': 0.12,
			};
			return { change: today[msg.statistic_id] ?? null };
		}
		if (msg.type === 'history/history_during_period') {
			const states = getStates();
			const res = {};
			for (const id of msg.entity_ids) {
				const s = states[id];
				if (!s) continue;
				res[id] = [{ s: s.state, lu: Date.parse(msg.start_time) / 1000 }];
			}
			return res;
		}
		throw new Error(`mock callWS: unsupported ${msg.type}`);
	};
}

export class MockHass {
	constructor() {
		this.scenario = 'sunny_export';
		this.jitter = true;
		this.dark = true;
		this.language = 'en';
		this.serviceLog = [];
		this.overrides = {};
		this.listeners = new Set();
		this.refresh();
	}

	refresh() {
		this.states = {
			...buildStates(this.scenario, { jitter: this.jitter }),
			...this.overrides,
		};
		this.emit();
	}

	setScenario(name) {
		this.scenario = name;
		this.overrides = {};
		this.refresh();
	}

	onChange(fn) {
		this.listeners.add(fn);
	}

	emit() {
		const states = this.states;
		const hass = {
			states,
			language: this.language,
			selectedLanguage: this.language,
			locale: {
				language: this.language,
				number_format: 'language',
				time_format: '24',
			},
			themes: { darkMode: this.dark, theme: this.dark ? 'dark' : 'light' },
			config: { unit_system: { temperature: '°C' } },
			callWS: makeCallWS(() => this.states),
			callService: async (domain, service, data) => {
				this.serviceLog.push({
					domain,
					service,
					data,
					at: new Date().toISOString(),
				});
				const id = data?.entity_id;
				const cur = this.states[id];
				if (cur && ['toggle', 'turn_on', 'turn_off'].includes(service)) {
					const on =
						service === 'toggle' ? cur.state !== 'on' : service === 'turn_on';
					this.overrides[id] = {
						...cur,
						state: on ? 'on' : 'off',
						last_changed: new Date().toISOString(),
					};
					this.refresh();
				}
				document.dispatchEvent(
					new CustomEvent('mock-service-call', {
						detail: { domain, service, data },
					}),
				);
			},
		};
		for (const fn of this.listeners) fn(hass);
	}
}
