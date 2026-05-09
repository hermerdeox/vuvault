/**
 * TOTP — RFC 6238 time-based one-time password.
 *
 * Used for the live countdown ring on login items. Default period
 * is 30s, default digits is 6, default algorithm is HMAC-SHA1.
 *
 * Compatible with Google Authenticator, Authy, etc.
 */

import { hmac } from '@noble/hashes/hmac';
import { sha1 } from '@noble/hashes/legacy';
import { sha256, sha512 } from '@noble/hashes/sha2';

export type TotpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512';

export type TotpOpts = {
	secret: Uint8Array; // raw bytes; if Base32-encoded, decode first
	period?: number; // seconds, default 30
	digits?: number; // default 6
	timestamp?: number; // ms epoch; defaults to Date.now()
	algorithm?: TotpAlgorithm; // default SHA1 to match Google Authenticator
};

const HASH_FOR: Record<TotpAlgorithm, typeof sha1> = {
	SHA1: sha1,
	SHA256: sha256,
	SHA512: sha512
};

export function generateTOTP(opts: TotpOpts): { code: string; secondsRemaining: number } {
	const period = opts.period ?? 30;
	const digits = opts.digits ?? 6;
	const algorithm: TotpAlgorithm = opts.algorithm ?? 'SHA1';
	const hash = HASH_FOR[algorithm];
	if (!hash) {
		throw new Error(`generateTOTP: unsupported algorithm ${algorithm}`);
	}
	const now = Math.floor((opts.timestamp ?? Date.now()) / 1000);
	const counter = Math.floor(now / period);
	const secondsRemaining = period - (now % period);

	// 8-byte big-endian counter
	const counterBuf = new Uint8Array(8);
	const view = new DataView(counterBuf.buffer);
	view.setBigUint64(0, BigInt(counter), false);

	const mac = hmac(hash, opts.secret, counterBuf);
	const offset = mac[mac.length - 1]! & 0x0f;
	const binary =
		((mac[offset]! & 0x7f) << 24) |
		((mac[offset + 1]! & 0xff) << 16) |
		((mac[offset + 2]! & 0xff) << 8) |
		(mac[offset + 3]! & 0xff);

	const code = String(binary % 10 ** digits).padStart(digits, '0');
	return { code, secondsRemaining };
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function decodeBase32Totp(encoded: string): Uint8Array {
	const cleaned = encoded.replace(/\s+/g, '').replace(/=/g, '').toUpperCase();
	const bytes: number[] = [];
	let bits = 0,
		value = 0;
	for (const ch of cleaned) {
		const idx = B32.indexOf(ch);
		if (idx < 0) throw new Error('Invalid Base32 character: ' + ch);
		value = (value << 5) | idx;
		bits += 5;
		if (bits >= 8) {
			bytes.push((value >>> (bits - 8)) & 0xff);
			bits -= 8;
		}
	}
	return new Uint8Array(bytes);
}

export type ParsedTotpSeed = {
	secret: Uint8Array;
	period: number;
	digits: number;
	algorithm: 'SHA1' | 'SHA256' | 'SHA512';
	issuer?: string;
	label?: string;
};

/**
 * Parse a stored TOTP seed value into the bytes + parameters needed
 * by `generateTOTP`. Accepts:
 *
 *   1. otpauth://totp/Issuer:Label?secret=BASE32&period=30&digits=6&algorithm=SHA1
 *   2. plain Base32 (RFC 4648, no Crockford remapping)
 *
 * Throws on parse failure so the UI can fall back to "no TOTP".
 */
export function parseTotpSeed(raw: string): ParsedTotpSeed {
	const trimmed = raw.trim();
	if (!trimmed) throw new Error('Empty TOTP seed');

	if (trimmed.toLowerCase().startsWith('otpauth://')) {
		const url = new URL(trimmed);
		if (url.hostname.toLowerCase() !== 'totp') {
			throw new Error(`Unsupported otpauth scheme: ${url.hostname}`);
		}
		const params = url.searchParams;
		const secretParam = params.get('secret');
		if (!secretParam) throw new Error('otpauth URI missing `secret` parameter');
		const algorithmParam = (params.get('algorithm') ?? 'SHA1').toUpperCase();
		if (algorithmParam !== 'SHA1' && algorithmParam !== 'SHA256' && algorithmParam !== 'SHA512') {
			throw new Error(`Unsupported algorithm: ${algorithmParam}`);
		}
		const path = decodeURIComponent(url.pathname.replace(/^\//, ''));
		const [issuerFromPath, labelFromPath] = path.includes(':')
			? path.split(':')
			: [undefined, path];
		return {
			secret: decodeBase32Totp(secretParam),
			period: Number(params.get('period') ?? 30) || 30,
			digits: Number(params.get('digits') ?? 6) || 6,
			algorithm: algorithmParam,
			issuer: params.get('issuer') ?? issuerFromPath,
			label: labelFromPath
		};
	}

	// Treat as raw Base32. Trim spaces/dashes that users sometimes paste.
	const cleaned = trimmed.replace(/[\s-]/g, '');
	return {
		secret: decodeBase32Totp(cleaned),
		period: 30,
		digits: 6,
		algorithm: 'SHA1'
	};
}
