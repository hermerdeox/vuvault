/**
 * Tiny HTTP / JSON helpers shared across Pages Functions.
 *
 * Keep this file dependency-free (no $lib imports, no SvelteKit).
 * Pages Functions resolve from project root and any unresolved
 * import here will surface as a 500 at request time.
 *
 * ZK invariant: every handler returns a small, predictable JSON
 * shape. We never echo request bodies or headers in error responses
 * — a tampered request must produce an error that is identical
 * regardless of the offending field, so an attacker can't probe
 * server state by triggering different errors.
 */

export type JsonResponse =
	| { ok: true; data: unknown }
	| { ok: false; error: string; code: number };

export function json(
	body: JsonResponse,
	status: number,
	extraHeaders: Record<string, string> = {}
): Response {
	return new Response(JSON.stringify(body, null, 2), {
		status,
		headers: {
			'content-type': 'application/json',
			'cache-control': 'no-store',
			...extraHeaders
		}
	});
}

export function jsonOk(data: unknown): Response {
	return json({ ok: true, data }, 200);
}

export function jsonError(code: number, error: string): Response {
	return json({ ok: false, error, code }, code);
}

/**
 * Decode a base64 string to bytes. Throws on malformed input. Used
 * to coerce the JSON-on-the-wire form (`OpaqueWire` in
 * `src/lib/types/sync.ts`) into the engine's `Uint8Array` form.
 */
export function b64decode(input: string): Uint8Array {
	const bin = atob(input);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

/**
 * Encode bytes as base64. Used to coerce the engine's `Uint8Array`
 * output back to JSON-on-the-wire form.
 */
export function b64encode(bytes: Uint8Array): string {
	let bin = '';
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
	return btoa(bin);
}

/** Parse and validate a request body. Returns null on any failure. */
export async function readJson<T = unknown>(req: Request): Promise<T | null> {
	const ct = req.headers.get('content-type') ?? '';
	if (!ct.includes('application/json')) return null;
	try {
		return (await req.json()) as T;
	} catch {
		return null;
	}
}

/** Standard CORS-equivalent for same-origin only. We do NOT serve
 *  cross-origin so this is short and explicit. */
export function preflight(): Response {
	return new Response(null, {
		status: 204,
		headers: { 'cache-control': 'no-store' }
	});
}
