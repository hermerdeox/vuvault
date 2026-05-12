/**
 * Onboarding state machine — 7 steps from "Start free" to vault unlocked.
 *
 * Step order:
 *   1. welcome     - claim & 3 cards
 *   2. identity    - device label
 *   3. secret      - generate 256-bit Secret Key
 *   4. recovery    - set local Recovery Password
 *   5. touch       - bind WebAuthn passkey with PRF extension
 *   6. verify      - bundle hash + verification cards
 *   7. pricing     - free vs $25.60/year
 *   8. provision   - run real crypto operations to seal the vault
 *   (then transitions to the vault route)
 *
 * Each step has a canAdvance() predicate. Keyboard nav (arrows, PageUp/Down)
 * only advances when canAdvance is true.
 *
 * `authMode` is set in StepTouch and consumed by StepProvision. It is
 * recorded on the persisted account so unlock takes the matching path.
 */

import { audit } from './audit.svelte';
import { validateRecoveryPassword } from '$lib/security/recovery-password-policy';
import type { AuthMode } from '$lib/utils/storage';

export type StepId =
	| 'welcome'
	| 'identity'
	| 'secret'
	| 'recovery'
	| 'touch'
	| 'verify'
	| 'pricing'
	| 'provision';
export const STEPS: StepId[] = [
	'welcome',
	'identity',
	'secret',
	'recovery',
	'touch',
	'verify',
	'pricing',
	'provision'
];

export type Plan = 'free' | 'paid';

class OnboardingState {
	current = $state<StepId>('welcome');
	deviceLabel = $state<string>('');
	secretKey = $state<Uint8Array | null>(null);
	secretKeyEncoded = $state<string | null>(null);
	secretConfirmed = $state<boolean>(false);
	recoveryPassword = $state<string>('');
	recoveryConfirmed = $state<boolean>(false);
	authenticatorBound = $state<boolean>(false);
	authMode = $state<AuthMode | null>(null); // 'production' once a real PRF passkey is bound; 'demo' on explicit fallback opt-in
	quickUnlockEnabled = $state<boolean>(true);
	/**
	 * 16-byte salt that is the SINGLE source of truth for both PRF
	 * registration and HKDF derivation. Generated once before passkey
	 * registration in StepTouch and persisted unchanged into the account
	 * row by StepProvision. Critical for recoverability — if the salt
	 * differs between provisioning and unlock, the vault becomes
	 * permanently unrecoverable.
	 */
	deviceSalt = $state<Uint8Array | null>(null);
	prfRegistrationOutput = $state<Uint8Array | null>(null); // captured at registration so provision step does not re-prompt
	credentialId = $state<ArrayBuffer | null>(null);
	publicKey = $state<ArrayBuffer | null>(null);
	plan = $state<Plan>('free');
	provisioned = $state<boolean>(false);

	canAdvance = $derived.by<boolean>(() => {
		switch (this.current) {
			case 'welcome':
				return true;
			case 'identity':
				return this.deviceLabel.trim().length >= 2;
			case 'secret':
				return this.secretConfirmed;
			case 'recovery':
				return (
					validateRecoveryPassword(this.recoveryPassword, {
						secretKey: this.secretKey
					}).ok && this.recoveryConfirmed
				);
			case 'touch':
				return this.authenticatorBound && this.authMode !== null;
			case 'verify':
				return true;
			case 'pricing':
				return true;
			case 'provision':
				return this.provisioned;
		}
	});

	currentIndex = $derived(STEPS.indexOf(this.current));

	/**
	 * Whether `step` is currently reachable. Backwards navigation is
	 * always allowed (so users can revise earlier inputs); forwards
	 * navigation is allowed ONE step at a time and only when the
	 * current step's `canAdvance` predicate is true. Direct jumps
	 * across multiple unfilled steps (e.g. console-driven
	 * `onboarding.goTo('provision')`) are refused.
	 */
	canNavigateTo(step: StepId): boolean {
		const targetIdx = STEPS.indexOf(step);
		if (targetIdx < 0) return false;
		const currentIdx = this.currentIndex;
		if (targetIdx <= currentIdx) return true; // back/stay always OK
		if (targetIdx === currentIdx + 1) return this.canAdvance;
		return false;
	}

	goTo(step: StepId): void {
		if (!this.canNavigateTo(step)) {
			audit.push('warn', `Onboarding: refused jump to ${step}`, {
				from: this.current,
				to: step
			});
			return;
		}
		this.current = step;
		audit.push('info', `Onboarding: entered ${step}`);
	}

	next(): void {
		if (!this.canAdvance) {
			audit.push('warn', `Onboarding: refused next() — step incomplete`, {
				step: this.current
			});
			return;
		}
		const idx = this.currentIndex;
		if (idx < STEPS.length - 1) {
			this.current = STEPS[idx + 1]!;
			audit.push('info', `Onboarding: entered ${this.current}`);
		}
	}

	prev(): void {
		const idx = this.currentIndex;
		if (idx > 0) {
			this.current = STEPS[idx - 1]!;
			audit.push('info', `Onboarding: entered ${this.current}`);
		}
	}

	reset(): void {
		this.current = 'welcome';
		this.deviceLabel = '';
		if (this.secretKey) this.secretKey.fill(0);
		this.secretKey = null;
		this.secretKeyEncoded = null;
		this.secretConfirmed = false;
		this.recoveryPassword = '';
		this.recoveryConfirmed = false;
		this.authenticatorBound = false;
		this.authMode = null;
		this.quickUnlockEnabled = true;
		if (this.deviceSalt) this.deviceSalt.fill(0);
		this.deviceSalt = null;
		if (this.prfRegistrationOutput) this.prfRegistrationOutput.fill(0);
		this.prfRegistrationOutput = null;
		this.credentialId = null;
		this.publicKey = null;
		this.plan = 'free';
		this.provisioned = false;
	}

	/**
	 * Forget any in-memory secrets without resetting the step pointer.
	 * Called by StepProvision after the persisted vault is sealed and
	 * loaded into the runtime store.
	 */
	zeroizeSecrets(): void {
		if (this.secretKey) this.secretKey.fill(0);
		this.secretKey = null;
		this.recoveryPassword = '';
		if (this.prfRegistrationOutput) this.prfRegistrationOutput.fill(0);
		this.prfRegistrationOutput = null;
		// deviceSalt is not a secret (it's persisted in plaintext on disk),
		// but we clear the in-memory copy to bound onboarding state lifetime.
		this.deviceSalt = null;
	}
}

export const onboarding = new OnboardingState();
