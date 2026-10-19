/**
 * Inline Material Design Icons (Pictogrammers, Apache-2.0) so the 3D UI renders
 * the same inside and outside Home Assistant. User-configured device icons use
 * <ha-icon> when it is available.
 */
import { html, svg, TemplateResult } from 'lit';
import {
	mdiAirConditioner,
	mdiAlertCircle,
	mdiArrowDown,
	mdiArrowUp,
	mdiBatteryCharging,
	mdiBatteryHigh,
	mdiCameraRetake,
	mdiChartLine,
	mdiCheckCircle,
	mdiClose,
	mdiCubeOutline,
	mdiFlash,
	mdiFloorPlan,
	mdiHomeLightningBoltOutline,
	mdiHomeRoof,
	mdiInformationOutline,
	mdiLayersOutline,
	mdiLightbulbGroup,
	mdiOpenInNew,
	mdiPower,
	mdiPowerPlug,
	mdiSolarPanelLarge,
	mdiSolarPower,
	mdiTagOutline,
	mdiTelevision,
	mdiThermometer,
	mdiTransmissionTower,
	mdiTransmissionTowerExport,
	mdiTransmissionTowerImport,
	mdiTransmissionTowerOff,
	mdiViewDashboardOutline,
	mdiWaterBoiler,
	mdiWeatherNight,
	mdiArrowExpandVertical,
	mdiCarElectric,
	mdiHeatingCoil,
	mdiPump,
	mdiSineWave,
} from '@mdi/js';

export const ICONS = {
	ac: mdiAirConditioner,
	alert: mdiAlertCircle,
	down: mdiArrowDown,
	up: mdiArrowUp,
	batteryCharging: mdiBatteryCharging,
	battery: mdiBatteryHigh,
	reset: mdiCameraRetake,
	chart: mdiChartLine,
	ok: mdiCheckCircle,
	close: mdiClose,
	cube: mdiCubeOutline,
	flash: mdiFlash,
	floors: mdiFloorPlan,
	home: mdiHomeLightningBoltOutline,
	roof: mdiHomeRoof,
	info: mdiInformationOutline,
	layers: mdiLayersOutline,
	light: mdiLightbulbGroup,
	open: mdiOpenInNew,
	power: mdiPower,
	plug: mdiPowerPlug,
	panel: mdiSolarPanelLarge,
	solar: mdiSolarPower,
	tag: mdiTagOutline,
	tv: mdiTelevision,
	temp: mdiThermometer,
	grid: mdiTransmissionTower,
	gridExport: mdiTransmissionTowerExport,
	gridImport: mdiTransmissionTowerImport,
	gridOff: mdiTransmissionTowerOff,
	classic: mdiViewDashboardOutline,
	boiler: mdiWaterBoiler,
	night: mdiWeatherNight,
	explode: mdiArrowExpandVertical,
	ev: mdiCarElectric,
	heater: mdiHeatingCoil,
	pump: mdiPump,
	inverter: mdiSineWave,
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, size = 18): TemplateResult {
	return html`<svg
		class="ic"
		viewBox="0 0 24 24"
		width=${size}
		height=${size}
		aria-hidden="true"
	>
		${svg`<path d=${ICONS[name]} fill="currentColor"></path>`}
	</svg>`;
}

const DEVICE_ICONS: Record<string, IconName> = {
	ac: 'ac',
	tv: 'tv',
	light: 'light',
	heater: 'heater',
	boiler: 'boiler',
	pump: 'pump',
	ev: 'ev',
	appliance: 'plug',
	other: 'plug',
};

/** Device icon: the configured mdi icon through <ha-icon> when available, else a built-in one. */
export function deviceIcon(
	type: string,
	mdi: string | undefined,
	size = 18,
): TemplateResult {
	if (mdi && mdi.startsWith('mdi:') && customElements.get('ha-icon')) {
		return html`<ha-icon
			.icon=${mdi}
			style="--mdc-icon-size:${size}px;width:${size}px;height:${size}px"
		></ha-icon>`;
	}
	return icon(DEVICE_ICONS[type] ?? 'plug', size);
}
