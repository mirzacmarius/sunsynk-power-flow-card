import { css } from 'lit';

export const viewStyles = css`
	:host {
		display: block;
		container-type: inline-size;
		--s3d-radius: var(--ha-card-border-radius, 16px);
		--s3d-text: var(--primary-text-color, #e5e7eb);
		--s3d-text-2: var(--secondary-text-color, #9ca3af);
		--s3d-accent: #7dd3fc;
		--s3d-solar: #ffb020;
		--s3d-charge: #22c55e;
		--s3d-discharge: #22d3ee;
		--s3d-home: #3b82f6;
		--s3d-import: #a855f7;
		--s3d-export: #2dd4bf;
		--s3d-fault: #ef4444;
		--s3d-warn: #f59e0b;
		--s3d-ok: #22c55e;
		--s3d-bg: radial-gradient(
			120% 80% at 70% 0%,
			#1b2a4a 0%,
			#0f172a 45%,
			#0b1120 100%
		);
		--s3d-glass: rgba(17, 24, 39, 0.58);
		--s3d-glass-strong: rgba(17, 24, 39, 0.82);
		--s3d-line: rgba(148, 163, 184, 0.16);
		--s3d-chip: rgba(148, 163, 184, 0.12);
		--s3d-chip-active: rgba(125, 211, 252, 0.22);
		--s3d-shadow: 0 10px 30px rgba(0, 0, 0, 0.28);
		font-variant-numeric: tabular-nums;
	}
	:host([light]) {
		--s3d-text: var(--primary-text-color, #111827);
		--s3d-text-2: var(--secondary-text-color, #4b5563);
		--s3d-accent: #0284c7;
		--s3d-bg: radial-gradient(
			120% 80% at 70% 0%,
			#ffffff 0%,
			#eef3f9 50%,
			#e4ebf3 100%
		);
		--s3d-glass: rgba(255, 255, 255, 0.66);
		--s3d-glass-strong: rgba(255, 255, 255, 0.9);
		--s3d-line: rgba(15, 23, 42, 0.1);
		--s3d-chip: rgba(15, 23, 42, 0.06);
		--s3d-chip-active: rgba(2, 132, 199, 0.16);
		--s3d-shadow: 0 10px 30px rgba(15, 23, 42, 0.12);
	}
	ha-card,
	.card {
		position: relative;
		overflow: hidden;
		border-radius: var(--s3d-radius);
		background: var(--s3d-bg);
		color: var(--s3d-text);
		padding: 14px;
		box-sizing: border-box;
	}
	.ic {
		flex: none;
		display: inline-block;
		vertical-align: middle;
	}
	button {
		font: inherit;
		color: inherit;
	}

	/* ---------- summary ---------- */
	.summary {
		display: grid;
		grid-template-columns: repeat(8, minmax(0, 1fr));
		gap: 8px;
		margin-bottom: 10px;
	}
	/* a tile needs ≈ 190 px for the longest values ("Disconnected", "Deconectată") */
	@container (max-width: 1599px) {
		.summary {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}
	@container (max-width: 819px) {
		.summary {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	.kpi {
		display: flex;
		gap: 10px;
		align-items: center;
		min-width: 0;
		padding: 10px 12px;
		border-radius: 14px;
		background: var(--s3d-glass);
		border: 1px solid var(--s3d-line);
		backdrop-filter: blur(14px) saturate(140%);
		-webkit-backdrop-filter: blur(14px) saturate(140%);
		cursor: pointer;
		text-align: left;
	}
	.kpi:focus-visible,
	.tool:focus-visible,
	.chip:focus-visible,
	.row-btn:focus-visible,
	.label:focus-visible {
		outline: 2px solid var(--s3d-accent);
		outline-offset: 2px;
	}
	.kpi .badge {
		width: 32px;
		height: 32px;
		border-radius: 10px;
		display: grid;
		place-items: center;
		flex: none;
		background: color-mix(in srgb, var(--c) 18%, transparent);
		color: var(--c);
	}
	.kpi .txt {
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.kpi .lbl {
		font-size: 11px;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--s3d-text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.kpi .val {
		font-size: 19px;
		font-weight: 650;
		line-height: 1.2;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.kpi .val small,
	.big small {
		font-size: 12px;
		font-weight: 500;
		margin-left: 2px;
		color: var(--s3d-text-2);
	}
	.kpi .sub {
		font-size: 11.5px;
		color: var(--s3d-text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* ---------- main layout ---------- */
	.main {
		display: grid;
		grid-template-columns: minmax(0, 1fr) clamp(280px, 30%, 360px);
		gap: 10px;
	}
	.stage {
		position: relative;
		height: var(--s3d-stage-height, clamp(380px, 52cqw, 760px));
		border-radius: 14px;
		overflow: hidden;
		background: radial-gradient(
			90% 70% at 50% 35%,
			rgba(125, 211, 252, 0.07),
			transparent 70%
		);
		touch-action: none;
	}
	.canvas-host {
		position: absolute;
		inset: 0;
	}
	.side {
		display: flex;
		flex-direction: column;
		gap: 10px;
		min-width: 0;
		max-height: var(--s3d-stage-height, clamp(380px, 52cqw, 760px));
		overflow-y: auto;
		scrollbar-width: thin;
	}
	@container (max-width: 860px) {
		.main {
			grid-template-columns: 1fr;
		}
		.side {
			max-height: none;
		}
		.stage {
			height: var(--s3d-stage-height-narrow, clamp(300px, 78cqw, 560px));
		}
	}
	@container (max-width: 520px) {
		.card {
			padding: 10px;
		}
		.kpi {
			padding: 8px 10px;
		}
		.kpi .badge {
			width: 28px;
			height: 28px;
		}
		.kpi .val {
			font-size: 17px;
		}
	}

	/* ---------- stage overlays ---------- */
	.toolbar {
		position: absolute;
		top: 10px;
		left: 10px;
		right: 10px;
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		pointer-events: none;
		z-index: 3;
	}
	.toolbar .spacer {
		flex: 1;
	}
	.group {
		display: flex;
		gap: 2px;
		padding: 3px;
		border-radius: 12px;
		background: var(--s3d-glass);
		border: 1px solid var(--s3d-line);
		backdrop-filter: blur(14px);
		-webkit-backdrop-filter: blur(14px);
		pointer-events: auto;
	}
	.tool {
		height: 30px;
		min-width: 30px;
		padding: 0 7px;
		border: 0;
		border-radius: 9px;
		background: transparent;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		cursor: pointer;
		font-size: 12px;
		color: var(--s3d-text-2);
	}
	.tool:hover {
		background: var(--s3d-chip);
		color: var(--s3d-text);
	}
	.tool[aria-pressed='true'] {
		background: var(--s3d-chip-active);
		color: var(--s3d-text);
	}
	.tool .t {
		white-space: nowrap;
	}
	@container (max-width: 700px) {
		.tool .t {
			display: none;
		}
		.toolbar {
			flex-wrap: nowrap;
			overflow-x: auto;
			scrollbar-width: none;
			pointer-events: auto;
		}
	}
	.presets {
		position: absolute;
		left: 10px;
		right: 10px;
		bottom: 10px;
		display: flex;
		gap: 6px;
		justify-content: center;
		flex-wrap: wrap;
		z-index: 3;
		pointer-events: none;
	}
	@container (max-width: 700px) {
		.presets {
			justify-content: flex-start;
			flex-wrap: nowrap;
			overflow-x: auto;
			scrollbar-width: none;
			pointer-events: auto;
		}
	}
	.chip {
		pointer-events: auto;
		border: 1px solid var(--s3d-line);
		background: var(--s3d-glass);
		backdrop-filter: blur(14px);
		-webkit-backdrop-filter: blur(14px);
		padding: 6px 11px;
		border-radius: 999px;
		font-size: 12px;
		cursor: pointer;
		white-space: nowrap;
		color: var(--s3d-text-2);
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.chip[aria-pressed='true'] {
		color: var(--s3d-text);
		background: var(--s3d-chip-active);
		border-color: color-mix(in srgb, var(--s3d-accent) 45%, transparent);
	}
	.legend {
		position: absolute;
		left: 12px;
		bottom: 52px;
		display: flex;
		flex-direction: column;
		gap: 3px;
		font-size: 11px;
		color: var(--s3d-text-2);
		z-index: 2;
		pointer-events: none;
		padding: 7px 9px;
		border-radius: 10px;
		background: var(--s3d-glass);
		border: 1px solid var(--s3d-line);
	}
	.legend i {
		display: inline-block;
		width: 14px;
		height: 3px;
		border-radius: 2px;
		margin-right: 6px;
		vertical-align: middle;
		background: var(--c);
		box-shadow: 0 0 6px var(--c);
	}
	@container (max-width: 700px) {
		.legend {
			display: none;
		}
	}
	.labels {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 2;
		overflow: hidden;
	}
	.label {
		position: absolute;
		left: 0;
		top: 0;
		transform: translate(-9999px, -9999px);
		pointer-events: auto;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 9px 4px 6px;
		border-radius: 999px;
		background: var(--s3d-glass-strong);
		border: 1px solid
			color-mix(in srgb, var(--c, var(--s3d-accent)) 45%, transparent);
		box-shadow: var(--s3d-shadow);
		font-size: 12px;
		white-space: nowrap;
		color: var(--s3d-text);
		will-change: transform;
	}
	.label .dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--c, var(--s3d-accent));
		box-shadow: 0 0 8px var(--c, var(--s3d-accent));
		flex: none;
	}
	.label b {
		font-weight: 650;
	}
	.label .muted {
		color: var(--s3d-text-2);
	}
	.label[selected] {
		border-color: var(--s3d-accent);
		box-shadow:
			0 0 0 2px color-mix(in srgb, var(--s3d-accent) 40%, transparent),
			var(--s3d-shadow);
	}
	.tooltip {
		position: absolute;
		z-index: 4;
		pointer-events: none;
		min-width: 160px;
		max-width: 260px;
		padding: 9px 11px;
		border-radius: 12px;
		background: var(--s3d-glass-strong);
		border: 1px solid var(--s3d-line);
		box-shadow: var(--s3d-shadow);
		font-size: 12px;
		backdrop-filter: blur(14px);
		-webkit-backdrop-filter: blur(14px);
	}
	.tooltip h4 {
		margin: 0 0 5px;
		font-size: 13px;
		font-weight: 650;
	}
	.tooltip .r {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		color: var(--s3d-text-2);
	}
	.tooltip .r span:last-child {
		color: var(--s3d-text);
		font-weight: 600;
	}
	.notice {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		padding: 10px 14px;
		border-radius: 12px;
		background: var(--s3d-glass-strong);
		font-size: 13px;
		z-index: 5;
		max-width: 80%;
		text-align: center;
	}

	/* ---------- side panels ---------- */
	.panel {
		border-radius: 14px;
		background: var(--s3d-glass);
		border: 1px solid var(--s3d-line);
		backdrop-filter: blur(14px) saturate(140%);
		-webkit-backdrop-filter: blur(14px) saturate(140%);
		padding: 12px;
	}
	.panel h3 {
		margin: 0 0 8px;
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--s3d-text-2);
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.panel h3 .grow {
		flex: 1;
	}
	.title {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 8px;
	}
	.title .badge {
		width: 36px;
		height: 36px;
		border-radius: 11px;
		display: grid;
		place-items: center;
		background: color-mix(in srgb, var(--c) 18%, transparent);
		color: var(--c);
		flex: none;
	}
	.title .name {
		font-size: 15px;
		font-weight: 650;
		line-height: 1.2;
	}
	.title .sub {
		font-size: 12px;
		color: var(--s3d-text-2);
	}
	.title .close {
		margin-left: auto;
		border: 0;
		background: var(--s3d-chip);
		border-radius: 9px;
		width: 28px;
		height: 28px;
		display: grid;
		place-items: center;
		cursor: pointer;
		color: var(--s3d-text-2);
	}
	.big {
		font-size: 26px;
		font-weight: 680;
		line-height: 1.1;
	}
	.rows {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 5px 10px;
		font-size: 12.5px;
	}
	.rows .k {
		color: var(--s3d-text-2);
	}
	.rows .v {
		text-align: right;
		font-weight: 600;
	}
	.rows .v small {
		color: var(--s3d-text-2);
		font-weight: 500;
	}
	.status {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-weight: 600;
	}
	.status::before {
		content: '';
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--c, var(--s3d-text-2));
		box-shadow: 0 0 6px var(--c, transparent);
	}
	.soc {
		display: flex;
		gap: 12px;
		align-items: center;
		margin: 4px 0 10px;
	}
	.socbar {
		position: relative;
		width: 44px;
		height: 86px;
		border-radius: 10px;
		border: 1px solid var(--s3d-line);
		background: var(--s3d-chip);
		overflow: hidden;
		display: flex;
		flex-direction: column-reverse;
		padding: 3px;
		gap: 2px;
		box-sizing: border-box;
	}
	.socbar span {
		flex: 1;
		border-radius: 3px;
		background: rgba(148, 163, 184, 0.14);
	}
	.socbar span.on {
		background: var(--c);
		box-shadow: 0 0 8px color-mix(in srgb, var(--c) 60%, transparent);
	}
	.table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}
	.table th {
		text-align: right;
		font-weight: 500;
		color: var(--s3d-text-2);
		padding: 3px 4px;
	}
	.table th:first-child,
	.table td:first-child {
		text-align: left;
	}
	.table td {
		text-align: right;
		padding: 5px 4px;
		border-top: 1px solid var(--s3d-line);
	}
	.table tr {
		cursor: pointer;
	}
	.table tr:hover td {
		background: var(--s3d-chip);
	}
	.mstate {
		font-size: 11px;
		font-weight: 600;
		margin-top: 1px;
	}
	.share {
		height: 4px;
		border-radius: 2px;
		background: var(--s3d-chip);
		margin-top: 3px;
		overflow: hidden;
	}
	.share i {
		display: block;
		height: 100%;
		background: var(--s3d-solar);
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.row-btn {
		display: flex;
		align-items: center;
		gap: 9px;
		width: 100%;
		border: 0;
		background: transparent;
		padding: 6px 4px;
		border-radius: 9px;
		cursor: pointer;
		text-align: left;
		font-size: 12.5px;
	}
	.row-btn:hover {
		background: var(--s3d-chip);
	}
	.row-btn .n {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.row-btn .p {
		font-weight: 600;
	}
	.pill {
		font-size: 10.5px;
		padding: 1px 6px;
		border-radius: 999px;
		background: var(--s3d-chip);
		color: var(--s3d-text-2);
	}
	.actions {
		display: flex;
		gap: 6px;
		margin-top: 10px;
		flex-wrap: wrap;
	}
	.btn {
		border: 1px solid var(--s3d-line);
		background: var(--s3d-chip);
		border-radius: 10px;
		padding: 6px 10px;
		font-size: 12px;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.btn.primary {
		background: var(--s3d-chip-active);
		border-color: color-mix(in srgb, var(--s3d-accent) 45%, transparent);
	}
	.note {
		font-size: 11.5px;
		color: var(--s3d-text-2);
		margin-top: 8px;
		line-height: 1.4;
	}
	.warn {
		color: var(--s3d-warn);
	}
	details summary {
		cursor: pointer;
		font-size: 12px;
		color: var(--s3d-text-2);
		margin-top: 8px;
	}
	.entity {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 2px 8px;
		font-size: 11.5px;
		padding: 5px 0;
		border-top: 1px solid var(--s3d-line);
		cursor: pointer;
	}
	.entity code {
		color: var(--s3d-text-2);
		font-size: 10.5px;
		grid-column: 1 / -1;
		word-break: break-all;
	}

	/* ---------- bottom ---------- */
	.bottom {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr)) minmax(0, 1.3fr);
		gap: 10px;
		margin-top: 10px;
	}
	@container (max-width: 1100px) {
		.bottom {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	@container (max-width: 520px) {
		.bottom {
			grid-template-columns: 1fr;
		}
	}
	.chart-panel {
		min-width: 0;
	}
	.chart-panel h3 .v {
		margin-left: auto;
		text-transform: none;
		letter-spacing: 0;
		font-size: 12px;
		color: var(--s3d-text);
	}
`;
