<script lang="ts">
	import {
		detectNetwork,
		formatCardNumber,
		maskCardNumber,
		networkLabel
	} from '$lib/utils/card';

	type Props = {
		cardholder?: string;
		cardNumber?: string;
		cardExpiry?: string;
		revealed?: boolean;
	};

	let { cardholder = '', cardNumber = '', cardExpiry = '', revealed = false }: Props = $props();

	const network = $derived(detectNetwork(cardNumber));
	const display = $derived(
		cardNumber ? (revealed ? formatCardNumber(cardNumber) : maskCardNumber(cardNumber)) : '•••• •••• •••• ••••'
	);

	// Subtle 3D tilt that follows the pointer (fine pointers only —
	// guarded in CSS via hover media query; reduced-motion disables).
	let tiltX = $state(0);
	let tiltY = $state(0);
	function onMove(e: PointerEvent) {
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		tiltY = ((e.clientX - r.left) / r.width - 0.5) * 7;
		tiltX = (0.5 - (e.clientY - r.top) / r.height) * 7;
	}
	function onLeave() {
		tiltX = 0;
		tiltY = 0;
	}
</script>

<div class="cc-scene">
	<div
		class="cc"
		data-network={network}
		style:--tx="{tiltX}deg"
		style:--ty="{tiltY}deg"
		onpointermove={onMove}
		onpointerleave={onLeave}
		role="img"
		aria-label="{networkLabel(network)} card ending {cardNumber.replace(/\D/g, '').slice(-4)}"
	>
		<div class="sheen"></div>

		<div class="cc-top">
			<!-- EMV chip -->
			<div class="chip" aria-hidden="true">
				<svg viewBox="0 0 44 34" fill="none" stroke="rgba(60,45,10,0.55)" stroke-width="1.2">
					<path d="M0 11h14M0 23h14M30 11h14M30 23h14M14 11v-11M14 23v11M30 11v-11M30 23v11M14 11h16v12h-16z" />
				</svg>
			</div>
			<!-- contactless -->
			<svg class="nfc" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true">
				<path d="M6 8.8a8 8 0 0 1 0 6.4" opacity="0.45" />
				<path d="M9.5 7a11 11 0 0 1 0 10" opacity="0.65" />
				<path d="M13 5.2a14.2 14.2 0 0 1 0 13.6" opacity="0.85" />
				<path d="M16.5 3.4a17.6 17.6 0 0 1 0 17.2" />
			</svg>

			<div class="brand" data-network={network} aria-hidden="true">
				{#if network === 'mastercard'}
					<span class="mc"><i></i><i></i></span>
				{:else if network === 'visa'}
					<span class="word visa">VISA</span>
				{:else if network === 'amex'}
					<span class="word amex">AMEX</span>
				{:else if network === 'discover'}
					<span class="word discover">DISC<i class="orb"></i>VER</span>
				{:else if network === 'diners'}
					<span class="word">DINERS</span>
				{:else if network === 'jcb'}
					<span class="word">JCB</span>
				{:else if network === 'unionpay'}
					<span class="word">UNIONPAY</span>
				{:else}
					<span class="word generic">VU</span>
				{/if}
			</div>
		</div>

		<div class="number" class:masked={!revealed}>{display}</div>

		<div class="cc-bottom">
			<div class="slot">
				<div class="micro">Cardholder</div>
				<div class="emboss name">{cardholder || '—'}</div>
			</div>
			<div class="slot right">
				<div class="micro">Expires</div>
				<div class="emboss">{cardExpiry || '••/••'}</div>
			</div>
		</div>
	</div>
</div>

<style>
	.cc-scene {
		perspective: 1100px;
		max-width: 460px;
	}
	.cc {
		position: relative;
		aspect-ratio: 1.586;
		border-radius: 18px;
		padding: clamp(16px, 4.5%, 24px);
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		overflow: hidden;
		color: rgba(255, 255, 255, 0.95);
		transform: rotateX(var(--tx, 0deg)) rotateY(var(--ty, 0deg));
		transition: transform 180ms ease, box-shadow 220ms ease;
		box-shadow:
			0 24px 60px rgba(0, 0, 0, 0.55),
			0 4px 14px rgba(0, 0, 0, 0.4),
			inset 0 1px 0 rgba(255, 255, 255, 0.18),
			inset 0 -1px 0 rgba(0, 0, 0, 0.35);
		background:
			radial-gradient(120% 90% at 12% 0%, rgba(255, 255, 255, 0.16), transparent 46%),
			radial-gradient(100% 130% at 100% 100%, rgba(0, 0, 0, 0.32), transparent 55%),
			var(--cc-bg, linear-gradient(135deg, #23272e 0%, #14161a 55%, #1d2127 100%));
	}
	@media (prefers-reduced-motion: reduce), (pointer: coarse) {
		.cc {
			transform: none;
		}
	}

	/* network liveries */
	.cc[data-network='visa'] {
		--cc-bg: linear-gradient(130deg, #16216e 0%, #1a2a8f 45%, #0e1645 100%);
	}
	.cc[data-network='mastercard'] {
		--cc-bg: linear-gradient(130deg, #1c1c1e 0%, #2c2c30 50%, #131315 100%);
	}
	.cc[data-network='amex'] {
		--cc-bg: linear-gradient(130deg, #0a6e63 0%, #0d8a7a 45%, #064b43 100%);
	}
	.cc[data-network='discover'] {
		--cc-bg: linear-gradient(130deg, #4b2e10 0%, #b35309 55%, #3a230a 100%);
	}
	.cc[data-network='diners'] {
		--cc-bg: linear-gradient(130deg, #1e3a5f 0%, #2d5585 50%, #142840 100%);
	}
	.cc[data-network='jcb'] {
		--cc-bg: linear-gradient(130deg, #1f4d2e 0%, #2e7045 50%, #14331e 100%);
	}
	.cc[data-network='unionpay'] {
		--cc-bg: linear-gradient(130deg, #3b1f1f 0%, #7a2f2f 50%, #2a1414 100%);
	}

	/* moving light sweep */
	.sheen {
		position: absolute;
		inset: 0;
		background: linear-gradient(
			115deg,
			transparent 30%,
			rgba(255, 255, 255, 0.08) 45%,
			rgba(255, 255, 255, 0.16) 50%,
			rgba(255, 255, 255, 0.08) 55%,
			transparent 70%
		);
		transform: translateX(-60%);
		animation: sweep 6s ease-in-out infinite;
		pointer-events: none;
	}
	@keyframes sweep {
		0%,
		60% {
			transform: translateX(-70%);
		}
		90%,
		100% {
			transform: translateX(70%);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.sheen {
			animation: none;
		}
	}

	.cc-top {
		display: flex;
		align-items: center;
		gap: 14px;
	}
	.chip {
		width: 44px;
		height: 34px;
		border-radius: 7px;
		background: linear-gradient(145deg, #f3dd8e 0%, #d9b25b 45%, #a8853c 80%, #c9a452 100%);
		box-shadow:
			inset 0 1px 1px rgba(255, 255, 255, 0.65),
			inset 0 -1px 2px rgba(80, 55, 10, 0.55),
			0 1px 3px rgba(0, 0, 0, 0.45);
	}
	.chip svg {
		width: 100%;
		height: 100%;
	}
	.nfc {
		width: 22px;
		height: 22px;
		opacity: 0.85;
	}
	.brand {
		margin-left: auto;
		display: flex;
		align-items: center;
	}
	.word {
		font-weight: 800;
		font-size: 20px;
		letter-spacing: 0.06em;
		font-style: italic;
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
	}
	.word.generic {
		font-style: normal;
		opacity: 0.7;
	}
	.word.discover {
		display: inline-flex;
		align-items: center;
		gap: 1px;
		font-style: normal;
	}
	.orb {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: radial-gradient(circle at 35% 35%, #ffc278, #f96b07 70%);
		display: inline-block;
	}
	.mc {
		display: inline-flex;
	}
	.mc i {
		width: 30px;
		height: 30px;
		border-radius: 50%;
		display: inline-block;
	}
	.mc i:first-child {
		background: #eb001b;
	}
	.mc i:last-child {
		background: #f79e1b;
		margin-left: -12px;
		mix-blend-mode: screen;
	}

	.number {
		font-family: var(--font-mono);
		font-size: clamp(17px, 5.2vw, 24px);
		letter-spacing: 0.1em;
		white-space: nowrap;
		/* embossed */
		color: rgba(255, 255, 255, 0.96);
		text-shadow:
			0 1px 1px rgba(0, 0, 0, 0.6),
			0 -1px 1px rgba(255, 255, 255, 0.22);
	}
	@media (min-width: 45em) {
		.number {
			font-size: 24px;
		}
	}
	.number.masked {
		letter-spacing: 0.14em;
	}

	.cc-bottom {
		display: flex;
		align-items: flex-end;
		gap: 16px;
	}
	.slot.right {
		margin-left: auto;
		text-align: right;
	}
	.micro {
		font-family: var(--font-mono);
		font-size: 8.5px;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		opacity: 0.6;
		margin-bottom: 3px;
	}
	.emboss {
		font-size: 14px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		text-shadow:
			0 1px 1px rgba(0, 0, 0, 0.6),
			0 -1px 1px rgba(255, 255, 255, 0.2);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 100%;
	}
	.emboss.name {
		max-width: 240px;
	}
</style>
