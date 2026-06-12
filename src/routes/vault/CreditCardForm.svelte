<script lang="ts">
	import {
		detectNetwork,
		formatCardNumber,
		formatExpiry,
		expiryComplete,
		cardNumberComplete,
		cvcLengthFor,
		stripDigits,
		networkLabel,
		maxLengthFor,
		luhnValid
	} from '$lib/utils/card';

	type Props = {
		cardholder?: string;
		cardNumber?: string;
		cardExpiry?: string;
		cardCvc?: string;
	};

	let {
		cardholder = $bindable(''),
		cardNumber = $bindable(''),
		cardExpiry = $bindable(''),
		cardCvc = $bindable('')
	}: Props = $props();

	const network = $derived(detectNetwork(cardNumber));

	// Live per-field validation, computed as the card is filled.
	const numberState = $derived.by(() => {
		const digits = stripDigits(cardNumber);
		if (digits.length === 0) return 'idle';
		if (cardNumberComplete(cardNumber)) return 'ok';
		// At the network's max length with a failing Luhn → definitely wrong.
		if (digits.length >= maxLengthFor(cardNumber) && !luhnValid(cardNumber)) return 'bad';
		return 'typing';
	});
	const expiryState = $derived.by(() => {
		if (!cardExpiry) return 'idle';
		if (expiryComplete(cardExpiry)) {
			// Reject already-expired dates (20xx assumption).
			const [mm, yy] = cardExpiry.split('/').map(Number);
			const exp = new Date(2000 + yy!, mm!, 0);
			return exp >= new Date() ? 'ok' : 'bad';
		}
		return cardExpiry.length >= 5 ? 'bad' : 'typing';
	});
	const cvcState = $derived.by(() => {
		if (!cardCvc) return 'idle';
		return cardCvc.length === cvcLengthFor(cardNumber) ? 'ok' : 'typing';
	});
	const holderState = $derived(cardholder.trim().length >= 2 ? 'ok' : 'idle');

	let expiryRef = $state<HTMLInputElement | undefined>();
	let cvcRef = $state<HTMLInputElement | undefined>();

	function onNumberInput(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const before = input.value.slice(0, input.selectionStart ?? input.value.length);
		const digitsBefore = stripDigits(before).length;
		cardNumber = formatCardNumber(input.value);
		input.value = cardNumber;
		let pos = 0;
		let seen = 0;
		while (pos < cardNumber.length && seen < digitsBefore) {
			if (/\d/.test(cardNumber[pos]!)) seen += 1;
			pos += 1;
		}
		input.setSelectionRange(pos, pos);
		if (cardNumberComplete(cardNumber)) expiryRef?.focus();
	}

	function onExpiryInput(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		cardExpiry = formatExpiry(input.value);
		input.value = cardExpiry;
		if (expiryComplete(cardExpiry)) cvcRef?.focus();
	}

	function onCvcInput(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		cardCvc = stripDigits(input.value).slice(0, cvcLengthFor(cardNumber));
		input.value = cardCvc;
	}
</script>

<div class="ccf" data-network={network}>
	<div class="sheen"></div>

	<div class="ccf-top">
		<div class="chip" aria-hidden="true">
			<svg viewBox="0 0 44 34" fill="none" stroke="rgba(60,45,10,0.55)" stroke-width="1.2">
				<path d="M0 11h14M0 23h14M30 11h14M30 23h14M14 11v-11M14 23v11M30 11v-11M30 23v11M14 11h16v12h-16z" />
			</svg>
		</div>
		<svg class="nfc" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true">
			<path d="M6 8.8a8 8 0 0 1 0 6.4" opacity="0.45" />
			<path d="M9.5 7a11 11 0 0 1 0 10" opacity="0.65" />
			<path d="M13 5.2a14.2 14.2 0 0 1 0 13.6" opacity="0.85" />
			<path d="M16.5 3.4a17.6 17.6 0 0 1 0 17.2" />
		</svg>

		<div class="brand" aria-hidden="true">
			{#if network === 'mastercard'}
				<span class="mc"><i></i><i></i></span>
			{:else if network === 'visa'}
				<span class="word">VISA</span>
			{:else if network === 'amex'}
				<span class="word">AMEX</span>
			{:else if network === 'discover'}
				<span class="word small">DISCOVER</span>
			{:else if network !== 'unknown'}
				<span class="word small">{networkLabel(network).toUpperCase()}</span>
			{/if}
		</div>
	</div>

	<div class="slot number-slot" data-state={numberState}>
		<label class="micro" for="ie-num">Card number</label>
		<input
			id="ie-num"
			type="text"
			value={cardNumber}
			oninput={onNumberInput}
			inputmode="numeric"
			autocomplete="off"
			enterkeyhint="next"
			placeholder="1234 5678 9012 3456"
			spellcheck="false"
		/>
		{#if numberState === 'ok'}
			<span class="tick" aria-hidden="true">✓</span>
		{/if}
	</div>

	<div class="ccf-bottom">
		<div class="slot grow" data-state={holderState}>
			<label class="micro" for="ie-holder">Cardholder</label>
			<input
				id="ie-holder"
				type="text"
				bind:value={cardholder}
				autocomplete="off"
				autocapitalize="characters"
				enterkeyhint="next"
				placeholder="NAME ON CARD"
				spellcheck="false"
			/>
		</div>
		<div class="slot tight" data-state={expiryState}>
			<label class="micro" for="ie-exp">Expires</label>
			<input
				id="ie-exp"
				type="text"
				value={cardExpiry}
				oninput={onExpiryInput}
				bind:this={expiryRef}
				inputmode="numeric"
				autocomplete="off"
				enterkeyhint="next"
				maxlength="5"
				placeholder="MM/YY"
				spellcheck="false"
			/>
		</div>
		<div class="slot tight" data-state={cvcState}>
			<label class="micro" for="ie-cvc">CVC</label>
			<input
				id="ie-cvc"
				type="password"
				value={cardCvc}
				oninput={onCvcInput}
				bind:this={cvcRef}
				inputmode="numeric"
				autocomplete="off"
				enterkeyhint="done"
				maxlength={cvcLengthFor(cardNumber)}
				placeholder={'•'.repeat(cvcLengthFor(cardNumber))}
			/>
		</div>
	</div>
</div>

<style>
	.ccf {
		position: relative;
		aspect-ratio: 1.586;
		max-width: 480px;
		border-radius: 18px;
		padding: clamp(16px, 4.5%, 24px);
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		gap: 8px;
		overflow: hidden;
		color: rgba(255, 255, 255, 0.95);
		box-shadow:
			0 24px 60px rgba(0, 0, 0, 0.55),
			0 4px 14px rgba(0, 0, 0, 0.4),
			inset 0 1px 0 rgba(255, 255, 255, 0.18),
			inset 0 -1px 0 rgba(0, 0, 0, 0.35);
		background:
			radial-gradient(120% 90% at 12% 0%, rgba(255, 255, 255, 0.16), transparent 46%),
			radial-gradient(100% 130% at 100% 100%, rgba(0, 0, 0, 0.32), transparent 55%),
			var(--cc-bg, linear-gradient(135deg, #23272e 0%, #14161a 55%, #1d2127 100%));
		transition: background 400ms ease;
	}
	.ccf[data-network='visa'] {
		--cc-bg: linear-gradient(130deg, #16216e 0%, #1a2a8f 45%, #0e1645 100%);
	}
	.ccf[data-network='mastercard'] {
		--cc-bg: linear-gradient(130deg, #1c1c1e 0%, #2c2c30 50%, #131315 100%);
	}
	.ccf[data-network='amex'] {
		--cc-bg: linear-gradient(130deg, #0a6e63 0%, #0d8a7a 45%, #064b43 100%);
	}
	.ccf[data-network='discover'] {
		--cc-bg: linear-gradient(130deg, #4b2e10 0%, #b35309 55%, #3a230a 100%);
	}
	.ccf[data-network='diners'] {
		--cc-bg: linear-gradient(130deg, #1e3a5f 0%, #2d5585 50%, #142840 100%);
	}
	.ccf[data-network='jcb'] {
		--cc-bg: linear-gradient(130deg, #1f4d2e 0%, #2e7045 50%, #14331e 100%);
	}
	.ccf[data-network='unionpay'] {
		--cc-bg: linear-gradient(130deg, #3b1f1f 0%, #7a2f2f 50%, #2a1414 100%);
	}

	.sheen {
		position: absolute;
		inset: 0;
		background: linear-gradient(
			115deg,
			transparent 30%,
			rgba(255, 255, 255, 0.07) 45%,
			rgba(255, 255, 255, 0.13) 50%,
			rgba(255, 255, 255, 0.07) 55%,
			transparent 70%
		);
		pointer-events: none;
	}

	.ccf-top {
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
		flex-shrink: 0;
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
		min-height: 30px;
		display: flex;
		align-items: center;
	}
	.word {
		font-weight: 800;
		font-size: 20px;
		letter-spacing: 0.06em;
		font-style: italic;
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
		animation: brand-in 220ms ease;
	}
	.word.small {
		font-size: 14px;
		font-style: normal;
	}
	@keyframes brand-in {
		from {
			opacity: 0;
			transform: translateY(-3px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
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

	/* On-card input slots with live validation underlines. */
	.slot {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		position: relative;
	}
	.micro {
		font-family: var(--font-mono);
		font-size: 8.5px;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		opacity: 0.6;
	}
	.slot input {
		width: 100%;
		background: transparent;
		border: none;
		border-bottom: 1.5px solid rgba(255, 255, 255, 0.28);
		border-radius: 0;
		padding: 3px 1px 5px;
		color: rgba(255, 255, 255, 0.96);
		font-family: var(--font-mono);
		font-size: 15px;
		letter-spacing: 0.08em;
		text-shadow: 0 1px 1px rgba(0, 0, 0, 0.55);
		transition: border-color 180ms ease;
		outline: none;
	}
	.slot input::placeholder {
		color: rgba(255, 255, 255, 0.32);
		text-shadow: none;
	}
	.slot input:focus {
		border-bottom-color: rgba(255, 255, 255, 0.75);
	}
	.slot[data-state='ok'] input {
		border-bottom-color: color-mix(in srgb, var(--success) 80%, transparent);
	}
	.slot[data-state='bad'] input {
		border-bottom-color: color-mix(in srgb, var(--danger) 85%, transparent);
	}

	.number-slot input {
		font-size: clamp(16px, 4.6vw, 21px);
		letter-spacing: 0.12em;
	}
	@media (min-width: 45em) {
		.number-slot input {
			font-size: 21px;
		}
	}
	.tick {
		position: absolute;
		right: 2px;
		bottom: 8px;
		font-size: 13px;
		font-weight: 700;
		color: var(--success);
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
		animation: brand-in 200ms ease;
	}

	.ccf-bottom {
		display: flex;
		align-items: flex-end;
		gap: 14px;
	}
	.slot.grow {
		flex: 1;
	}
	.slot.grow input {
		text-transform: uppercase;
		font-size: 13px;
	}
	.slot.tight {
		width: 76px;
		flex-shrink: 0;
	}
	.slot.tight input {
		font-size: 13px;
	}
</style>
