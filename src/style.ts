import { CSSResultGroup, css, html } from 'lit';

export const styles: CSSResultGroup = css`
	.container {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		width: 100%;
		padding: 5px;
	}

	.card {
		border-radius: var(--ha-card-border-radius, 10px);
		box-shadow: var(
			--ha-card-box-shadow,
			0px 0px 0px 1px rgba(0, 0, 0, 0.12),
			0px 0px 0px 0px rgba(0, 0, 0, 0.12),
			0px 0px 0px 0px rgba(0, 0, 0, 0.12)
		);
		background: var(--ha-card-background, var(--card-background-color, white));
		border-width: var(--ha-card-border-width);
		padding: 0px;
	}

	text {
		text-anchor: middle;
		dominant-baseline: middle;
	}

	.left-align {
		text-anchor: start;
	}
	.right-align {
		text-anchor: end;
	}
	.st1 {
		fill: #ff9b30;
	}
	.st2 {
		fill: #f3b3ca;
	}
	.st3 {
		font-size: 9px;
	}
	.st4 {
		font-size: 14px;
	}
	.st5 {
		fill: #969696;
	}
	.st6 {
		fill: #5fb6ad;
	}
	.st7 {
		fill: #5490c2;
	}
	.st8 {
		font-weight: 500;
	}
	.st9 {
		fill: #959595;
	}
	.st10 {
		font-size: 16px;
	}
	.st11 {
		fill: transparent;
	}
	.st12 {
		display: none;
	}
	.st13 {
		font-size: 22px;
	}
	.st14 {
		font-size: 12px;
	}
	.remaining-energy {
		font-size: 9px;
	}

	/* 3D fork: toggle back to 3D, fallback notice and loading placeholder */
	.s3d-classic {
		position: relative;
	}
	.s3d-toggle {
		position: absolute;
		top: 8px;
		right: 8px;
		z-index: 2;
		border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.3));
		background: var(--card-background-color, rgba(0, 0, 0, 0.4));
		color: var(--primary-text-color);
		border-radius: 999px;
		padding: 4px 10px;
		font: 600 12px/1.2 var(--paper-font-body1_-_font-family, inherit);
		cursor: pointer;
		opacity: 0.85;
	}
	.s3d-toggle:hover,
	.s3d-toggle:focus-visible {
		opacity: 1;
	}
	.s3d-notice {
		margin: 6px 8px 8px;
		font-size: 12px;
		color: var(--secondary-text-color);
	}
	.s3d-placeholder {
		display: grid;
		place-items: center;
		min-height: 320px;
	}
	.s3d-loading {
		font-size: 14px;
		color: var(--secondary-text-color);
	}
`;

export const getDynamicStyles = (data) => html`
	<style>
		.essload1-icon {
			color: ${data.dynamicColourEssentialLoad1} !important;
			--mdc-icon-size: 32px;
		}

		.essload2-icon {
			color: ${data.dynamicColourEssentialLoad2} !important;
			--mdc-icon-size: 32px;
		}

		.essload1-small-icon {
			color: ${data.dynamicColourEssentialLoad1} !important;
			--mdc-icon-size: 20px;
		}

		.essload2-small-icon {
			color: ${data.dynamicColourEssentialLoad2} !important;
			--mdc-icon-size: 20px;
		}

		.essload3-small-icon {
			color: ${data.dynamicColourEssentialLoad3} !important;
			--mdc-icon-size: 20px;
		}

		.essload4-small-icon {
			color: ${data.dynamicColourEssentialLoad4} !important;
			--mdc-icon-size: 20px;
		}

		.essload5-small-icon {
			color: ${data.dynamicColourEssentialLoad5} !important;
			--mdc-icon-size: 20px;
		}

		.essload6-small-icon {
			color: ${data.dynamicColourEssentialLoad6} !important;
			--mdc-icon-size: 20px;
		}

		.grid-icon {
			color: ${data.customGridIconColour} !important;
			--mdc-icon-size: 64px;
		}

		.essload1-icon-full {
			color: ${data.dynamicColourEssentialLoad1} !important;
			--mdc-icon-size: 36px;
		}

		.aux-icon {
			color: ${data.auxDynamicColour} !important;
			--mdc-icon-size: 70px;
		}

		.aux-small-icon-1 {
			color: ${data.auxDynamicColourLoad1} !important;
			--mdc-icon-size: 24px;
		}

		.aux-small-icon-2 {
			color: ${data.auxDynamicColourLoad2} !important;
			--mdc-icon-size: 24px;
		}

		.aux-off-icon {
			color: ${data.auxOffColour} !important;
			--mdc-icon-size: 70px;
		}

		.nonessload1-icon {
			color: ${data.dynamicColourNonEssentialLoad1} !important;
			--mdc-icon-size: 32px;
		}

		.nonessload2-icon {
			color: ${data.dynamicColourNonEssentialLoad2} !important;
			--mdc-icon-size: 32px;
		}

		.nonessload3-icon {
			color: ${data.dynamicColourNonEssentialLoad3} !important;
			--mdc-icon-size: 32px;
		}

		.noness-icon {
			color: ${data.gridColour} !important;
			--mdc-icon-size: 70px;
		}

		.grid-icon-small {
			color: ${data.customGridIconColour} !important;
			--mdc-icon-size: 32px;
		}
	</style>
`;
