import { describe, expect, it } from 'vitest';
import { resolveThreeDConfig } from '../../src/three-d/config';
import {
	buildEnergySnapshot,
	CardConfigLike,
	ClassicDerived,
} from '../../src/three-d/data/energy-adapter';
import { StatesLike } from '../../src/three-d/data/units';

const S = 'sensor.solis_s6_eh3p_';

function st(
	state: string | number,
	unit = '',
	extra: Record<string, unknown> = {},
) {
	return {
		state: String(state),
		attributes: { unit_of_measurement: unit, ...extra },
	};
}

/** Marius's Solis setup, as configured for the classic card. */
function solisConfig(overrides: Partial<CardConfigLike> = {}): CardConfigLike {
	return {
		show_solar: true,
		show_battery: true,
		show_grid: true,
		inverter: { model: 'solis', three_phase: true },
		battery: {
			invert_power: true,
			energy: 25600,
			shutdown_soc: 10,
			soc_end_of_charge: 100,
			max_power: 10000,
			remaining_energy_to_shutdown: true,
		},
		battery2: {},
		solar: {
			mppts: 4,
			max_power: 15000,
			off_threshold: 10,
			pv1_max_power: 3750,
			pv2_max_power: 3750,
			pv3_max_power: 3750,
			pv4_max_power: 3750,
		},
		load: {
			max_power: 15000,
			additional_loads: 4,
			load1_name: 'Daikin Parter',
			load2_name: 'Daikin Etaj',
			load3_name: 'TV',
			load4_name: 'Lumini',
			load1_switch: 'switch.daikin_parter_power',
		},
		grid: { max_power: 15000, invert_grid: false, show_nonessential: false },
		entities: {
			inverter_status_59: 'sensor.solis_cod_stare_card',
			pv_total: `${S}total_pv_power`,
			pv1_power_186: `${S}pv_power_1`,
			pv2_power_187: `${S}pv_power_2`,
			pv3_power_188: `${S}pv_power_3`,
			pv4_power_189: `${S}pv_power_4`,
			pv1_voltage_109: `${S}pv_voltage_1`,
			pv2_voltage_111: `${S}pv_voltage_2`,
			pv3_voltage_113: `${S}pv_voltage_3`,
			pv4_voltage_115: `${S}pv_voltage_4`,
			pv1_current_110: `${S}pv_current_1`,
			day_pv_energy_108: `${S}pv_today_energy_generation`,
			battery_power_190: 'sensor.solis_putere_baterie_incarcare',
			battery_current_direction: `${S}battery_current_direction`,
			battery_soc_184: `${S}battery_soc`,
			battery_voltage_183: `${S}battery_voltage`,
			day_battery_charge_70: `${S}today_battery_charge_energy`,
			day_battery_discharge_71: `${S}today_battery_discharge_energy`,
			essential_power: 'sensor.consum_casa',
			day_load_energy_84: `${S}today_energy_consumption`,
			grid_ct_power_172: 'sensor.putere_retea',
			grid_power_169: 'sensor.putere_retea',
			grid_voltage: `${S}a_phase_voltage`,
			day_grid_import_76: `${S}today_energy_imported_from_grid`,
			day_grid_export_77: `${S}today_energy_fed_into_grid`,
			essential_load1: 'sensor.daikin_parter_power',
			essential_load2: 'sensor.daikin_etaj_power',
			essential_load3: 'sensor.tv_matrimonial_power',
			essential_load4: 'sensor.lumini_estimat_power',
			essential_load1_extra: 'sensor.daikin_parter_energy',
		},
		...overrides,
	};
}

function sunnyStates(): StatesLike {
	return {
		[`${S}total_pv_power`]: st(9200, 'W'),
		[`${S}pv_power_1`]: st(2.1, 'kW'),
		[`${S}pv_power_2`]: st(2000, 'W'),
		[`${S}pv_power_3`]: st(2600, 'W'),
		[`${S}pv_power_4`]: st(2500, 'W'),
		[`${S}pv_voltage_1`]: st(480, 'V'),
		[`${S}pv_voltage_2`]: st(470, 'V'),
		[`${S}pv_voltage_3`]: st(520, 'V'),
		[`${S}pv_voltage_4`]: st(515, 'V'),
		[`${S}pv_current_1`]: st(4.4, 'A'),
		[`${S}pv_today_energy_generation`]: st(19900, 'Wh'),
		'sensor.solis_putere_baterie_incarcare': st(-3000, 'W'),
		[`${S}battery_current_direction`]: st(0),
		[`${S}battery_soc`]: st(64, '%'),
		[`${S}battery_voltage`]: st(264.8, 'V'),
		[`${S}today_battery_charge_energy`]: st(13, 'kWh'),
		[`${S}today_battery_discharge_energy`]: st(5.1, 'kWh'),
		'sensor.consum_casa': st(1200, 'W'),
		[`${S}today_energy_consumption`]: st(4.7, 'kWh'),
		'sensor.putere_retea': st(-5000, 'W'),
		[`${S}a_phase_voltage`]: st(231, 'V'),
		[`${S}today_energy_imported_from_grid`]: st(0.4, 'kWh'),
		[`${S}today_energy_fed_into_grid`]: st(6.2, 'kWh'),
		'sensor.solis_cod_stare_card': st(3),
		'sensor.daikin_parter_power': st(800, 'W'),
		'sensor.daikin_etaj_power': st(3, 'W'),
		'sensor.tv_matrimonial_power': st(110, 'W'),
		'sensor.lumini_estimat_power': st(4.2, 'W'),
		'sensor.daikin_parter_energy': st(3.2, 'kWh'),
		'switch.daikin_parter_power': st('on'),
		'sun.sun': st('above_horizon', '', { azimuth: 160, elevation: 38 }),
	};
}

/** Values the classic card derives for the states above (see index.ts render()). */
function sunnyDerived(): ClassicDerived {
	return {
		inverterModel: 'solis',
		// battery_power_190 (-3000) with invert_power → +3000, direction 0 → -3000 (charging)
		batteryPower: -3000,
		totalGridPower: -5000,
		essentialPower: 1200,
		gridStatus: 'on',
		inverterStateMsg: 'Normal',
		inverterStateColour: 'green',
		batteryEnergy: 25600,
		batteryOneShutdown: 10,
		maximumSOC: 100,
		batteryCapacity: 100,
		batteryCount: 1,
	};
}

function snapshot(
	states: StatesLike,
	config = solisConfig(),
	derived: ClassicDerived = sunnyDerived(),
	threeOverrides: Record<string, unknown> = {},
) {
	const { config: three, issues } = resolveThreeDConfig({
		...config,
		three_d: threeOverrides,
	} as never);
	return buildEnergySnapshot({
		states,
		config,
		three,
		derived,
		configIssues: issues,
	});
}

describe('energy adapter: solar', () => {
	it('normalises kW to W and computes MPPT shares', () => {
		const s = snapshot(sunnyStates());
		expect(s.solar.mppts).toHaveLength(4);
		expect(s.solar.mppts[0].power.value).toBe(2100);
		expect(s.solar.total.value).toBe(9200);
		const shares = s.solar.mppts.map((m) => m.share ?? 0);
		expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
		expect(s.solar.mppts[0].share).toBeCloseTo(2100 / 9200, 5);
		expect(s.solar.todayEnergy.value).toBeCloseTo(19.9, 5); // Wh → kWh
	});

	it('flags an inactive string when its same-orientation peer produces', () => {
		const states = sunnyStates();
		states[`${S}pv_power_2`] = st(0, 'W');
		states[`${S}pv_voltage_2`] = st(2.2, 'V');
		const s = snapshot(states);
		const m2 = s.solar.mppts[1];
		expect(m2.status).toBe('no_voltage');
		expect(m2.peerId).toBe(1);
		expect(s.flows.find((f) => f.id === 'mppt2')!.active).toBe(false);
	});

	it('flags underperformance relative to the peer string', () => {
		const states = sunnyStates();
		states[`${S}pv_power_4`] = st(900, 'W');
		const s = snapshot(states);
		expect(s.solar.mppts[3].status).toBe('underperforming');
		expect(s.solar.mppts[3].peerId).toBe(3);
		expect(s.solar.mppts[2].status).toBe('producing');
	});

	it('does not call strings faulty at night', () => {
		const states = sunnyStates();
		for (let i = 1; i <= 4; i++) states[`${S}pv_power_${i}`] = st(0, 'W');
		const s = snapshot(states);
		expect(s.solar.mppts.every((m) => m.status === 'idle')).toBe(true);
		expect(
			s.flows.filter((f) => f.kind === 'solar').every((f) => !f.active),
		).toBe(true);
	});

	it('marks unavailable strings without inventing values', () => {
		const states = sunnyStates();
		states[`${S}pv_power_3`] = st('unavailable', 'W');
		delete states[`${S}total_pv_power`];
		const s = snapshot(states);
		expect(s.solar.mppts[2].status).toBe('unavailable');
		expect(s.solar.mppts[2].power.value).toBeNull();
		expect(s.solar.total.available).toBe(false);
		expect(s.issues.some((i) => i.code === 'missing_entity')).toBe(true);
	});
});

describe('energy adapter: battery', () => {
	it('reports charging with the Solis direction register (0 = charging)', () => {
		const s = snapshot(sunnyStates());
		const b = s.batteries[0];
		expect(b.power.value).toBe(-3000);
		expect(b.state).toBe('charging');
		const flow = s.flows.find((f) => f.id === 'battery')!;
		expect(flow.direction).toBe(-1);
		expect(flow.active).toBe(true);
		// to 100 % at 3 kW from 64 % of 25.6 kWh: 9216 Wh / 3000 W = 3.072 h
		expect(b.runtimeKind).toBe('to_full');
		expect(b.runtimeSeconds! / 3600).toBeCloseTo(3.072, 3);
		// remaining counted down to shutdown (10 %)
		expect(b.remainingWh).toBeCloseTo((25600 * 54) / 100, 3);
	});

	it('marks battery power unavailable when the direction register is unavailable', () => {
		const states = sunnyStates();
		states[`${S}battery_current_direction`] = st('unavailable');
		const s = snapshot(states);
		expect(s.batteries[0].power.available).toBe(false);
		expect(s.batteries[0].state).toBe('unavailable');
		expect(s.flows.find((f) => f.id === 'battery')!.active).toBe(false);
	});

	it('honours invert_flow (positive = charging in the classic config)', () => {
		const config = solisConfig();
		config.battery = { ...config.battery, invert_flow: true };
		const s = snapshot(sunnyStates(), config, {
			...sunnyDerived(),
			batteryPower: 2500,
		});
		expect(s.batteries[0].power.value).toBe(-2500);
		expect(s.batteries[0].state).toBe('charging');
	});

	it('computes runtime to shutdown when discharging', () => {
		const states = sunnyStates();
		states[`${S}battery_current_direction`] = st(1);
		const s = snapshot(states, solisConfig(), {
			...sunnyDerived(),
			batteryPower: 2000,
			batteryCapacity: 10,
		});
		const b = s.batteries[0];
		expect(b.state).toBe('discharging');
		expect(b.runtimeKind).toBe('to_shutdown');
		// (64-10)% of 25.6 kWh = 13.824 kWh at 2 kW = 6.912 h
		expect(b.runtimeSeconds! / 3600).toBeCloseTo(6.912, 3);
	});

	it('does not assume a capacity when none is configured', () => {
		const config = solisConfig();
		config.battery = { ...config.battery, energy: 0 };
		const s = snapshot(sunnyStates(), config, {
			...sunnyDerived(),
			batteryEnergy: 0,
		});
		expect(s.batteries[0].capacityWh).toBeNull();
		expect(s.batteries[0].remainingWh).toBeNull();
		expect(s.batteries[0].runtimeSeconds).toBeNull();
	});
});

describe('energy adapter: grid', () => {
	it('shows export as a reversed grid flow', () => {
		const s = snapshot(sunnyStates());
		expect(s.grid.state).toBe('exporting');
		expect(s.grid.connection).toBe('connected');
		const f = s.flows.find((x) => x.id === 'grid')!;
		expect(f.direction).toBe(-1);
		expect(f.active).toBe(true);
	});

	it('distinguishes a disconnected grid from zero exchange', () => {
		const states = sunnyStates();
		states[`${S}a_phase_voltage`] = st(0, 'V');
		states['sensor.putere_retea'] = st(0, 'W');
		const s = snapshot(states, solisConfig(), {
			...sunnyDerived(),
			totalGridPower: 0,
		});
		expect(s.grid.connection).toBe('disconnected');
		expect(s.grid.state).toBe('disconnected');
		expect(s.flows.find((x) => x.id === 'grid')!.active).toBe(false);

		states[`${S}a_phase_voltage`] = st(230, 'V');
		const s2 = snapshot(states, solisConfig(), {
			...sunnyDerived(),
			totalGridPower: 0,
		});
		expect(s2.grid.connection).toBe('connected');
		expect(s2.grid.state).toBe('idle');
	});

	it('keeps the connection unknown when the grid voltage sensor is unavailable', () => {
		const states = sunnyStates();
		states[`${S}a_phase_voltage`] = st('unavailable', 'V');
		const s = snapshot(states);
		expect(s.grid.connection).toBe('unknown');
	});

	it('uses a status entity for non-Solis inverters', () => {
		const config = solisConfig({
			inverter: { model: 'sunsynk', three_phase: false },
		});
		config.entities = {
			...config.entities,
			grid_connected_status_194: 'binary_sensor.grid',
		};
		const states = { ...sunnyStates(), 'binary_sensor.grid': st('off') };
		const s = snapshot(states, config, {
			...sunnyDerived(),
			inverterModel: 'sunsynk',
		});
		expect(s.grid.connectionSource).toBe('status_entity');
		expect(s.grid.connection).toBe('disconnected');
	});
});

describe('energy adapter: home, inverter, rooms', () => {
	it('uses the essential load, not inverter output, for home consumption', () => {
		const s = snapshot(sunnyStates());
		expect(s.home.essentialSource).toBe('essential_power');
		expect(s.home.total.value).toBe(1200);
		expect(s.flows.find((f) => f.id === 'home')!.powerW).toBe(1200);
	});

	it('computes an energy balance residual over the inverter', () => {
		const s = snapshot(sunnyStates());
		// sources 9200 ; sinks 1200 home + 3000 charge + 5000 export = 9200
		expect(s.inverter.balanceResidualW).toBeCloseTo(0, 5);
		expect(s.inverter.status.category).toBe('normal');
	});

	it('flags energy sensors configured as power', () => {
		const states = sunnyStates();
		states['sensor.consum_casa'] = st(4.7, 'kWh');
		const s = snapshot(states);
		expect(s.home.essential.available).toBe(false);
		expect(s.issues.some((i) => i.code === 'unit_mismatch')).toBe(true);
	});

	it('derives rooms from the classic loads with floor keywords', () => {
		const s = snapshot(sunnyStates());
		const ground = s.rooms.find((r) => r.floor === 'ground')!;
		const first = s.rooms.find((r) => r.floor === 'first')!;
		expect(ground.devices.map((d) => d.name)).toContain('Daikin Parter');
		expect(first.devices.map((d) => d.name)).toContain('Daikin Etaj');
		const ac = ground.devices.find((d) => d.name === 'Daikin Parter')!;
		expect(ac.type).toBe('ac');
		expect(ac.on).toBe(true);
		expect(ac.onSource).toBe('state');
		// classic loadN_switch is a status/more-info link, never an implicit control
		expect(ac.control).toBeNull();
		expect(ground.power.value).toBeCloseTo(800 + 110 + 4.2, 5);
	});

	it('only allows control for configured entities of supported domains', () => {
		const { config: three, issues } = resolveThreeDConfig({
			...solisConfig(),
			three_d: {
				rooms: [
					{
						name: 'Living',
						floor: 'ground',
						devices: [
							{
								name: 'AC',
								power: 'sensor.daikin_parter_power',
								control: 'switch.daikin_parter_power',
							},
							{
								name: 'Meter',
								power: 'sensor.daikin_parter_power',
								control: 'sensor.daikin_parter_power',
							},
						],
					},
				],
			},
		} as never);
		expect(issues.some((i) => i.path.includes('devices[1].control'))).toBe(
			true,
		);
		const s = buildEnergySnapshot({
			states: sunnyStates(),
			config: solisConfig(),
			three,
			derived: sunnyDerived(),
		});
		const [ac, meter] = s.rooms[0].devices;
		expect(ac.control?.entity).toBe('switch.daikin_parter_power');
		expect(meter.control).toBeNull();
	});

	it('uses statistics for today energy of total-increasing device sensors', () => {
		const { config: three } = resolveThreeDConfig(solisConfig() as never);
		const s = buildEnergySnapshot({
			states: sunnyStates(),
			config: solisConfig(),
			three,
			derived: sunnyDerived(),
			todayEnergy: new Map([['sensor.daikin_parter_energy', 1.25]]),
		});
		const ac = s.rooms[0].devices.find((d) => d.name === 'Daikin Parter')!;
		expect(ac.energyToday.value).toBe(1.25);
		expect(ac.energyTotal.value).toBe(3.2);
	});

	it('follows the sun entity for night mode and keeps config overrides', () => {
		const states = sunnyStates();
		states['sun.sun'] = st('below_horizon', '', {
			azimuth: 300,
			elevation: -12,
		});
		expect(snapshot(states).environment.night).toBe(true);
		expect(
			snapshot(states, solisConfig(), sunnyDerived(), { night_mode: 'off' })
				.environment.night,
		).toBe(false);
	});
});
