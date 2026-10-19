/**
 * Lightweight SVG charts for the dashboard (no chart library).
 */
import { css, html, LitElement, nothing, svg } from 'lit';
import { property, state } from 'lit/decorators.js';
import type { DailyRow, Series } from '../data/history';

export const CHART_TAG = 'sunsynk-3d-chart';
export const DAILY_TAG = 'sunsynk-3d-daily';

const W = 300;
const H = 92;
const PAD_T = 6;
const PAD_B = 4;

function timeLabel(ms: number, locale?: string, hour12?: boolean): string {
	try {
		return new Date(ms).toLocaleTimeString(locale, {
			hour: '2-digit',
			minute: '2-digit',
			hour12,
		});
	} catch {
		return new Date(ms).toISOString().slice(11, 16);
	}
}

export class SunsynkChart extends LitElement {
	@property({ attribute: false }) series: Series | null = null;
	@property() color = '#ffb020';
	@property() negColor = '';
	@property({ attribute: false }) format: (v: number) => string = (v) =>
		`${Math.round(v)} W`;
	@property() locale?: string;
	@property({ attribute: false }) hour12?: boolean;
	@property() empty = '—';
	@state() private hover: number | null = null;

	static styles = css`
		:host {
			display: block;
			position: relative;
		}
		svg {
			display: block;
			width: 100%;
			height: 92px;
			overflow: visible;
		}
		.axis {
			display: flex;
			justify-content: space-between;
			font-size: 10px;
			color: var(--s3d-text-2, #9ca3af);
			margin-top: 3px;
		}
		.tip {
			position: absolute;
			top: -4px;
			transform: translateX(-50%);
			font-size: 11px;
			padding: 2px 6px;
			border-radius: 6px;
			background: var(--s3d-glass-strong, rgba(17, 24, 39, 0.9));
			border: 1px solid var(--s3d-line, rgba(148, 163, 184, 0.2));
			white-space: nowrap;
			pointer-events: none;
		}
		.empty {
			height: 92px;
			display: grid;
			place-items: center;
			font-size: 12px;
			color: var(--s3d-text-2, #9ca3af);
		}
	`;

	private range(): { min: number; max: number } {
		const vals = (this.series?.v ?? []).filter((x): x is number => x !== null);
		let min = Math.min(0, ...vals);
		let max = Math.max(0, ...vals);
		if (max - min < 1) max = min + 1;
		const padding = (max - min) * 0.08;
		if (max > 0) max += padding;
		if (min < 0) min -= padding;
		return { min, max };
	}

	private y(v: number, r: { min: number; max: number }): number {
		return PAD_T + (1 - (v - r.min) / (r.max - r.min)) * (H - PAD_T - PAD_B);
	}

	private paths(r: { min: number; max: number }): {
		line: string;
		area: string;
	} {
		const v = this.series!.v;
		const n = v.length;
		const x = (i: number) => (i / Math.max(1, n - 1)) * W;
		const zero = this.y(0, r);
		let line = '';
		let area = '';
		let run: [number, number][] = [];
		const flush = () => {
			if (!run.length) return;
			line += `M${run.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join('L')}`;
			area += `M${run[0][0].toFixed(1)},${zero.toFixed(1)}L${run.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join('L')}L${run[run.length - 1][0].toFixed(1)},${zero.toFixed(1)}Z`;
			run = [];
		};
		for (let i = 0; i < n; i++) {
			const val = v[i];
			if (val === null || val === undefined) {
				flush();
				continue;
			}
			run.push([x(i), this.y(val, r)]);
		}
		flush();
		return { line, area };
	}

	private onMove(e: PointerEvent): void {
		if (!this.series) return;
		const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
		const f = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
		this.hover = Math.round(f * (this.series.v.length - 1));
	}

	render() {
		const s = this.series;
		if (!s || !s.v.some((x) => x !== null))
			return html`<div class="empty">${this.empty}</div>`;
		const r = this.range();
		const { line, area } = this.paths(r);
		const zero = this.y(0, r);
		const neg = this.negColor || this.color;
		const id = `c${Math.round(Math.random() * 1e9)}`;
		const n = s.v.length;
		const hv = this.hover !== null ? s.v[this.hover] : null;
		const hx = this.hover !== null ? (this.hover / Math.max(1, n - 1)) * W : 0;
		return html`
			<svg
				viewBox="0 0 ${W} ${H}"
				preserveAspectRatio="none"
				@pointermove=${this.onMove}
				@pointerleave=${() => (this.hover = null)}
			>
				${svg`
					<defs>
						<linearGradient id="${id}p" x1="0" x2="0" y1="0" y2="1">
							<stop offset="0" stop-color="${this.color}" stop-opacity="0.55"></stop>
							<stop offset="1" stop-color="${this.color}" stop-opacity="0.04"></stop>
						</linearGradient>
						<linearGradient id="${id}n" x1="0" x2="0" y1="1" y2="0">
							<stop offset="0" stop-color="${neg}" stop-opacity="0.55"></stop>
							<stop offset="1" stop-color="${neg}" stop-opacity="0.04"></stop>
						</linearGradient>
						<clipPath id="${id}a"><rect x="0" y="0" width="${W}" height="${zero}"></rect></clipPath>
						<clipPath id="${id}b"><rect x="0" y="${zero}" width="${W}" height="${H - zero}"></rect></clipPath>
					</defs>
					<line x1="0" x2="${W}" y1="${zero}" y2="${zero}" stroke="currentColor" stroke-opacity="0.18" stroke-width="1" vector-effect="non-scaling-stroke"></line>
					<path d="${area}" fill="url(#${id}p)" clip-path="url(#${id}a)"></path>
					<path d="${area}" fill="url(#${id}n)" clip-path="url(#${id}b)"></path>
					<path d="${line}" fill="none" stroke="${this.color}" stroke-width="1.6" vector-effect="non-scaling-stroke" clip-path="url(#${id}a)"></path>
					<path d="${line}" fill="none" stroke="${neg}" stroke-width="1.6" vector-effect="non-scaling-stroke" clip-path="url(#${id}b)"></path>
					${this.hover !== null ? svg`<line x1="${hx}" x2="${hx}" y1="0" y2="${H}" stroke="currentColor" stroke-opacity="0.35" vector-effect="non-scaling-stroke"></line>` : nothing}
				`}
			</svg>
			${
				this.hover !== null
					? html`<div class="tip" style="left:${(hx / W) * 100}%">
							${timeLabel(s.t[this.hover], this.locale, this.hour12)} ·
							${hv === null ? '—' : this.format(hv)}
						</div>`
					: nothing
			}
			<div class="axis">
				${[0, 0.25, 0.5, 0.75, 1].map((f) => html`<span>${timeLabel(s.t[Math.round(f * (n - 1))], this.locale, this.hour12)}</span>`)}
			</div>
		`;
	}
}

export interface DailyKey {
	key: keyof Omit<DailyRow, 'date'>;
	label: string;
	color: string;
}

export class SunsynkDaily extends LitElement {
	@property({ attribute: false }) rows: DailyRow[] | null = null;
	@property({ attribute: false }) keys: DailyKey[] = [];
	@property({ attribute: false }) format: (v: number) => string = (v) =>
		`${v.toFixed(1)} kWh`;
	@property() locale?: string;
	@property() empty = '—';
	@state() private hover: number | null = null;

	static styles = css`
		:host {
			display: block;
			position: relative;
		}
		.bars {
			display: grid;
			grid-auto-flow: column;
			grid-auto-columns: 1fr;
			gap: 6px;
			height: 92px;
			align-items: end;
		}
		.day {
			display: flex;
			gap: 2px;
			align-items: flex-end;
			height: 100%;
			cursor: default;
		}
		.day i {
			flex: 1;
			border-radius: 3px 3px 1px 1px;
			min-height: 1px;
			background: var(--c);
			opacity: 0.85;
		}
		.day.on i {
			opacity: 1;
		}
		.axis {
			display: grid;
			grid-auto-flow: column;
			grid-auto-columns: 1fr;
			gap: 6px;
			font-size: 10px;
			color: var(--s3d-text-2, #9ca3af);
			margin-top: 3px;
			text-align: center;
		}
		.legend {
			display: flex;
			flex-wrap: wrap;
			gap: 4px 10px;
			font-size: 10.5px;
			color: var(--s3d-text-2, #9ca3af);
			margin-top: 6px;
		}
		.legend b {
			display: inline-block;
			width: 8px;
			height: 8px;
			border-radius: 2px;
			background: var(--c);
			margin-right: 4px;
		}
		.tip {
			position: absolute;
			top: -6px;
			right: 0;
			font-size: 11px;
			padding: 4px 7px;
			border-radius: 8px;
			background: var(--s3d-glass-strong, rgba(17, 24, 39, 0.9));
			border: 1px solid var(--s3d-line, rgba(148, 163, 184, 0.2));
			pointer-events: none;
			line-height: 1.45;
		}
		.empty {
			height: 92px;
			display: grid;
			place-items: center;
			font-size: 12px;
			color: var(--s3d-text-2, #9ca3af);
		}
	`;

	render() {
		const rows = this.rows;
		const has = rows?.some((r) => this.keys.some((k) => r[k.key] !== null));
		if (!rows || !has) return html`<div class="empty">${this.empty}</div>`;
		const max = Math.max(
			0.1,
			...rows.flatMap((r) => this.keys.map((k) => Math.abs(r[k.key] ?? 0))),
		);
		const day = (ms: number) => {
			try {
				return new Date(ms).toLocaleDateString(this.locale, {
					weekday: 'short',
				});
			} catch {
				return '';
			}
		};
		const h = this.hover !== null ? rows[this.hover] : null;
		return html`
			<div class="bars">
				${rows.map(
					(r, i) =>
						html`<div
							class="day ${this.hover === i ? 'on' : ''}"
							@pointerenter=${() => (this.hover = i)}
							@pointerleave=${() => (this.hover = null)}
						>
							${this.keys.map((k) => html`<i style="--c:${k.color};height:${(Math.abs(r[k.key] ?? 0) / max) * 100}%"></i>`)}
						</div>`,
				)}
			</div>
			<div class="axis">
				${rows.map((r) => html`<span>${day(r.date)}</span>`)}
			</div>
			<div class="legend">
				${this.keys.map((k) => html`<span style="--c:${k.color}"><b></b>${k.label}</span>`)}
			</div>
			${
				h
					? html`<div class="tip">
							${new Date(h.date).toLocaleDateString(this.locale, { weekday: 'long', day: 'numeric', month: 'short' })}<br />
							${this.keys.map((k) => html`<span style="color:${k.color}">●</span> ${k.label}: ${h[k.key] === null ? '—' : this.format(h[k.key]!)}<br />`)}
						</div>`
					: nothing
			}
		`;
	}
}

export function defineCharts(): void {
	if (!customElements.get(CHART_TAG))
		customElements.define(CHART_TAG, SunsynkChart);
	if (!customElements.get(DAILY_TAG))
		customElements.define(DAILY_TAG, SunsynkDaily);
}
