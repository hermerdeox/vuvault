/**
 * SvelteKit catchall for `/api/*` paths that have no dedicated
 * handler.
 *
 * Migrated from `functions/api/[[catchall]].ts`. Returns 501 with a
 * stable shape so any client-side accidental fetch surfaces clearly
 * rather than silently appearing to "work". Like every /api handler,
 * this never reads the request body or query string.
 */

import type { RequestHandler } from './$types';

const handler: RequestHandler = async ({ url }) => {
	const body = {
		ok: false,
		error: 'Not Implemented',
		code: 501,
		path: url.pathname,
		hint:
			'No handler for this path. Known paths: /api/opaque/{register,login,logout}/*, /api/v2/{blobs,inv,sessions}/*, /api/capabilities, /api/akd/*.'
	};
	return new Response(JSON.stringify(body, null, 2), {
		status: 501,
		headers: {
			'content-type': 'application/json',
			'cache-control': 'no-store'
		}
	});
};

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const fallback = handler;
