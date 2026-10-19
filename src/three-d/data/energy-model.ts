/**
 * Plain data model consumed by the 3D scene and the 3D dashboard UI.
 * Produced by `buildEnergySnapshot()`; contains no Three.js or Lit types.
 *
 * Sign conventions inside the snapshot are fixed, whatever the sensors report:
 *  - battery power: positive = discharging (energy leaves the battery), negative = charging
 *  - grid power:    positive = importing from the grid, negative = exporting
 *  - all other powers are non-negative consumption/production values
 */
import type { DeviceControlConfig, DeviceType, FloorId } from '../config';
import type { Reading } from './units';

export type FlowKind = 'solar' | 'battery' | 'grid' | 'home' | 'nonessential';

export interface FlowSnapshot {
	/** `mppt1`…`mppt6`, `battery`, `grid`, `home`, `nonessential` */
	id: string;
	kind: FlowKind;
	/** absolute power in W */
	powerW: number;
	/** +1 = along the path's natural direction (source → inverter, inverter → home), -1 = reversed */
	direction: 1 | -1;
	active: boolean;
	available: boolean;
	/** 0..1, power relative to the configured max power for this path */
	ratio: number;
	color: string;
}

export type MpptStatus =
	| 'producing'
	| 'idle'
	| 'underperforming'
	| 'inactive'
	| 'no_voltage'
	| 'unavailable';

export interface MpptSnapshot {
	id: number;
	name: string;
	orientation?: string;
	panels: number;
	power: Reading;
	voltage: Reading;
	current: Reading;
	energyToday: Reading;
	/** share of total MPPT production, 0..1 (null when no data or no production) */
	share: number | null;
	/** power / nameplate (pvN_max_power), 0..2 (null when not configured) */
	efficiency: number | null;
	status: MpptStatus;
	/** MPPT used for the comparison behind `underperforming` / `inactive` */
	peerId?: number;
	/** this MPPT's normalised output relative to its peer, 0..1 */
	peerRatio?: number;
}

export type BatteryState =
	'charging' | 'discharging' | 'idle' | 'floating' | 'unavailable';

export interface BatterySnapshot {
	index: number;
	available: boolean;
	soc: Reading;
	voltage: Reading;
	current: Reading;
	/** normalised: + discharging, - charging (W) */
	power: Reading;
	temperature: Reading;
	soh: Reading;
	state: BatteryState;
	capacityWh: number | null;
	capacitySource: 'three_d' | 'battery.energy' | 'rated_capacity' | null;
	remainingWh: number | null;
	/** remaining energy counted down to shutdown SOC (classic `remaining_energy_to_shutdown`) */
	remainingToShutdown: boolean;
	shutdownSoc: number | null;
	targetSoc: number | null;
	runtimeSeconds: number | null;
	runtimeKind: 'to_shutdown' | 'to_full' | null;
	todayCharge: Reading;
	todayDischarge: Reading;
}

export type GridConnection = 'connected' | 'disconnected' | 'unknown';

export interface GridSnapshot {
	/** normalised: + import, - export (W) */
	power: Reading;
	connection: GridConnection;
	connectionSource: 'status_entity' | 'grid_voltage' | 'assumed';
	state: 'importing' | 'exporting' | 'idle' | 'disconnected' | 'unavailable';
	voltage: Reading;
	frequency: Reading;
	todayImport: Reading;
	todayExport: Reading;
	phases: Reading[];
}

export interface HomeSnapshot {
	/** essential (backed-up) house load, W */
	essential: Reading;
	essentialSource: 'essential_power' | 'phase_sum' | 'computed';
	/** grid-side loads when the card shows them */
	nonessential: Reading | null;
	/** what the dashboard calls "home consumption" */
	total: Reading;
	todayEnergy: Reading;
	phases: Reading[];
}

export type InverterCategory =
	'normal' | 'standby' | 'alarm' | 'selftest' | 'unknown';

export interface EntityInfo {
	entityId: string;
	name: string;
	state: string;
	unit: string;
	available: boolean;
	lastChanged?: string;
}

export interface InverterSnapshot {
	modelName: string;
	brand: string;
	status: {
		code: string | null;
		message: string;
		color: string;
		category: InverterCategory;
		available: boolean;
	};
	fault: boolean;
	power: Reading;
	temperature: Reading;
	dcTemperature: Reading;
	frequency: Reading;
	voltages: Reading[];
	currents: Reading[];
	/** every entity the card config binds, for the equipment detail panel */
	entities: EntityInfo[];
	/** energy balance over the inverter hub (W): sources - sinks; null when inputs are missing */
	balanceResidualW: number | null;
}

export interface LightSnapshot {
	entityId: string;
	available: boolean;
	on: boolean;
	/** 0..1 */
	brightness: number;
	/** [r, g, b] 0..255 when the light reports a colour */
	rgb: [number, number, number] | null;
	name: string;
}

export interface DeviceSnapshot {
	id: string;
	roomId: string;
	name: string;
	type: DeviceType;
	icon?: string;
	power: Reading;
	energyToday: Reading;
	/** lifetime/total energy sensor (today's value comes from statistics when available) */
	energyTotal: Reading;
	temperature: Reading;
	stateEntity: string | null;
	stateText: string | null;
	on: boolean | null;
	onSource: 'state' | 'power' | null;
	control: DeviceControlConfig | null;
}

export interface RoomSnapshot {
	id: string;
	name: string;
	floor: FloorId;
	power: Reading;
	powerSource: 'entity' | 'devices' | null;
	energyToday: Reading;
	energyTotal: Reading;
	temperature: Reading;
	humidity: Reading;
	lights: LightSnapshot[];
	devices: DeviceSnapshot[];
}

export interface ExteriorLightSnapshot {
	zone: string;
	entityId: string | null;
	/** null when no entity is mapped (decorative light follows night mode) */
	on: boolean | null;
	color: string | null;
	brightness: number;
}

export interface EnvironmentSnapshot {
	sunAvailable: boolean;
	aboveHorizon: boolean | null;
	azimuth: number | null;
	elevation: number | null;
	night: boolean;
	nightSource: 'config' | 'sun' | 'clock';
	outsideTemperature: Reading;
}

export interface SnapshotIssue {
	level: 'warning' | 'error';
	/** stable key for translation, e.g. `unit_mismatch` */
	code: string;
	/** config path or entity id the issue is about */
	subject: string;
	message: string;
}

export interface EnergySnapshot {
	timestamp: number;
	solar: {
		available: boolean;
		/** total PV power (W), pv_total entity when configured, else sum of MPPTs */
		total: Reading;
		todayEnergy: Reading;
		remainingForecast: Reading;
		mppts: MpptSnapshot[];
	};
	batteries: BatterySnapshot[];
	/** combined battery power across batteries, normalised (+ discharge) */
	batteryPower: Reading;
	grid: GridSnapshot;
	home: HomeSnapshot;
	inverter: InverterSnapshot;
	flows: FlowSnapshot[];
	rooms: RoomSnapshot[];
	exteriorLights: ExteriorLightSnapshot[];
	environment: EnvironmentSnapshot;
	issues: SnapshotIssue[];
	/** every entity read, so the card can re-render when any of them changes */
	entityIds: string[];
}
