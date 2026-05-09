/**
 * Cloudflare Pages Function — `/api/*` catchall.
 *
 * Handles every `/api/*` path that doesn't have a dedicated handler.
 * The OPAQUE register/login routes under `/api/opaque/...` and the
 * blob upload/fetch routes under `/api/blobs/...` are matched first
 * by Pages' file-system router; this catchall fires only on paths
 * the router doesn't recognize.
 *
 * Returns 501 with a stable shape so any client-side accidental
 * fetch surfaces clearly rather than silently appearing to "work".
 *
 * Like every other handler under `functions/api/`, this never reads
 * the request body or query string — a tampered request to an
 * unknown route must produce an error that's identical regardless
 * of what was sent.
 */

import type { Env } from './_shared/env';

export const onRequest: PagesFunction<Env> = async ({ request }) => {
	const url = new URL(request.url);
	const body = {
		ok: false,
		error: 'Not Implemented',
		code: 501,
		path: url.pathname,
		hint:
			'No handler for this path. Known paths: /api/opaque/{register,login}/*, /api/blobs/*, /api/capabilities.'
	};
	return new Response(JSON.stringify(body, null, 2), {
		status: 501,
		headers: {
			'content-type': 'application/json',
			'cache-control': 'no-store'
		}
	});
};
