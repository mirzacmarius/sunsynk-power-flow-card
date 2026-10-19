/**
 * <sunsynk-3d-view>: the 3D dashboard rendered by the card in `view_mode: 3d`.
 *
 * Lit renders the panels around the canvas; the SceneManager owns the WebGL
 * scene. Live values flow: hass + classic DataDto → EnergySnapshot → (UI, scene).
 */
import { html, LitElement, nothing, PropertyValues, TemplateResult } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import {
	ALL_SUMMARY_ITEMS,
	CameraViewId,
	ConfigIssue,
	FloorId,
	PresetId,
	resolveThreeDConfig,
	structuralKey,
	SummaryItemId,
	ThreeDConfig,
} from '../config';
import {
	buildEnergySnapshot,
	CardConfigLike,
	ClassicDerived,
	statisticsEnergyIds,
} from '../data/energy-adapter';
import type {
	BatterySnapshot,
	DeviceSnapshot,
	EnergySnapshot,
	MpptSnapshot,
	RoomSnapshot,
} from '../data/energy-model';
import {
	DailyRow,
	HistoryService,
	PowerHistory,
	Series,
} from '../data/history';
import {
	formatEnergy,
	formatNumber,
	formatPlain,
	formatPower,
	Formatted,
	NumberFormatOptions,
	Reading,
	resolveNumberLocale,
	splitDuration,
	StatesLike,
} from '../data/units';
import {
	ProjectedLabel,
	SceneManager,
	SceneStatus,
} from '../scene/scene-manager';
import { defineCharts } from './charts';
import { I18nKey, Lang, resolveLang, translator, Translate } from './i18n';
import { deviceIcon, icon, IconName } from './icons';
import { viewStyles } from './styles';

export const VIEW_TAG = 'sunsynk-3d-view';

interface HassLike {
	states: StatesLike;
	themes?: { darkMode?: boolean };
	locale?: { language?: string; number_format?: string };
	language?: string;
	callWS<T>(msg: Record<string, unknown>): Promise<T>;
	callService(
		domain: string,
		service: string,
		data?: Record<string, unknown>,
	): Promise<unknown>;
	/** HA's own localised state text (frontend 2023.9+) */
	formatEntityState?(stateObj: unknown): string;
	formatEntityAttributeValue?(stateObj: unknown, attribute: string): string;
}

/** A screen rectangle in stage pixels. */
type Box = { x0: number; x1: number; y0: number; y1: number };

const PRESETS: { id: PresetId; key: I18nKey; icon: IconName }[] = [
	{ id: 'overview', key: 'preset_overview', icon: 'flash' },
	{ id: 'solar', key: 'preset_solar', icon: 'solar' },
	{ id: 'battery', key: 'preset_battery', icon: 'battery' },
	{ id: 'rooms', key: 'preset_rooms', icon: 'floors' },
	{ id: 'night', key: 'preset_night', icon: 'night' },
];

const VIEWS: CameraViewId[] = ['iso', 'front', 'rear', 'left', 'right', 'top'];

function fmt(f: Formatted): TemplateResult {
	return html`${f.value}${f.unit ? html`<small>${f.unit}</small>` : nothing}`;
}

function fmtText(f: Formatted): string {
	return f.unit ? `${f.value} ${f.unit}` : f.value;
}

export class Sunsynk3DView extends LitElement {
	static styles = viewStyles;

	@property({ attribute: false }) cardConfig?: CardConfigLike &
		Record<string, unknown>;
	@property({ attribute: false }) derived?: ClassicDerived;

	@state() private snapshot: EnergySnapshot | null = null;
	@state() private selected: string | null = null;
	@state() private hover: { id: string; x: number; y: number } | null = null;
	@state() private preset: PresetId = 'overview';
	@state() private floor: FloorId | null = null;
	@state() private roof = true;
	@state() private exploded = false;
	@state() private night: boolean | null = null;
	@state() private overlay = false;
	@state() private labelsOn = true;
	@state() private history: PowerHistory | null = null;
	@state() private daily: DailyRow[] | null = null;
	@state() private historyState: 'idle' | 'loading' | 'ready' = 'idle';
	@state() private deviceHistory: Series | null = null;
	@state() private status: SceneStatus | null = null;
	@state() private error: string | null = null;
	@state() private confirm: { device: DeviceSnapshot; action: string } | null =
		null;

	// Not named `host`: DOM walkers such as card-mod treat `.host` as ShadowRoot.host and
	// would loop forever through an element property of that name.
	@query('.canvas-host') private canvasEl?: HTMLElement;
	@query('.stage') private stageEl?: HTMLElement;

	private _hass?: HassLike;
	private three!: ThreeDConfig;
	private issues: ConfigIssue[] = [];
	private configKey = '';
	private structKey = '';
	private manager: SceneManager | null = null;
	private resize?: ResizeObserver;
	private historyTimer?: number;
	private history$ = new HistoryService(() => this._hass);
	private todayEnergy = new Map<string, number>();
	private tracked = new Map<string, string>();
	private rebuildRaf = 0;
	private uiLang: Lang = 'en';
	private t: Translate = translator('en');
	private nf: NumberFormatOptions = {};
	private reducedMotionQuery?: MediaQueryList;
	private labelEls = new Map<string, HTMLElement>();

	set hass(value: HassLike) {
		const first = !this._hass;
		this._hass = value;
		const dark = value?.themes?.darkMode;
		this.toggleAttribute('light', dark === false);
		if (first || this.statesChanged()) this.scheduleSnapshot();
	}

	get hass(): HassLike | undefined {
		return this._hass;
	}

	private statesChanged(): boolean {
		const states = this._hass?.states;
		if (!states) return false;
		for (const [id, prev] of this.tracked) {
			const s = states[id];
			const cur = s ? `${s.state}|${s.last_updated ?? ''}` : '∅';
			if (cur !== prev) return true;
		}
		return this.tracked.size === 0;
	}

	private scheduleSnapshot(): void {
		if (this.rebuildRaf) return;
		this.rebuildRaf = requestAnimationFrame(() => {
			this.rebuildRaf = 0;
			this.buildSnapshot();
		});
	}

	private ensureConfig(): void {
		const cfg = this.cardConfig ?? {};
		const key = JSON.stringify([
			cfg.three_d ?? null,
			cfg.solar ?? null,
			cfg.load ?? null,
			cfg.entities ?? null,
			this.uiLang,
		]);
		if (key === this.configKey && this.three) return;
		this.configKey = key;
		const { config, issues } = resolveThreeDConfig(cfg as never, {
			ground: this.t('ground'),
			first: this.t('first'),
		});
		this.three = config;
		this.issues = issues;
		if (this.three.height)
			this.style.setProperty('--s3d-stage-height', this.three.height);
		else this.style.removeProperty('--s3d-stage-height');
		const sk = structuralKey(config);
		if (this.manager && sk !== this.structKey) this.manager.rebuild(config);
		else if (this.manager) this.manager.updateConfig(config);
		this.structKey = sk;
	}

	private buildSnapshot(): void {
		if (!this._hass || !this.cardConfig) return;
		this.ensureConfig();
		const snapshot = buildEnergySnapshot({
			states: this._hass.states,
			config: this.cardConfig,
			three: this.three,
			derived: this.derived,
			todayEnergy: this.todayEnergy,
			configIssues: this.issues,
		});
		this.tracked.clear();
		for (const id of snapshot.entityIds) {
			const s = this._hass.states[id];
			this.tracked.set(id, s ? `${s.state}|${s.last_updated ?? ''}` : '∅');
		}
		this.snapshot = snapshot;
		this.manager?.applySnapshot(snapshot);
	}

	connectedCallback(): void {
		super.connectedCallback();
		defineCharts();
		this.reducedMotionQuery =
			typeof matchMedia === 'function'
				? matchMedia('(prefers-reduced-motion: reduce)')
				: undefined;
		this.reducedMotionQuery?.addEventListener?.('change', this.onMotionPref);
		if (this.hasUpdated && !this.manager) this.initScene();
		this.startHistory();
	}

	disconnectedCallback(): void {
		super.disconnectedCallback();
		this.reducedMotionQuery?.removeEventListener?.('change', this.onMotionPref);
		if (this.rebuildRaf) cancelAnimationFrame(this.rebuildRaf);
		this.rebuildRaf = 0;
		window.clearInterval(this.historyTimer);
		this.historyTimer = undefined;
		this.resize?.disconnect();
		this.resize = undefined;
		this.manager?.dispose();
		this.manager = null;
		this.labelEls.clear();
	}

	private onMotionPref = () => {
		this.manager?.setState({ reducedMotion: this.reducedMotion });
	};

	private get reducedMotion(): boolean {
		const setting = this.three?.reduced_motion ?? 'auto';
		if (typeof setting === 'boolean') return setting;
		return !!this.reducedMotionQuery?.matches;
	}

	protected willUpdate(changed: PropertyValues): void {
		this.uiLang = resolveLang(
			this.three?.language ??
				(this.cardConfig?.three_d as { language?: 'auto' } | undefined)
					?.language ??
				'auto',
			this._hass,
		);
		this.t = translator(this.uiLang);
		this.nf = resolveNumberLocale(this._hass);
		if (changed.has('cardConfig') || !this.three) {
			this.ensureConfig();
			if (
				changed.has('cardConfig') &&
				changed.get('cardConfig') === undefined
			) {
				this.overlay = this.three.solar_overlay;
				this.labelsOn = this.three.show_labels;
				this.preset = this.three.default_preset;
			}
		}
		if (changed.has('derived') || changed.has('cardConfig'))
			this.buildSnapshot();
	}

	protected firstUpdated(): void {
		this.initScene();
	}

	private initScene(): void {
		if (this.manager || !this.canvasEl) return;
		this.ensureConfig();
		const b = this.snapshot?.batteries ?? [];
		try {
			this.manager = new SceneManager(
				this.canvasEl,
				this.three,
				{
					onHover: (id, p) => {
						this.hover = id && p ? { id, x: p.x, y: p.y } : null;
						this.manager?.setState({ hovered: id });
					},
					onSelect: (id, double) => this.select(id, double || !!id),
					onLabels: (labels) => this.placeLabels(labels),
					onStatus: (s) => {
						this.status = { ...(this.status ?? {}), ...s };
					},
				},
				{
					reducedMotion: this.reducedMotion,
					batteryCount: Math.max(1, b.length || 1),
					batteryCapacityWh: b[0]?.capacityWh ?? null,
					hasNonessential:
						(
							this.cardConfig?.grid as
								{ show_nonessential?: boolean } | undefined
						)?.show_nonessential === true,
				},
			);
		} catch (e) {
			this.error = this.t('load_failed', {
				error: String((e as Error)?.message ?? e),
			});
			this.dispatchEvent(
				new CustomEvent('s3d-fallback', {
					bubbles: true,
					composed: true,
					detail: { reason: 'webgl' },
				}),
			);
			return;
		}
		this.structKey = structuralKey(this.three);
		this.resize = new ResizeObserver((entries) => {
			const r = entries[0]?.contentRect;
			if (r) this.manager?.resize(r.width, r.height);
		});
		this.resize.observe(this.canvasEl);
		const rect = this.canvasEl.getBoundingClientRect();
		this.manager.resize(rect.width, rect.height);
		this.applyPreset(this.preset, false);
		if (this.snapshot) this.manager.applySnapshot(this.snapshot);
	}

	/** Renderer statistics and state, for the demo page and automated tests. */
	debugInfo() {
		return {
			stats: this.manager?.stats() ?? null,
			scene: this.manager?.getState() ?? null,
			quality: this.status?.quality ?? null,
			selected: this.selected,
			preset: this.preset,
			flows:
				this.snapshot?.flows.map((f) => ({
					id: f.id,
					active: f.active,
					powerW: Math.round(f.powerW),
					direction: f.direction,
				})) ?? [],
			issues: this.snapshot?.issues.map((i) => i.code) ?? [],
		};
	}

	/** Programmatic selection (demo / tests). */
	debugSelect(id: string | null): void {
		this.select(id);
	}

	// ------------------------------------------------------------------ history

	private startHistory(): void {
		window.clearInterval(this.historyTimer);
		const refresh = () => {
			if (!this.isConnected || document.visibilityState === 'hidden') return;
			this.loadHistory();
		};
		window.setTimeout(refresh, 400);
		const minutes = this.three?.statistics.refresh_minutes ?? 5;
		this.historyTimer = window.setInterval(refresh, minutes * 60 * 1000);
	}

	private async loadHistory(): Promise<void> {
		if (!this._hass?.callWS || !this.cardConfig) return;
		this.ensureConfig();
		const ids = statisticsEnergyIds(this.three);
		const today = ids.length
			? this.history$.loadTodayChange(ids)
			: Promise.resolve(new Map<string, number>());
		if (this.three.statistics.history) {
			if (!this.history) this.historyState = 'loading';
			const [hist, daily] = await Promise.all([
				this.history$.loadPower(
					this.cardConfig,
					this.three.solar.mppts.length,
					this.three.statistics.history_hours,
				),
				this.history$.loadDaily(
					this.cardConfig,
					this.three.statistics.daily_days,
				),
			]);
			this.history = hist;
			this.daily = daily;
			this.historyState = 'ready';
		}
		const t = await today;
		if (t.size) {
			this.todayEnergy = t;
			this.buildSnapshot();
		}
	}

	// ------------------------------------------------------------------ actions

	private select(id: string | null, focus = true): void {
		this.selected = id;
		this.confirm = null;
		this.deviceHistory = null;
		this.manager?.setState({ selected: id, labels: this.labelIds() });
		if (id && focus) this.manager?.focus(id);
		if (id?.startsWith('device:')) this.loadDeviceHistory(id.slice(7));
		this.syncFloorFromScene();
	}

	private syncFloorFromScene(): void {
		const s = this.manager?.getState();
		if (s) {
			this.floor = s.floor;
			this.roof = s.roof;
			this.exploded = s.exploded;
		}
	}

	private async loadDeviceHistory(deviceId: string): Promise<void> {
		const dev = this.findDevice(deviceId);
		if (!dev?.power.entityId) return;
		const series = await this.history$.loadEntity(dev.power.entityId, 24);
		if (this.selected === `device:${deviceId}`) this.deviceHistory = series;
	}

	private applyPreset(preset: PresetId, user = true): void {
		this.preset = preset;
		if (!this.manager) return;
		this.manager.applyPreset(preset);
		const s = this.manager.getState();
		this.floor = s.floor;
		this.roof = s.roof;
		this.exploded = s.exploded;
		this.night = s.night;
		this.overlay = s.overlay;
		if (user) this.selected = null;
		this.manager.setState({ labels: this.labelIds(), selected: this.selected });
	}

	private setFloor(floor: FloorId | null): void {
		this.floor = floor;
		this.manager?.setState({ floor, exploded: false });
		this.exploded = false;
	}

	private toggle(key: 'roof' | 'exploded' | 'overlay' | 'labelsOn'): void {
		if (key === 'labelsOn') {
			this.labelsOn = !this.labelsOn;
			this.manager?.setState({ labels: this.labelIds() });
			return;
		}
		this[key] = !this[key];
		if (key === 'exploded' && this.exploded) this.floor = null;
		this.manager?.setState({
			[key]: this[key],
			...(key === 'exploded' ? { floor: this.floor } : {}),
		});
	}

	private toggleNight(): void {
		const current = this.night ?? this.snapshot?.environment.night ?? false;
		this.night = !current;
		this.manager?.setState({ night: this.night });
	}

	private moreInfo(entityId: string | null | undefined): void {
		if (!entityId) return;
		this.dispatchEvent(
			new CustomEvent('hass-more-info', {
				bubbles: true,
				composed: true,
				detail: { entityId },
			}),
		);
	}

	private async control(
		device: DeviceSnapshot,
		confirmed = false,
	): Promise<void> {
		const c = device.control;
		if (!c || !this._hass) return;
		const action = c.action ?? 'toggle';
		if (c.confirm && !confirmed) {
			this.confirm = { device, action };
			return;
		}
		this.confirm = null;
		const domain = c.entity.split('.')[0];
		try {
			await this._hass.callService(domain, action, { entity_id: c.entity });
		} catch (e) {
			console.warn('sunsynk-3d: service call failed', e);
		}
	}

	private switchToClassic(): void {
		this.dispatchEvent(
			new CustomEvent('s3d-switch-view', {
				bubbles: true,
				composed: true,
				detail: { view: 'classic' },
			}),
		);
	}

	// ------------------------------------------------------------------ labels

	private labelIds(): string[] {
		const s = this.snapshot;
		if (!s || !this.labelsOn) return this.selected ? [this.selected] : [];
		const ids = new Set<string>();
		const batteries = s.batteries.map((b) => `battery:${b.index}`);
		switch (this.preset) {
			case 'solar':
				s.solar.mppts.forEach((m) => ids.add(`mppt:${m.id}`));
				ids.add('inverter');
				break;
			case 'battery':
				batteries.forEach((b) => ids.add(b));
				['inverter', 'grid', 'home'].forEach((x) => ids.add(x));
				break;
			case 'rooms':
				s.rooms.forEach((r) => {
					ids.add(`room:${r.id}`);
					r.devices
						.filter((d) => d.power.available)
						.forEach((d) => ids.add(`device:${d.id}`));
				});
				break;
			default:
				['solar', 'inverter', 'grid', 'home'].forEach((x) => ids.add(x));
				batteries.forEach((b) => ids.add(b));
		}
		if (this.selected) ids.add(this.selected);
		return [...ids];
	}

	private placeLabels(labels: ProjectedLabel[]): void {
		const root = this.renderRoot as ShadowRoot;
		const stageW = this.stageEl?.clientWidth ?? 0;
		// the overlays drawn over the scene: labels move up off the preset chips and the
		// legend (like off other labels) and down below the toolbar groups
		const stage = this.stageEl?.getBoundingClientRect();
		const boxes = (sel: string) =>
			stage
				? [...root.querySelectorAll<HTMLElement>(sel)]
						.map((e) => {
							const r = e.getBoundingClientRect();
							return {
								x0: r.left - stage.left,
								x1: r.right - stage.left,
								y0: r.top - stage.top,
								y1: r.bottom - stage.top,
							};
						})
						.filter((b) => b.x1 > b.x0 && b.y1 > b.y0)
				: [];
		const placed = boxes('.presets .chip, .legend');
		const tools = boxes('.toolbar .group');
		// nearest (lowest on screen) first, so labels further back move up out of the way
		const items = labels
			.map((l) => {
				let el = this.labelEls.get(l.id);
				if (!el || !el.isConnected) {
					el =
						root.querySelector<HTMLElement>(
							`.label[data-id="${CSS.escape(l.id)}"]`,
						) ?? undefined;
					if (el) this.labelEls.set(l.id, el);
				}
				return { l, el };
			})
			.filter((x): x is { l: ProjectedLabel; el: HTMLElement } => !!x.el)
			.sort((a, b) => b.l.y - a.l.y);
		for (const { l, el } of items) {
			if (!l.visible) {
				el.style.transform = 'translate(-9999px, -9999px)';
				continue;
			}
			const w = el.offsetWidth || 80;
			const h = el.offsetHeight || 24;
			const boxAt = (x: number, y: number) => ({
				x0: x - w / 2 - 3,
				x1: x + w / 2 + 3,
				y0: y - h - 2,
				y1: y + 2,
			});
			const overlaps = (a: Box, b: Box) =>
				a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
			// lowest allowed position at x: below any toolbar group above the label
			const minYAt = (x: number) => {
				let m = -Infinity;
				for (const t of tools)
					if (x - w / 2 - 3 < t.x1 && x + w / 2 + 3 > t.x0)
						m = Math.max(m, t.y1 + h + 4);
				return m;
			};
			const free = (x: number, y: number) =>
				y >= minYAt(x) && !placed.some((p) => overlaps(boxAt(x, y), p));
			// keep labels inside the stage horizontally
			let x = l.x;
			if (stageW > w + 8)
				x = Math.max(w / 2 + 4, Math.min(stageW - w / 2 - 4, x));
			let y = Math.max(l.y, minYAt(x));
			let down = false;
			for (let guard = 0; guard < 8; guard++) {
				const hit = placed.find((p) => overlaps(boxAt(x, y), p));
				if (!hit) break;
				// move up out of the way; when the toolbar is in the way, sit beside the
				// other label, else below it
				if (!down && hit.y0 - 2 >= minYAt(x)) {
					y = hit.y0 - 2;
					continue;
				}
				const side = [hit.x0 - w / 2 - 3, hit.x1 + w / 2 + 3]
					.filter((sx) => sx >= w / 2 + 4 && sx <= stageW - w / 2 - 4)
					.sort((a, b) => Math.abs(a - l.x) - Math.abs(b - l.x))
					.find((sx) => free(sx, y));
				if (side !== undefined) {
					x = side;
					break;
				}
				down = true;
				y = hit.y1 + h + 2;
			}
			placed.push(boxAt(x, y));
			el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
		}
	}

	// ------------------------------------------------------------------ format helpers

	private p(r: Reading | null | undefined, absolute = false): Formatted {
		if (!r || !r.available) return { value: '—', unit: '' };
		return formatPower(r.value, this.decimals, this.nf, absolute);
	}

	private e(r: Reading | null | undefined): Formatted {
		if (!r || !r.available) return { value: '—', unit: '' };
		return formatEnergy(r.value, this.energyDecimals, this.nf);
	}

	private v(r: Reading | null | undefined, decimals = 1): Formatted {
		if (!r || !r.available) return { value: '—', unit: '' };
		return formatPlain(r.value, r.unit, decimals, this.nf);
	}

	/** HA time format preference: '12' / '24' / language default. */
	private get hour12(): boolean | undefined {
		const tf = (
			this._hass as unknown as { locale?: { time_format?: string } } | undefined
		)?.locale?.time_format;
		return tf === '12' ? true : tf === '24' ? false : undefined;
	}

	private get decimals(): number {
		const d = Number(
			(this.cardConfig as { decimal_places?: number } | undefined)
				?.decimal_places ?? 2,
		);
		return Number.isFinite(d) ? Math.max(0, Math.min(3, d)) : 2;
	}

	private get energyDecimals(): number {
		const d = Number(
			(this.cardConfig as { decimal_places_energy?: number } | undefined)
				?.decimal_places_energy ?? 1,
		);
		return Number.isFinite(d) ? Math.max(0, Math.min(3, d)) : 1;
	}

	private duration(seconds: number | null): string {
		if (seconds === null || !Number.isFinite(seconds)) return '—';
		const { days, hours, minutes } = splitDuration(seconds);
		const t = this.t;
		if (days > 0) return `${days} ${t('d_short')} ${hours} ${t('h_short')}`;
		if (hours > 0)
			return `${hours} ${t('h_short')} ${minutes} ${t('min_short')}`;
		return `${minutes} ${t('min_short')}`;
	}

	private batteryColor(b: BatterySnapshot | undefined): string {
		if (!b) return 'var(--s3d-text-2)';
		return b.state === 'charging'
			? this.three.colors.battery_charge
			: b.state === 'discharging'
				? this.three.colors.battery_discharge
				: 'var(--s3d-text-2)';
	}

	private gridColor(): string {
		const g = this.snapshot?.grid;
		if (!g) return 'var(--s3d-text-2)';
		if (g.state === 'disconnected') return this.three.colors.fault;
		if (g.state === 'importing') return this.three.colors.grid_import;
		if (g.state === 'exporting') return this.three.colors.grid_export;
		return 'var(--s3d-text-2)';
	}

	private inverterColor(): string {
		const c = this.snapshot?.inverter.status.category;
		return c === 'normal'
			? 'var(--s3d-ok)'
			: c === 'alarm'
				? this.three.colors.fault
				: c === 'standby'
					? '#3b82f6'
					: c === 'selftest'
						? '#a855f7'
						: 'var(--s3d-text-2)';
	}

	private mpptStatus(m: MpptSnapshot): { text: string; color: string } {
		const t = this.t;
		switch (m.status) {
			case 'producing':
				return { text: t('producing'), color: 'var(--s3d-ok)' };
			case 'idle':
				return { text: t('idle'), color: 'var(--s3d-text-2)' };
			case 'underperforming':
				return { text: t('underperforming'), color: 'var(--s3d-warn)' };
			case 'inactive':
				return { text: t('inactive'), color: this.three.colors.fault };
			case 'no_voltage':
				return { text: t('no_voltage'), color: this.three.colors.fault };
			default:
				return { text: t('unavailable'), color: 'var(--s3d-text-2)' };
		}
	}

	private findDevice(id: string): DeviceSnapshot | undefined {
		for (const r of this.snapshot?.rooms ?? []) {
			const d = r.devices.find((x) => x.id === id);
			if (d) return d;
		}
		return undefined;
	}

	// ------------------------------------------------------------------ render

	render() {
		if (this.error) {
			return html`<ha-card class="card"
				><div
					class="notice"
					style="position:static;transform:none;max-width:none"
				>
					${this.error}
				</div></ha-card
			>`;
		}
		const s = this.snapshot;
		return html`
			<ha-card class="card">
				${s ? this.renderSummary(s) : nothing}
				<div class="main">
					<div class="stage">
						<div class="canvas-host"></div>
						<div class="labels">${s ? this.renderLabels(s) : nothing}</div>
						${this.renderToolbar()} ${this.renderPresets()}
						${this.renderLegend()}
						${this.hover && s ? this.renderTooltip(s) : nothing}
						${!s ? html`<div class="notice">${this.t('loading')}</div>` : nothing}
						${this.status?.contextLost ? html`<div class="notice">${this.t('context_lost')}</div>` : nothing}
					</div>
					<div class="side">${s ? this.renderSide(s) : nothing}</div>
				</div>
				${s && this.three.statistics.history ? this.renderBottom(s) : nothing}
			</ha-card>
		`;
	}

	private renderSummary(s: EnergySnapshot): TemplateResult {
		const t = this.t;
		const items = this.three.statistics.summary?.length
			? this.three.statistics.summary
			: ALL_SUMMARY_ITEMS;
		const b = s.batteries[0];
		const kpi = (
			_id: SummaryItemId,
			ic: IconName,
			color: string,
			label: string,
			value: Formatted | string,
			sub: string,
			target: string | null,
		) => html`
			<button
				class="kpi"
				style="--c:${color}"
				@click=${() => target && this.select(target)}
				title=${typeof value === 'string' ? `${label}: ${value}` : label}
			>
				<span class="badge">${icon(ic, 18)}</span>
				<span class="txt">
					<span class="lbl">${label}</span>
					<span class="val"
						>${typeof value === 'string' ? value : fmt(value)}</span
					>
					<span class="sub">${sub || ' '}</span>
				</span>
			</button>
		`;
		const g = s.grid;
		const gridIcon: IconName =
			g.state === 'disconnected'
				? 'gridOff'
				: g.state === 'exporting'
					? 'gridExport'
					: 'gridImport';
		const gridState = t(
			g.state === 'idle'
				? 'balanced'
				: g.state === 'unavailable'
					? 'unavailable'
					: g.state,
		);
		const map: Record<SummaryItemId, () => TemplateResult> = {
			solar_now: () =>
				kpi(
					'solar_now',
					'solar',
					this.three.colors.solar,
					t('solar_now'),
					this.p(s.solar.total),
					s.solar.remainingForecast.available
						? t('left_today', {
								value: fmtText(this.e(s.solar.remainingForecast)),
							})
						: `${s.solar.mppts.filter((m) => m.status === 'producing').length}/${s.solar.mppts.length} MPPT`,
					'solar',
				),
			solar_today: () =>
				kpi(
					'solar_today',
					'panel',
					this.three.colors.solar,
					t('solar_today'),
					this.e(s.solar.todayEnergy),
					'',
					null,
				),
			home_now: () =>
				kpi(
					'home_now',
					'home',
					this.three.colors.home,
					t('home_now'),
					this.p(s.home.total),
					'',
					'home',
				),
			home_today: () =>
				kpi(
					'home_today',
					'chart',
					this.three.colors.home,
					t('home_today'),
					this.e(s.home.todayEnergy),
					'',
					'home',
				),
			battery_soc: () =>
				kpi(
					'battery_soc',
					b?.state === 'charging' ? 'batteryCharging' : 'battery',
					this.batteryColor(b) === 'var(--s3d-text-2)'
						? this.three.colors.battery_charge
						: this.batteryColor(b),
					t('battery_soc'),
					b
						? b.soc.available
							? { value: formatNumber(b.soc.value ?? 0, 0, this.nf), unit: '%' }
							: { value: '—', unit: '' }
						: t('not_configured'),
					b && b.remainingWh !== null
						? `${fmtText(formatEnergy(b.remainingWh / 1000, 1, this.nf))}`
						: '',
					b ? `battery:${b.index}` : null,
				),
			battery_power: () =>
				kpi(
					'battery_power',
					b?.state === 'charging' ? 'down' : 'up',
					this.batteryColor(b),
					t('battery_power'),
					this.p(s.batteryPower, true),
					b ? t(b.state === 'unavailable' ? 'unavailable' : b.state) : '',
					b ? `battery:${b.index}` : null,
				),
			grid: () =>
				kpi(
					'grid',
					gridIcon,
					this.gridColor(),
					t('grid'),
					g.state === 'disconnected'
						? t('disconnected')
						: this.p(g.power, true),
					g.state === 'disconnected' ? '' : gridState,
					'grid',
				),
			inverter: () =>
				kpi(
					'inverter',
					s.inverter.fault ? 'alert' : 'inverter',
					this.inverterColor(),
					t('inverter'),
					s.inverter.status.message ||
						(s.inverter.status.available ? t('unknown') : t('unavailable')),
					s.inverter.temperature.available
						? fmtText(this.v(s.inverter.temperature))
						: s.inverter.modelName,
					'inverter',
				),
		};
		return html`<div class="summary">${items.map((id) => map[id]())}</div>`;
	}

	private renderToolbar(): TemplateResult {
		const t = this.t;
		const tool = (
			label: string,
			ic: IconName,
			pressed: boolean | null,
			onClick: () => void,
			showText = false,
		) => html`
			<button
				class="tool"
				title=${label}
				aria-label=${label}
				aria-pressed=${pressed === null ? nothing : String(pressed)}
				@click=${onClick}
			>
				${icon(ic, 17)}${showText ? html`<span class="t">${label}</span>` : nothing}
			</button>
		`;
		const nightOn = this.night ?? this.snapshot?.environment.night ?? false;
		return html`
			<div class="toolbar">
				<div class="group" role="group" aria-label=${t('views')}>
					${VIEWS.map(
						(v) =>
							html`<button
								class="tool"
								title=${t(v)}
								aria-label=${t(v)}
								@click=${() => this.manager?.setView(v)}
							>
								<span class="t" style="display:inline"
									>${t(`${v}_short` as I18nKey)}</span
								>
							</button>`,
					)}
					${tool(t('reset'), 'reset', null, () => this.manager?.resetCamera())}
				</div>
				<div class="group" role="group" aria-label=${t('floors')}>
					${tool(t('roof'), 'roof', this.roof && this.floor === null, () => this.toggle('roof'))}
					${(
						[
							[null, 'all_short', 'all_floors'],
							['ground', 'ground_short', 'ground'],
							['first', 'first_short', 'first'],
						] as [FloorId | null, I18nKey, I18nKey][]
					).map(
						([f, short, long]) =>
							html`<button
								class="tool"
								title=${t(long)}
								aria-label=${t(long)}
								aria-pressed=${String(f === null ? this.floor === null && !this.exploded : this.floor === f)}
								@click=${() => this.setFloor(f)}
							>
								<span class="t" style="display:inline">${t(short)}</span>
							</button>`,
					)}
					${tool(t('explode'), 'explode', this.exploded, () => this.toggle('exploded'))}
				</div>
				<span class="spacer"></span>
				<div class="group">
					${tool(t('night'), 'night', nightOn, () => this.toggleNight())}
					${tool(t('overlay'), 'panel', this.overlay, () => this.toggle('overlay'))}
					${tool(t('labels'), 'tag', this.labelsOn, () => this.toggle('labelsOn'))}
					${this.three.show_view_toggle ? tool(t('switch_to_classic'), 'classic', null, () => this.switchToClassic(), true) : nothing}
				</div>
			</div>
		`;
	}

	private renderPresets(): TemplateResult {
		return html`<div class="presets" role="group">
			${PRESETS.map(
				(p) =>
					html`<button
						class="chip"
						aria-pressed=${String(this.preset === p.id)}
						@click=${() => this.applyPreset(p.id)}
					>
						${icon(p.icon, 14)} ${this.t(p.key)}
					</button>`,
			)}
		</div>`;
	}

	private renderLegend(): TemplateResult {
		const c = this.three.colors;
		const t = this.t;
		const items: [string, string][] = [
			[c.solar, t('legend_solar')],
			[c.battery_charge, t('legend_charge')],
			[c.battery_discharge, t('legend_discharge')],
			[c.home, t('legend_home')],
			[c.grid_import, t('legend_import')],
			[c.grid_export, t('legend_export')],
		];
		return html`<div class="legend">
			${items.map(([col, label]) => html`<span><i style="--c:${col}"></i>${label}</span>`)}
		</div>`;
	}

	private labelContent(
		s: EnergySnapshot,
		id: string,
	): { color: string; body: TemplateResult } | null {
		const t = this.t;
		const c = this.three.colors;
		if (id === 'solar')
			return {
				color: c.solar,
				body: html`${icon('solar', 14)}
					<b>${fmtText(this.p(s.solar.total))}</b>`,
			};
		if (id === 'inverter') {
			return {
				color: this.inverterColor(),
				body: html`<span class="dot"></span
					><b>${s.inverter.status.message || t('inverter')}</b>`,
			};
		}
		if (id === 'home')
			return {
				color: c.home,
				body: html`${icon('home', 14)} <b>${fmtText(this.p(s.home.total))}</b>`,
			};
		if (id === 'grid') {
			const g = s.grid;
			return {
				color: this.gridColor(),
				body: html`${icon(g.state === 'disconnected' ? 'gridOff' : 'grid', 14)}
					<b
						>${g.state === 'disconnected' ? t('disconnected') : fmtText(this.p(g.power, true))}</b
					>
					${g.state === 'importing' || g.state === 'exporting' ? html`<span class="muted">${t(g.state)}</span>` : nothing}`,
			};
		}
		if (id.startsWith('battery:')) {
			const b = s.batteries.find((x) => `battery:${x.index}` === id);
			if (!b) return null;
			return {
				color:
					this.batteryColor(b) === 'var(--s3d-text-2)'
						? c.battery_charge
						: this.batteryColor(b),
				body: html`${icon(b.state === 'charging' ? 'batteryCharging' : 'battery', 14)}
					<b
						>${b.soc.available ? `${formatNumber(b.soc.value ?? 0, 0, this.nf)}%` : '—'}</b
					>
					<span class="muted"
						>${b.state === 'idle' || b.state === 'floating' ? t(b.state) : fmtText(this.p(b.power, true))}</span
					>`,
			};
		}
		if (id.startsWith('mppt:')) {
			const m = s.solar.mppts.find((x) => `mppt:${x.id}` === id);
			if (!m) return null;
			const st = this.mpptStatus(m);
			const problem = m.status !== 'producing' && m.status !== 'idle';
			return {
				color: st.color === 'var(--s3d-ok)' ? c.solar : st.color,
				body: html`<span class="dot"></span
					><b>${m.name}</b>
					${fmtText(this.p(m.power))}${problem ? html` <span class="muted">· ${st.text}</span>` : nothing}`,
			};
		}
		if (id.startsWith('room:')) {
			const r = s.rooms.find((x) => `room:${x.id}` === id);
			if (!r) return null;
			return {
				color: this.three.colors.home,
				body: html`<b>${r.name}</b
					>${r.power.available ? html` <span class="muted">${fmtText(this.p(r.power))}</span>` : nothing}`,
			};
		}
		if (id.startsWith('device:')) {
			const d = this.findDevice(id.slice(7));
			if (!d) return null;
			return {
				color: d.on ? c.home : '#64748b',
				body: html`${deviceIcon(d.type, d.icon, 13)} ${d.name}
					<b>${fmtText(this.p(d.power))}</b>`,
			};
		}
		return null;
	}

	private renderLabels(s: EnergySnapshot): TemplateResult[] {
		return this.labelIds().map((id) => {
			const c = this.labelContent(s, id);
			if (!c) return html``;
			return html`<div
				class="label"
				data-id=${id}
				style="--c:${c.color}"
				?selected=${this.selected === id}
				role="button"
				tabindex="0"
				@click=${() => this.select(id)}
				@keydown=${(e: KeyboardEvent) => e.key === 'Enter' && this.select(id)}
			>
				${c.body}
			</div>`;
		});
	}

	private renderTooltip(s: EnergySnapshot): TemplateResult {
		const h = this.hover!;
		const t = this.t;
		const rows: [string, string][] = [];
		let title = '';
		const id = h.id;
		if (id.startsWith('mppt:')) {
			const m = s.solar.mppts.find((x) => `mppt:${x.id}` === id);
			if (m) {
				title = `${m.name}${m.orientation ? ` · ${m.orientation}` : ''}`;
				rows.push(
					[t('power'), fmtText(this.p(m.power))],
					[t('voltage'), fmtText(this.v(m.voltage))],
					[t('current'), fmtText(this.v(m.current))],
				);
				if (m.share !== null)
					rows.push([
						t('contribution'),
						`${formatNumber(m.share * 100, 0, this.nf)} %`,
					]);
				rows.push([t('status'), this.mpptStatus(m).text]);
			}
		} else if (id === 'inverter') {
			title = s.inverter.modelName;
			rows.push(
				[t('status'), s.inverter.status.message || t('unknown')],
				[t('power'), fmtText(this.p(s.inverter.power))],
			);
			if (s.inverter.temperature.available)
				rows.push([t('temperature'), fmtText(this.v(s.inverter.temperature))]);
		} else if (id.startsWith('battery')) {
			const b = s.batteries[0];
			if (b) {
				title = this.three.battery.model_name;
				rows.push(
					[
						t('soc'),
						b.soc.available
							? `${formatNumber(b.soc.value ?? 0, 0, this.nf)} %`
							: '—',
					],
					[t('power'), fmtText(this.p(b.power, true))],
					[t('status'), t(b.state)],
				);
				if (b.runtimeSeconds !== null)
					rows.push([
						b.runtimeKind === 'to_full'
							? t('time_to_full', { soc: b.targetSoc ?? 100 })
							: t('runtime'),
						this.duration(b.runtimeSeconds),
					]);
			}
		} else if (id === 'grid') {
			title = t('grid');
			rows.push(
				[t('status'), t(s.grid.state === 'idle' ? 'balanced' : s.grid.state)],
				[t('power'), fmtText(this.p(s.grid.power, true))],
			);
			if (s.grid.voltage.available)
				rows.push([t('voltage'), fmtText(this.v(s.grid.voltage))]);
		} else if (id === 'home') {
			title = t('home_now');
			rows.push(
				[t('power'), fmtText(this.p(s.home.total))],
				[t('daily_energy'), fmtText(this.e(s.home.todayEnergy))],
			);
		} else if (id.startsWith('room:')) {
			const r = s.rooms.find((x) => `room:${x.id}` === id);
			if (r) {
				title = r.name;
				rows.push(
					[t('power'), fmtText(this.p(r.power))],
					[t('daily_energy'), fmtText(this.e(r.energyToday))],
				);
				if (r.temperature.available)
					rows.push([t('temperature'), fmtText(this.v(r.temperature))]);
			}
		} else if (id.startsWith('device:')) {
			const d = this.findDevice(id.slice(7));
			if (d) {
				title = d.name;
				rows.push(
					[t('power'), fmtText(this.p(d.power))],
					[t('daily_energy'), fmtText(this.e(d.energyToday))],
					[t('status'), d.on === null ? '—' : d.on ? t('on') : t('off')],
				);
			}
		}
		if (!title) return html``;
		const stageW = this.stageEl?.clientWidth ?? 800;
		const left = Math.min(h.x + 14, stageW - 270);
		return html`<div
			class="tooltip"
			style="left:${Math.max(6, left)}px;top:${Math.max(6, h.y + 14)}px"
		>
			<h4>${title}</h4>
			${rows.map(([k, v]) => html`<div class="r"><span>${k}</span><span>${v}</span></div>`)}
		</div>`;
	}

	// ------------------------------------------------------------------ side panel

	private renderSide(s: EnergySnapshot): TemplateResult {
		const sel = this.selected;
		let detail: TemplateResult | typeof nothing = nothing;
		if (sel === 'inverter') detail = this.renderInverter(s);
		else if (sel?.startsWith('battery'))
			detail = this.renderBattery(
				s.batteries.find((b) => `battery:${b.index}` === sel) ?? s.batteries[0],
				true,
			);
		else if (sel === 'grid') detail = this.renderGrid(s, true);
		else if (sel === 'home') detail = this.renderHome(s);
		else if (sel?.startsWith('mppt:'))
			detail = this.renderMppt(
				s.solar.mppts.find((m) => `mppt:${m.id}` === sel),
			);
		else if (sel?.startsWith('room:'))
			detail = this.renderRoom(s.rooms.find((r) => `room:${r.id}` === sel));
		else if (sel?.startsWith('device:'))
			detail = this.renderDevice(this.findDevice(sel.slice(7)));
		else if (sel === 'solar') detail = this.renderSolar(s);
		if (detail !== nothing) return detail as TemplateResult;
		return html`
			${s.batteries.map((b) => this.renderBattery(b, false))}
			${this.renderGrid(s, false)} ${this.renderMpptTable(s)}
			${this.renderDeviceList(s)} ${this.renderIssues(s)}
		`;
	}

	private header(
		ic: IconName | TemplateResult,
		color: string,
		name: string,
		sub: string,
	): TemplateResult {
		return html`<div class="title" style="--c:${color}">
			<span class="badge"
				>${typeof ic === 'string' ? icon(ic as IconName, 20) : ic}</span
			>
			<div>
				<div class="name">${name}</div>
				<div class="sub">${sub}</div>
			</div>
			<button
				class="close"
				title=${this.t('close')}
				aria-label=${this.t('close')}
				@click=${() => this.select(null, false)}
			>
				${icon('close', 16)}
			</button>
		</div>`;
	}

	private row(
		k: string,
		v: TemplateResult | string,
		entityId?: string | null,
	): TemplateResult {
		return html`<span class="k">${k}</span
			><span
				class="v"
				style=${entityId ? 'cursor:pointer' : ''}
				@click=${() => entityId && this.moreInfo(entityId)}
				>${v}</span
			>`;
	}

	private renderBattery(
		b: BatterySnapshot | undefined,
		detailed: boolean,
	): TemplateResult {
		const t = this.t;
		if (!b) return html``;
		const color =
			this.batteryColor(b) === 'var(--s3d-text-2)'
				? this.three.colors.battery_charge
				: this.batteryColor(b);
		const soc = b.soc.available ? (b.soc.value ?? 0) : null;
		const segs = Array.from(
			{ length: 10 },
			(_, i) => soc !== null && soc >= i * 10 + 5,
		);
		const body = html`
			<div class="soc">
				<div
					class="socbar"
					style="--c:${soc !== null && soc <= 15 ? this.three.colors.fault : soc !== null && soc <= 35 ? '#f59e0b' : color}"
				>
					${segs.map((on) => html`<span class=${on ? 'on' : ''}></span>`)}
				</div>
				<div>
					<div class="big">
						${soc === null ? '—' : formatNumber(soc, 0, this.nf)}<small
							>%</small
						>
					</div>
					<div class="status" style="--c:${color}">
						${t(b.state === 'unavailable' ? 'unavailable' : b.state)}
					</div>
					<div style="font-size:13px;margin-top:2px">
						${fmtText(this.p(b.power, true))}
					</div>
				</div>
			</div>
			<div class="rows">
				${
					b.remainingWh !== null
						? this.row(
								b.remainingToShutdown && b.shutdownSoc !== null
									? t('remaining_to_shutdown', { soc: b.shutdownSoc })
									: t('remaining'),
								fmtText(formatEnergy(b.remainingWh / 1000, 1, this.nf)),
							)
						: nothing
				}
				${
					b.runtimeSeconds !== null
						? this.row(
								b.runtimeKind === 'to_full'
									? t('time_to_full', { soc: b.targetSoc ?? 100 })
									: t('runtime_to', { soc: b.targetSoc ?? 0 }),
								this.duration(b.runtimeSeconds),
							)
						: nothing
				}
				${this.row(t('capacity'), b.capacityWh !== null ? fmtText(formatEnergy(b.capacityWh / 1000, 1, this.nf)) : t('not_configured'))}
				${this.row(t('charged_today'), fmt(this.e(b.todayCharge)), b.todayCharge.entityId)}
				${this.row(t('discharged_today'), fmt(this.e(b.todayDischarge)), b.todayDischarge.entityId)}
				${
					detailed
						? html`${this.row(t('voltage'), fmt(this.v(b.voltage)), b.voltage.entityId)}
							${this.row(t('current'), fmt(this.v(b.current)), b.current.entityId)}
							${b.temperature.configured ? this.row(t('temperature'), fmt(this.v(b.temperature)), b.temperature.entityId) : nothing}
							${b.soh.configured ? this.row(t('soh'), fmt(this.v(b.soh, 0)), b.soh.entityId) : nothing}`
						: nothing
				}
			</div>
		`;
		if (detailed) {
			return html`<div class="panel">
				${this.header(b.state === 'charging' ? 'batteryCharging' : 'battery', color, this.three.battery.model_name, t('battery'))}
				${body}
				<div class="actions">
					<button class="btn" @click=${() => this.moreInfo(b.soc.entityId)}>
						${icon('open', 14)} ${t('open_details')}
					</button>
				</div>
			</div>`;
		}
		return html`<div class="panel">
			<h3>
				${icon('battery', 14)}<span class="grow"
					>${t('battery')}${b.index > 1 ? ` ${b.index}` : ''}</span
				>
				<button
					class="tool"
					style="height:22px"
					@click=${() => this.select(`battery:${b.index}`)}
				>
					${icon('info', 14)}
				</button>
			</h3>
			${body}
		</div>`;
	}

	private renderGrid(s: EnergySnapshot, detailed: boolean): TemplateResult {
		const t = this.t;
		const g = s.grid;
		const color = this.gridColor();
		const source =
			g.connectionSource === 'grid_voltage'
				? t('grid_status_source_voltage')
				: g.connectionSource === 'status_entity'
					? t('grid_status_source_entity')
					: t('grid_status_source_assumed');
		const rows = html`<div class="rows">
			${this.row(t('status'), html`<span class="status" style="--c:${color}">${t(g.state === 'idle' ? 'balanced' : g.state)}</span>`)}
			${this.row(t('power'), fmt(this.p(g.power, true)), g.power.entityId)}
			${this.row(t('connected'), html`${t(g.connection)} <small>(${source})</small>`)}
			${this.row(t('import_today'), fmt(this.e(g.todayImport)), g.todayImport.entityId)}
			${this.row(t('export_today'), fmt(this.e(g.todayExport)), g.todayExport.entityId)}
			${
				detailed
					? html`${g.voltage.configured ? this.row(t('voltage'), fmt(this.v(g.voltage)), g.voltage.entityId) : nothing}
						${g.frequency.configured ? this.row(t('frequency'), fmt(this.v(g.frequency, 2)), g.frequency.entityId) : nothing}
						${g.phases.map((ph, i) => this.row(t('phase', { n: i + 1 }), fmt(this.p(ph)), ph.entityId))}`
					: nothing
			}
		</div>`;
		if (detailed) {
			return html`<div class="panel">
				${this.header(g.state === 'disconnected' ? 'gridOff' : 'grid', color, t('grid'), t(g.connection))}
				${rows}
			</div>`;
		}
		return html`<div class="panel">
			<h3>
				${icon('grid', 14)}<span class="grow">${t('grid')}</span>
				<button
					class="tool"
					style="height:22px"
					@click=${() => this.select('grid')}
				>
					${icon('info', 14)}
				</button>
			</h3>
			${rows}
		</div>`;
	}

	private renderSolar(s: EnergySnapshot): TemplateResult {
		const t = this.t;
		return html`<div class="panel">
				${this.header('solar', this.three.colors.solar, t('solar'), `${s.solar.mppts.reduce((a, m) => a + m.panels, 0)} ${t('panels', { n: '' }).trim()}`)}
				<div class="big" style="margin-bottom:8px">
					${fmt(this.p(s.solar.total))}
				</div>
				<div class="rows">
					${this.row(t('solar_today'), fmt(this.e(s.solar.todayEnergy)), s.solar.todayEnergy.entityId)}
					${s.solar.remainingForecast.configured ? this.row(t('forecast_left'), fmt(this.e(s.solar.remainingForecast)), s.solar.remainingForecast.entityId) : nothing}
				</div>
			</div>
			${this.renderMpptTable(s)}`;
	}

	private renderMpptTable(s: EnergySnapshot): TemplateResult {
		const t = this.t;
		if (!s.solar.mppts.length) return html``;
		return html`<div class="panel">
			<h3>
				${icon('solar', 14)}<span class="grow">${t('mppt_details')}</span
				><span>${fmtText(this.p(s.solar.total))}</span>
			</h3>
			<table class="table">
				<thead>
					<tr>
						<th></th>
						<th>${t('power')}</th>
						<th>V</th>
						<th>A</th>
						<th>%</th>
					</tr>
				</thead>
				<tbody>
					${s.solar.mppts.map((m) => {
						const st = this.mpptStatus(m);
						return html`<tr @click=${() => this.select(`mppt:${m.id}`)}>
							<td>
								<span class="status" style="--c:${st.color}">${m.name}</span>
								${m.status !== 'producing' && m.status !== 'idle' ? html`<div class="mstate" style="color:${st.color}">${st.text}</div>` : nothing}
								<div class="share">
									<i style="width:${(m.share ?? 0) * 100}%"></i>
								</div>
							</td>
							<td>${fmtText(this.p(m.power))}</td>
							<td>${this.v(m.voltage, 0).value}</td>
							<td>${this.v(m.current, 1).value}</td>
							<td>
								${m.share === null ? '—' : formatNumber(m.share * 100, 0, this.nf)}
							</td>
						</tr>`;
					})}
				</tbody>
			</table>
		</div>`;
	}

	private renderDeviceList(s: EnergySnapshot): TemplateResult {
		const t = this.t;
		const devices = s.rooms.flatMap((r) => r.devices.map((d) => ({ d, r })));
		if (!devices.length) return html``;
		devices.sort((a, b) => (b.d.power.value ?? -1) - (a.d.power.value ?? -1));
		return html`<div class="panel">
			<h3>${icon('plug', 14)}<span class="grow">${t('devices')}</span></h3>
			<div class="list">
				${devices.map(
					({ d, r }) =>
						html`<button
							class="row-btn"
							@click=${() => this.select(`device:${d.id}`)}
						>
							<span
								style="color:${d.on ? this.three.colors.home : 'var(--s3d-text-2)'}"
								>${deviceIcon(d.type, d.icon, 18)}</span
							>
							<span class="n"
								>${d.name} <span class="pill">${r.name}</span></span
							>
							<span class="p">${fmtText(this.p(d.power))}</span>
						</button>`,
				)}
			</div>
		</div>`;
	}

	private renderIssues(s: EnergySnapshot): TemplateResult {
		if (!s.issues.length) return html``;
		return html`<div class="panel">
			<details>
				<summary class="warn">
					${icon('alert', 14)} ${this.t('issues', { n: s.issues.length })}
				</summary>
				${s.issues.map((i) => html`<div class="note">• ${i.message}</div>`)}
			</details>
		</div>`;
	}

	private renderInverter(s: EnergySnapshot): TemplateResult {
		const t = this.t;
		const inv = s.inverter;
		const color = this.inverterColor();
		return html`<div class="panel">
			${this.header(inv.fault ? 'alert' : 'inverter', color, inv.modelName, t('inverter'))}
			<div class="rows">
				${this.row(t('status'), html`<span class="status" style="--c:${color}">${inv.status.message || t('unknown')}</span>${inv.status.code !== null ? html` <small>(${inv.status.code})</small>` : nothing}`)}
				${this.row(t('power'), fmt(this.p(inv.power)), inv.power.entityId)}
				${inv.temperature.configured ? this.row(t('temperature'), fmt(this.v(inv.temperature)), inv.temperature.entityId) : nothing}
				${inv.dcTemperature.configured ? this.row(`DC ${t('temperature')}`, fmt(this.v(inv.dcTemperature)), inv.dcTemperature.entityId) : nothing}
				${inv.frequency.configured ? this.row(t('frequency'), fmt(this.v(inv.frequency, 2)), inv.frequency.entityId) : nothing}
				${inv.voltages.map((r, i) => this.row(`${t('voltage')} L${i + 1}`, fmt(this.v(r)), r.entityId))}
				${inv.currents.map((r, i) => this.row(`${t('current')} L${i + 1}`, fmt(this.v(r)), r.entityId))}
				${this.row(t('solar_now'), fmt(this.p(s.solar.total)))}
				${this.row(t('battery_power'), html`${fmt(this.p(s.batteryPower, true))} <small>${s.batteries[0] ? t(s.batteries[0].state) : ''}</small>`)}
				${this.row(t('grid'), html`${fmt(this.p(s.grid.power, true))} <small>${t(s.grid.state === 'idle' ? 'balanced' : s.grid.state)}</small>`)}
				${this.row(t('home_now'), fmt(this.p(s.home.total)))}
				${inv.balanceResidualW !== null ? this.row(t('balance'), fmtText(formatPower(inv.balanceResidualW, this.decimals, this.nf))) : nothing}
			</div>
			${inv.balanceResidualW !== null ? html`<div class="note">${t('balance_note')}</div>` : nothing}
			<details>
				<summary>${t('entities')} (${inv.entities.length})</summary>
				${inv.entities.map(
					(e) =>
						html`<div class="entity" @click=${() => this.moreInfo(e.entityId)}>
							<span>${e.name}</span
							><span class=${e.available ? '' : 'warn'}
								>${e.state} ${e.unit}</span
							>
							<code>${e.entityId}</code>
						</div>`,
				)}
			</details>
		</div>`;
	}

	private renderHome(s: EnergySnapshot): TemplateResult {
		const t = this.t;
		const h = s.home;
		return html`<div class="panel">
			${this.header('home', this.three.colors.home, t('home_now'), (this.cardConfig?.load as { essential_name?: string } | undefined)?.essential_name ?? '')}
			<div class="big" style="margin-bottom:8px">${fmt(this.p(h.total))}</div>
			<div class="rows">
				${this.row(t('daily_energy'), fmt(this.e(h.todayEnergy)), h.todayEnergy.entityId)}
				${h.nonessential ? this.row('Essential', fmt(this.p(h.essential)), h.essential.entityId) : nothing}
				${h.nonessential ? this.row('Non-essential', fmt(this.p(h.nonessential))) : nothing}
				${h.phases.map((ph, i) => this.row(t('phase', { n: i + 1 }), fmt(this.p(ph)), ph.entityId))}
			</div>
			<h3 style="margin-top:12px">${t('rooms')}</h3>
			<div class="list">
				${s.rooms.map(
					(r) =>
						html`<button
							class="row-btn"
							@click=${() => this.select(`room:${r.id}`)}
						>
							${icon('floors', 16)}<span class="n">${r.name}</span
							><span class="p">${fmtText(this.p(r.power))}</span>
						</button>`,
				)}
			</div>
		</div>`;
	}

	private renderMppt(m: MpptSnapshot | undefined): TemplateResult {
		const t = this.t;
		if (!m) return html``;
		const st = this.mpptStatus(m);
		const peer = m.peerId
			? this.snapshot?.solar.mppts.find((x) => x.id === m.peerId)
			: undefined;
		return html`<div class="panel">
			${this.header('solar', this.three.colors.solar, m.name, `${m.orientation ?? ''} · ${t('panels', { n: m.panels })}`)}
			<div class="big" style="margin-bottom:8px">${fmt(this.p(m.power))}</div>
			<div class="rows">
				${this.row(t('status'), html`<span class="status" style="--c:${st.color}">${st.text}</span>`)}
				${this.row(t('voltage'), fmt(this.v(m.voltage)), m.voltage.entityId)}
				${this.row(t('current'), fmt(this.v(m.current, 2)), m.current.entityId)}
				${this.row(t('contribution'), m.share === null ? '—' : `${formatNumber(m.share * 100, 1, this.nf)} %`)}
				${m.efficiency !== null ? this.row(t('efficiency'), `${formatNumber(m.efficiency * 100, 0, this.nf)} %`) : nothing}
				${m.energyToday.configured ? this.row(t('daily_energy'), fmt(this.e(m.energyToday)), m.energyToday.entityId) : nothing}
			</div>
			${
				peer && m.peerRatio !== undefined
					? html`<div class="note">
							${t('compared_with', { name: peer.name, pct: `${formatNumber(m.peerRatio * 100, 0, this.nf)} %` })}
						</div>`
					: nothing
			}
			<div class="note">${t('per_panel_note')}</div>
			<div class="actions">
				<button class="btn" @click=${() => this.moreInfo(m.power.entityId)}>
					${icon('open', 14)} ${t('open_details')}
				</button>
			</div>
		</div>`;
	}

	private renderRoom(r: RoomSnapshot | undefined): TemplateResult {
		const t = this.t;
		if (!r) return html``;
		return html`<div class="panel">
			${this.header('floors', this.three.colors.home, r.name, t(r.floor))}
			<div class="big" style="margin-bottom:8px">${fmt(this.p(r.power))}</div>
			<div class="rows">
				${r.powerSource === 'devices' ? this.row(t('power'), html`<small>${t('sum_of_devices')}</small>`) : nothing}
				${this.row(t('daily_energy'), fmt(this.e(r.energyToday)), r.energyToday.entityId)}
				${r.temperature.configured ? this.row(t('temperature'), fmt(this.v(r.temperature)), r.temperature.entityId) : nothing}
				${r.humidity.configured ? this.row(t('humidity'), fmt(this.v(r.humidity, 0)), r.humidity.entityId) : nothing}
			</div>
			${
				r.lights.length
					? html`<h3 style="margin-top:12px">${t('lights')}</h3>
							<div class="list">
								${r.lights.map(
									(l) =>
										html`<button
											class="row-btn"
											@click=${() => this.moreInfo(l.entityId)}
										>
											<span
												style="color:${l.on ? '#fbbf24' : 'var(--s3d-text-2)'}"
												>${icon('light', 16)}</span
											>
											<span class="n">${l.name}</span
											><span class="pill"
												>${l.available ? (l.on ? t('on') : t('off')) : t('unavailable')}</span
											>
										</button>`,
								)}
							</div>`
					: nothing
			}
			${
				r.devices.length
					? html`<h3 style="margin-top:12px">${t('devices')}</h3>
							<div class="list">
								${r.devices.map(
									(d) =>
										html`<button
											class="row-btn"
											@click=${() => this.select(`device:${d.id}`)}
										>
											<span
												style="color:${d.on ? this.three.colors.home : 'var(--s3d-text-2)'}"
												>${deviceIcon(d.type, d.icon, 16)}</span
											>
											<span class="n">${d.name}</span
											><span class="p">${fmtText(this.p(d.power))}</span>
										</button>`,
								)}
							</div>`
					: nothing
			}
		</div>`;
	}

	/** What a device is doing beyond on/off ("Heat · Heating", "Playing"), in HA's language when HA can format it. */
	private deviceMode(d: DeviceSnapshot): string | null {
		if (!d.stateText) return null;
		if (d.stateText.split(' · ').every((p) => p === 'on' || p === 'off'))
			return null;
		const h = this._hass;
		const so = d.stateEntity ? h?.states[d.stateEntity] : undefined;
		if (!so || !h?.formatEntityState) return d.stateText;
		const mode = h.formatEntityState(so);
		return typeof so.attributes?.hvac_action === 'string' &&
			h.formatEntityAttributeValue
			? `${mode} · ${h.formatEntityAttributeValue(so, 'hvac_action')}`
			: mode;
	}

	private renderDevice(d: DeviceSnapshot | undefined): TemplateResult {
		const t = this.t;
		if (!d) return html``;
		const room = this.snapshot?.rooms.find((r) => r.id === d.roomId);
		const state =
			d.on === null
				? '—'
				: `${d.on ? t('on') : t('off')}${d.onSource === 'power' ? ` (${t('by_power')})` : ''}`;
		const extra = this.deviceMode(d);
		const c = d.control;
		const actionLabel =
			c?.action === 'turn_on'
				? t('turn_on')
				: c?.action === 'turn_off'
					? t('turn_off')
					: t('toggle');
		return html`<div class="panel">
			${this.header(deviceIcon(d.type, d.icon, 20), d.on ? this.three.colors.home : '#64748b', d.name, room?.name ?? '')}
			<div class="big" style="margin-bottom:8px">${fmt(this.p(d.power))}</div>
			<div class="rows">
				${this.row(t('status'), html`<span class="status" style="--c:${d.on ? 'var(--s3d-ok)' : 'var(--s3d-text-2)'}">${state}</span>`, d.stateEntity)}
				${extra ? this.row(t('mode'), extra, d.stateEntity) : nothing}
				${this.row(t('daily_energy'), fmt(this.e(d.energyToday)), d.energyToday.entityId)}
				${d.energyTotal.configured ? this.row(`${t('daily_energy').split(' ')[0]} (${t('total')})`, fmt(this.e(d.energyTotal)), d.energyTotal.entityId) : nothing}
				${d.temperature.configured ? this.row(t('temperature'), fmt(this.v(d.temperature)), d.temperature.entityId) : nothing}
			</div>
			${d.power.entityId ? html`<h3 style="margin-top:12px">${t('history', { hours: 24 })}</h3>` : nothing}
			${this.renderDeviceChart(d)}
			${
				this.confirm && this.confirm.device.id === d.id
					? html`<div class="note">
								${t('confirm_action', { action: actionLabel.toLowerCase(), name: d.name })}
							</div>
							<div class="actions">
								<button
									class="btn primary"
									@click=${() => this.control(d, true)}
								>
									${icon('power', 14)} ${actionLabel}
								</button>
								<button class="btn" @click=${() => (this.confirm = null)}>
									${t('cancel')}
								</button>
							</div>`
					: html`<div class="actions">
							${c ? html`<button class="btn primary" @click=${() => this.control(d)}>${icon('power', 14)} ${actionLabel}</button>` : nothing}
							<button
								class="btn"
								@click=${() => this.moreInfo(d.power.entityId ?? d.stateEntity)}
							>
								${icon('open', 14)} ${t('open_details')}
							</button>
						</div>`
			}
		</div>`;
	}

	private renderDeviceChart(
		d: DeviceSnapshot,
	): TemplateResult | typeof nothing {
		if (!d.power.entityId) return nothing;
		return html`<sunsynk-3d-chart
			.series=${this.deviceHistory}
			.color=${this.three.colors.home}
			.format=${(v: number) => fmtText(formatPower(v, this.decimals, this.nf))}
			.locale=${this.nf.locale}
			.empty=${this.t('history_loading')}
		></sunsynk-3d-chart>`;
	}

	// ------------------------------------------------------------------ bottom

	private withLive(series: Series | null, live: number | null): Series | null {
		if (!series) return null;
		if (live === null) return series;
		const v = [...series.v];
		v[v.length - 1] = live;
		return { t: series.t, v };
	}

	private renderBottom(s: EnergySnapshot): TemplateResult {
		const t = this.t;
		const c = this.three.colors;
		const h = this.history;
		const empty =
			this.historyState === 'loading' ? t('history_loading') : t('no_history');
		const fp = (v: number) => fmtText(formatPower(v, this.decimals, this.nf));
		const live = (r: Reading) => (r.available ? (r.value ?? 0) : null);
		const chart = (
			title: string,
			ic: IconName,
			series: Series | null,
			color: string,
			neg: string,
			now: string,
		) => html`
			<div class="panel chart-panel">
				<h3>${icon(ic, 14)} ${title}<span class="v">${now}</span></h3>
				<sunsynk-3d-chart
					.series=${series}
					.color=${color}
					.negColor=${neg}
					.format=${fp}
					.locale=${this.nf.locale}
					.hour12=${this.hour12}
					.empty=${empty}
				></sunsynk-3d-chart>
			</div>
		`;
		const hours = this.three.statistics.history_hours;
		const kwh = (v: number) =>
			fmtText(formatEnergy(v, this.energyDecimals, this.nf));
		return html`<div class="bottom">
			${chart(`${t('solar')} · ${t('history', { hours })}`, 'solar', this.withLive(h?.solar ?? null, live(s.solar.total)), c.solar, c.solar, fmtText(this.p(s.solar.total)))}
			${chart(`${t('consumption')}`, 'home', this.withLive(h?.home ?? null, live(s.home.essential)), c.home, c.home, fmtText(this.p(s.home.total)))}
			${chart(`${t('battery')}`, 'battery', this.withLive(h?.battery ?? null, live(s.batteryPower)), c.battery_discharge, c.battery_charge, `${fmtText(this.p(s.batteryPower, true))} ${s.batteries[0] && s.batteries[0].state !== 'unavailable' ? t(s.batteries[0].state).toLowerCase() : ''}`)}
			${chart(`${t('grid')}`, 'grid', this.withLive(h?.grid ?? null, s.grid.connection === 'disconnected' ? null : live(s.grid.power)), c.grid_import, c.grid_export, s.grid.state === 'disconnected' ? t('disconnected') : `${fmtText(this.p(s.grid.power, true))} ${s.grid.state === 'importing' || s.grid.state === 'exporting' ? t(s.grid.state).toLowerCase() : ''}`)}
			<div class="panel chart-panel">
				<h3>${icon('chart', 14)} ${t('daily_totals')}</h3>
				<sunsynk-3d-daily
					.rows=${this.daily}
					.keys=${[
						{ key: 'solar', label: t('solar'), color: c.solar },
						{ key: 'home', label: t('consumption'), color: c.home },
						{ key: 'import', label: t('legend_import'), color: c.grid_import },
						{ key: 'export', label: t('legend_export'), color: c.grid_export },
					]}
					.format=${kwh}
					.locale=${this.nf.locale}
					.empty=${empty}
				></sunsynk-3d-daily>
			</div>
		</div>`;
	}
}

export function defineView(): void {
	if (!customElements.get(VIEW_TAG))
		customElements.define(VIEW_TAG, Sunsynk3DView);
}
