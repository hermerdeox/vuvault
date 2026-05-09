/**
 * Pure ranking helper for the Cmd/Ctrl+K palette. Items with score 0
 * are excluded; others sort by descending score, ties broken by title
 * locale order. Designed to be cheap (single lowercase pass per item)
 * and unit-testable in isolation.
 *
 * Score scale:
 *   100  exact title match
 *    75  title starts with query
 *    65  username starts with query
 *    60  username/url contains query
 *    55  domain part of url contains query
 *    50  title contains query
 *    30  subtitle contains query
 *    20  any tag contains query
 *     0  no match (excluded)
 */

/**
 * `RankInput` is intentionally permissive — it accepts any object
 * with these fields rather than a specific kind from the
 * discriminated union. This lets the palette score `LoginItem`s
 * (which have `username` / `url`) and other kinds (which don't)
 * uniformly without per-kind plumbing in the caller.
 */
export type RankInput = {
	title?: string;
	subtitle?: string;
	username?: string;
	url?: string;
	tags?: string[];
};

const DOMAIN_RE = /^https?:\/\/([^/]+)/i;

function domainOf(url: string | undefined): string {
	if (!url) return '';
	const m = DOMAIN_RE.exec(url);
	return (m?.[1] ?? url).toLowerCase();
}

export function scoreItem(item: RankInput, queryLower: string): number {
	if (!queryLower) return 1; // empty query → keep all items
	const title = (item.title ?? '').toLowerCase();
	const subtitle = (item.subtitle ?? '').toLowerCase();
	const username = (item.username ?? '').toLowerCase();
	const url = (item.url ?? '').toLowerCase();
	const dom = domainOf(item.url);
	const tags = (item.tags ?? []).map((t) => t.toLowerCase());

	if (title === queryLower) return 100;
	if (title.startsWith(queryLower)) return 75;
	if (username && username.startsWith(queryLower)) return 65;
	if ((username && username.includes(queryLower)) || url.includes(queryLower)) return 60;
	if (dom && dom.includes(queryLower)) return 55;
	if (title.includes(queryLower)) return 50;
	if (subtitle.includes(queryLower)) return 30;
	if (tags.some((t) => t.includes(queryLower))) return 20;
	return 0;
}

export function rankItems<T extends RankInput>(
	items: T[],
	query: string,
	limit = 8
): T[] {
	const q = query.trim().toLowerCase();
	const scored = items
		.map((item) => ({ item, score: scoreItem(item, q) }))
		.filter((s) => s.score > 0);
	scored.sort(
		(a, b) =>
			b.score - a.score || (a.item.title ?? '').localeCompare(b.item.title ?? '')
	);
	return scored.slice(0, limit).map((s) => s.item);
}
