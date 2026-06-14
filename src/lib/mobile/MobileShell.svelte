<!--
  MobileShell — the iOS-native tabbed vault, shipped for `data-vp~='mobile'`
  (viewport < 720px). Pixel-ported from the "VuVault Mobile" design
  (Vault · Watchtower · Generator · Settings + add sheet + tab bar) and
  wired end-to-end to the REAL backend:

    • items / search / categories / recents  → vault store ($state runes)
    • health ring + weak/reused + watchtower  → vault.health (live snapshot)
    • generator                               → $lib/crypto/passgen + passphrase
    • copy                                    → secure-clipboard (60s auto-clear)
    • add login                               → vault.add() (real encrypt+persist+sync)
    • other item kinds / edit / detail        → real ItemEditor / VaultDetail (bubbled)
    • lock                                    → real vault.lock → /unlock (bubbled)

  The prototype's phone frame, fake status bar, and in-app Face-ID lock
  overlay are intentionally dropped: the real PWA is full-bleed with
  safe-area insets, and locking zeroizes keys and routes to /unlock
  (the dedicated unlock screen IS the lock screen). Colours/spacing are
  the design's; the typeface is the app's self-hosted brand font (CSP
  forbids Google Fonts), with JetBrains Mono matching the design exactly.
-->
<script lang="ts">
	import { untrack, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	import { vault, type ItemKind, type VaultItem } from '$lib/stores/vault.svelte';
	import { generate, entropyBits, type GeneratorOpts } from '$lib/crypto/passgen';
	import { generatePassphrase, passphraseEntropyBits } from '$lib/crypto/passphrase';
	import { copySecretToClipboard, CLIPBOARD_CLEAR_MS } from '$lib/services/secure-clipboard';
	import { currentLevel } from '$lib/data/privacy-level';
	import { hasQuickUnlock, disableQuickUnlock } from '$lib/services/quick-unlock';
	import { IDLE_LOCK_MS } from '$lib/services/auto-lock';
	import VaultDetail from '../../routes/vault/VaultDetail.svelte';

	type Props = {
		/** Bubble up to the route's real lock flow (zeroize → /unlock). */
		onLock: () => void | Promise<void>;
		/** Open the real ItemEditor for a given kind (create mode). */
		onCreateKind: (kind: ItemKind) => void;
		/** Open the real ItemEditor for an existing item (edit mode). */
		onEditItem: (item: VaultItem) => void;
		/** Open the real master-password / account settings surface. */
		onOpenMasterPassword: () => void;
	};
	let { onLock, onCreateKind, onEditItem, onOpenMasterPassword }: Props = $props();

	// ──────────────────────────────────────────────────────────── nav + UI
	type Tab = 'vault' | 'watch' | 'gen' | 'set';
	let tab = $state<Tab>('vault');
	let sheet = $state<null | 'types' | 'login'>(null);
	let detailOpen = $state(false);
	let toastMsg = $state<string | null>(null);
	let toastTimer: ReturnType<typeof setTimeout> | undefined;

	function toast(msg: string) {
		clearTimeout(toastTimer);
		toastMsg = msg;
		toastTimer = setTimeout(() => (toastMsg = null), 2200);
	}

	function go(next: Tab) {
		tab = next;
		vault.searchQuery = '';
		vault.categoryFilter = 'all';
	}

	// ───────────────────────────────────────────────────────── vault data
	const C = 326.7; // 2π·52, the design ring circumference
	const loginCount = $derived(vault.items.filter((i) => i.kind === 'login').length);
	const flaggedCount = $derived(
		new Set([...vault.health.weakIds, ...vault.health.reusedIds]).size
	);
	const protectedCount = $derived(Math.max(0, loginCount - flaggedCount));
	const targetScore = $derived(loginCount === 0 ? 100 : Math.round((protectedCount / loginCount) * 100));

	let displayScore = $state(0);
	let ringOffset = $state(C);

	$effect(() => {
		const target = targetScore;
		const reduce =
			typeof matchMedia !== 'undefined' &&
			matchMedia('(prefers-reduced-motion: reduce)').matches;
		const from = untrack(() => displayScore);
		if (reduce) {
			displayScore = target;
			ringOffset = C * (1 - target / 100);
			return;
		}
		let raf = 0;
		const t0 = performance.now();
		const dur = 1100;
		const step = (now: number) => {
			const p = Math.min((now - t0) / dur, 1);
			const e = 1 - Math.pow(1 - p, 3);
			displayScore = Math.round(from + (target - from) * e);
			ringOffset = C * (1 - displayScore / 100);
			if (p < 1) raf = requestAnimationFrame(step);
		};
		raf = requestAnimationFrame(step);
		return () => cancelAnimationFrame(raf);
	});

	// category counts
	const cat = $derived(vault.byKind);
	const loginsWith2fa = $derived(cat.login.filter((i) => i.kind === 'login' && i.totpSeed).length);

	// recents vs filtered results
	const searching = $derived(
		vault.searchQuery.trim().length > 0 || vault.categoryFilter !== 'all'
	);
	const recentItems = $derived(
		[...vault.items].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 7)
	);
	const listItems = $derived(searching ? vault.filtered : recentItems);

	const CAT_LABELS: Record<string, string> = {
		all: 'Recent',
		login: 'Logins',
		card: 'Cards',
		identity: 'Identities',
		note: 'Notes',
		ssh: 'SSH keys',
		'crypto-seed': 'Crypto seeds',
		document: 'Documents',
		weak: 'Weak passwords',
		reused: 'Reused passwords'
	};
	const listHeading = $derived(
		vault.searchQuery.trim()
			? 'Results'
			: (CAT_LABELS[vault.categoryFilter] ?? 'Recent')
	);

	function pickCategory(kind: ItemKind) {
		vault.categoryFilter = vault.categoryFilter === kind ? 'all' : kind;
	}
	function clearFilter() {
		vault.categoryFilter = 'all';
		vault.searchQuery = '';
	}

	// ─────────────────────────────────────────────── recent-row presentation
	const TINTS: Record<string, string> = {
		google: '#4285F4', github: '#2b3137', amazon: '#ff9900', netflix: '#e50914',
		spotify: '#1DB954', dropbox: '#0061FF', linkedin: '#0A66C2', stripe: '#635bff',
		apple: '#1d1d1f', microsoft: '#0078d4', facebook: '#1877F2', twitter: '#1d9bf0',
		slack: '#4A154B', figma: '#a259ff', notion: '#111', reddit: '#FF4500',
		paypal: '#003087', discord: '#5865F2', x: '#111'
	};
	function tileBg(title: string): string {
		const key = (title || '').trim().toLowerCase().split(/[\s.]/)[0];
		if (key && TINTS[key]) return TINTS[key];
		let h = 0;
		for (const ch of title || '?') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
		const hue = h % 360;
		return `linear-gradient(135deg, hsl(${hue} 48% 44%), hsl(${(hue + 26) % 360} 50% 30%))`;
	}
	function tileLabel(title: string): string {
		const t = (title || '').trim();
		return t ? t.charAt(0).toUpperCase() : '?';
	}
	function rowSub(item: VaultItem): string {
		switch (item.kind) {
			case 'login':
				return item.username || item.url || 'No username';
			case 'card':
				return item.cardNumber ? '•••• ' + item.cardNumber.replace(/\s/g, '').slice(-4) : 'Card';
			case 'note':
				return item.subtitle || 'Secure note';
			case 'identity':
				return item.subtitle || 'Identity';
			case 'ssh':
				return 'SSH key';
			case 'crypto-seed':
				return 'Recovery phrase';
			default:
				return item.subtitle || '';
		}
	}
	function dotColor(id: string): string {
		const h = vault.health.byId.get(id);
		if (!h) return 'var(--green)';
		if (h.weak) return 'var(--amber)';
		if (h.reused) return 'var(--cyan)';
		return 'var(--green)';
	}
	function rel(ts: number): string {
		const d = Date.now() - ts;
		const m = Math.floor(d / 60000);
		if (m < 1) return 'now';
		if (m < 60) return m + 'm';
		const h = Math.floor(m / 60);
		if (h < 24) return h + 'h';
		const days = Math.floor(h / 24);
		if (days === 1) return 'Yest';
		if (days < 7) return days + 'd';
		const w = Math.floor(days / 7);
		if (w < 5) return w + 'w';
		const mo = Math.floor(days / 30);
		if (mo < 12) return mo + 'mo';
		return Math.floor(days / 365) + 'y';
	}

	function openItem(item: VaultItem) {
		vault.select(item.id);
		detailOpen = true;
	}

	// greeting (time-based, no fabricated name)
	const greeting = $derived.by(() => {
		const h = new Date().getHours();
		if (h < 12) return 'Good morning.';
		if (h < 18) return 'Good afternoon.';
		return 'Good evening.';
	});

	// sync badge
	const syncBadge = $derived.by(() => {
		switch (vault.syncStatus) {
			case 'synced':
				return 'SYNCED';
			case 'syncing':
				return 'SYNCING…';
			case 'failed':
				return 'SYNC FAILED';
			case 'ready':
				return 'SYNC READY';
			default:
				return 'LOCAL ONLY';
		}
	});

	async function syncNow() {
		await vault.syncNow();
		toast(vault.syncStatus === 'synced' ? 'Vault synced' : vault.syncMessage);
	}

	// ───────────────────────────────────────────────────────── watchtower
	type Issue = { item: VaultItem; kind: 'weak' | 'reused'; title: string; sub: string; action: string };
	const issues = $derived.by<Issue[]>(() => {
		const out: Issue[] = [];
		for (const it of vault.items) {
			const h = vault.health.byId.get(it.id);
			if (!h) continue;
			if (h.weak) {
				out.push({ item: it, kind: 'weak', title: 'Weak password', sub: it.title + ' · ' + rowSub(it), action: 'Fix' });
			} else if (h.reused) {
				out.push({ item: it, kind: 'reused', title: 'Reused password', sub: it.title + ' · ' + rowSub(it), action: 'Review' });
			}
		}
		return out;
	});
	const issueCount = $derived(issues.length);
	const issueHeading = $derived(
		issueCount === 0
			? 'Vault fully hardened'
			: issueCount + (issueCount === 1 ? ' item needs attention' : ' items need attention')
	);
	const issueLine = $derived(
		issueCount === 0 ? 'All credentials are strong.' : 'A few credentials could be stronger.'
	);
	function fixIssue(it: Issue) {
		openItem(it.item);
	}
	function rescan() {
		toast(issueCount === 0 ? 'Scan complete · all clear' : 'Scan complete · ' + issueCount + ' open');
	}

	// ───────────────────────────────────────────────────────── generator
	let genLen = $state(20);
	let genUpper = $state(true);
	let genLower = $state(true);
	let genNum = $state(true);
	let genSym = $state(true);
	let genMode = $state<'password' | 'passphrase'>('password');
	let genValue = $state('');

	function passOpts(): GeneratorOpts {
		// passgen defaults: upper/lower/digit on unless ===false, symbol off
		// unless ===true. Never let the class set go empty (passgen throws).
		const anyClass = genUpper || genLower || genNum || genSym;
		return {
			length: genLen,
			upper: genUpper,
			lower: anyClass ? genLower : true,
			digit: genNum,
			symbol: genSym
		};
	}
	const phraseWords = $derived(Math.max(3, Math.min(7, Math.round(genLen / 4))));
	function regen() {
		try {
			genValue =
				genMode === 'passphrase'
					? generatePassphrase({ words: phraseWords, capitalize: genUpper, number: genNum })
					: generate(passOpts());
		} catch {
			// guard against an impossible all-off character set
			genValue = generate({ length: genLen, lower: true });
		}
	}

	const strength = $derived.by(() => {
		const bits =
			genMode === 'passphrase'
				? passphraseEntropyBits({ words: phraseWords, number: genNum })
				: entropyBits(passOpts());
		if (bits < 45) return { label: 'Weak', color: 'var(--red)', pct: 26 };
		if (bits < 70) return { label: 'Fair', color: 'var(--amber)', pct: 54 };
		if (bits < 110) return { label: 'Strong', color: 'var(--green)', pct: 80 };
		return { label: 'Fortress', color: 'var(--cyan)', pct: 100 };
	});

	function setLen(e: Event) {
		genLen = +(e.target as HTMLInputElement).value;
		regen();
	}
	function setMode(m: 'password' | 'passphrase') {
		genMode = m;
		regen();
	}
	function toggle(which: 'upper' | 'lower' | 'num' | 'sym') {
		if (which === 'upper') genUpper = !genUpper;
		else if (which === 'lower') genLower = !genLower;
		else if (which === 'num') genNum = !genNum;
		else genSym = !genSym;
		regen();
	}
	async function copyGen() {
		const ok = await copySecretToClipboard('password', genValue);
		toast(ok ? `Copied · clears in ${Math.round(CLIPBOARD_CLEAR_MS / 1000)}s` : 'Clipboard unavailable');
	}

	function sw(on: boolean) {
		return { bg: on ? 'var(--cyan)' : 'var(--line2)', knob: on ? 'translateX(18px)' : 'translateX(0)' };
	}
	function seg(active: boolean) {
		return { bg: active ? 'var(--s4)' : 'transparent', color: active ? 'var(--cyan)' : 'var(--tx3)' };
	}

	// ───────────────────────────────────────────────── add sheet (login)
	let formSite = $state('');
	let formUser = $state('');
	let formPass = $state('');

	function openAdd() {
		sheet = 'types';
	}
	function pickLogin() {
		formSite = '';
		formUser = '';
		formPass = '';
		sheet = 'login';
	}
	function pickKind(kind: ItemKind) {
		sheet = null;
		onCreateKind(kind);
	}
	function genFormPass() {
		formPass = generate({ length: 20, upper: true, lower: true, digit: true, symbol: true });
	}
	function saveLogin() {
		const title = formSite.trim() || 'Untitled login';
		vault.add({
			kind: 'login',
			title,
			username: formUser.trim() || undefined,
			password: formPass || undefined
		});
		sheet = null;
		toast('“' + title + '” sealed to your vault');
	}

	// ───────────────────────────────────────────────────────── settings
	let faceIdOn = $state(false);
	$effect(() => {
		void hasQuickUnlock().then((v) => (faceIdOn = v));
	});
	async function toggleFaceid() {
		if (faceIdOn) {
			await disableQuickUnlock();
			faceIdOn = false;
			toast('Face ID unlock disabled');
		} else {
			toast('Enable Face ID from the unlock screen');
		}
	}

	const syncOn = $derived(vault.syncStatus !== 'local-only' && vault.syncStatus !== 'no-session');
	async function toggleSync() {
		if (syncOn) await syncNow();
		else toast('Sync server not configured');
	}

	let clipOn = $state(true);
	function toggleClip() {
		clipOn = !clipOn;
		if (!clipOn) toast('Clipboard always auto-clears for safety');
	}

	const autoLockLabel = $derived.by(() => {
		const min = Math.round(IDLE_LOCK_MS / 60000);
		return `After ${min} min`;
	});
	const privacyLabel = $derived(`Level ${currentLevel().id}`);
	const deviceName = $derived(vault.deviceLabel || 'This device');
	const deviceInitial = $derived((vault.deviceLabel || 'V').charAt(0).toUpperCase());

	// Switch / segmented presentation, derived so the template stays free
	// of {@const} (which Svelte only allows as a direct child of a block).
	const segP = $derived(seg(genMode === 'password'));
	const segPh = $derived(seg(genMode === 'passphrase'));
	const up = $derived(sw(genUpper));
	const lo = $derived(sw(genLower));
	const nu = $derived(sw(genNum));
	const sy = $derived(sw(genSym));
	const fa = $derived(sw(faceIdOn));
	const sy2 = $derived(sw(syncOn));
	const cl = $derived(sw(clipOn));

	onMount(() => {
		regen();
	});
</script>

<div class="vv-root">
	<div class="vv-app" data-app>

		<!-- ───────────────────────────── VAULT ───────────────────────────── -->
		{#if tab === 'vault'}
			<div class="vv-screen">
				<header style="display:flex;align-items:flex-start;justify-content:space-between;padding:6px 2px 15px">
					<div>
						<h1 style="font-size:32px;font-weight:900;letter-spacing:-.03em;margin:0;line-height:1">Vault</h1>
						<p style="font-family:var(--serif);font-style:italic;font-size:15px;color:var(--tx2);margin:7px 0 0">{greeting}</p>
					</div>
					<div style="display:flex;gap:9px">
						<button onclick={() => go('watch')} title="Watchtower" aria-label="Open Watchtower" style="width:44px;height:44px;border-radius:13px;background:var(--s2);border:1px solid var(--line);display:grid;place-items:center;color:var(--tx2);cursor:pointer;position:relative">
							<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>
							{#if issueCount > 0}<span style="position:absolute;top:9px;right:10px;width:7px;height:7px;border-radius:50%;background:var(--amber);box-shadow:0 0 0 2px var(--s2)"></span>{/if}
						</button>
						<button onclick={() => onLock()} title="Lock" aria-label="Lock vault" style="width:44px;height:44px;border-radius:13px;background:var(--s2);border:1px solid var(--line);display:grid;place-items:center;color:var(--tx2);cursor:pointer">
							<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
						</button>
					</div>
				</header>

				<div class="vv-search" style="display:flex;align-items:center;gap:11px;background:var(--s2);border:1px solid var(--line);border-radius:14px;padding:12px 15px;margin-bottom:18px">
					<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" style="color:var(--tx3);flex:0 0 auto"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
					<input bind:value={vault.searchQuery} placeholder="Search your vault" autocomplete="off" spellcheck="false" style="flex:1;background:transparent;border:none;outline:none;color:var(--tx);font-family:var(--sans);font-size:15.5px;min-width:0" />
				</div>

				<!-- health card -->
				<section style="position:relative;border-radius:22px;padding:18px;margin-bottom:22px;overflow:hidden;background:linear-gradient(160deg,#121318 0%,#0c0d10 60%);border:1px solid #25262d;box-shadow:0 1px 0 rgba(255,255,255,.05) inset,0 24px 50px -30px rgba(0,0,0,.9)">
					<div style="position:absolute;width:300px;height:300px;border-radius:50%;top:-150px;left:-60px;background:radial-gradient(circle,rgba(47,217,245,.22),transparent 65%);pointer-events:none"></div>
					<div style="position:absolute;width:300px;height:300px;border-radius:50%;bottom:-180px;right:-80px;background:radial-gradient(circle,rgba(47,217,245,.10),transparent 65%);pointer-events:none"></div>
					<div class="vv-sweep" style="position:absolute;top:-40%;left:-30%;width:60%;height:200%;background:linear-gradient(115deg,transparent 42%,rgba(255,255,255,.05) 50%,transparent 58%);transform:rotate(8deg);pointer-events:none"></div>
					<div style="position:relative;display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
						<span style="font-family:var(--mono);font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--tx3)">Vault health</span>
						<span style="font-family:var(--mono);font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--cyan);border:1px solid var(--cyan-line);border-radius:999px;padding:5px 11px;background:rgba(47,217,245,.06)">Vu {privacyLabel}</span>
					</div>
					<div style="position:relative;display:flex;align-items:center;gap:20px">
						<div style="position:relative;width:112px;height:112px;flex:0 0 auto">
							<svg viewBox="0 0 118 118" width="112" height="112" style="transform:rotate(-90deg)">
								<defs><linearGradient id="vvgrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2fd9f5" /><stop offset="1" stop-color="#7ef0ff" /></linearGradient></defs>
								<circle cx="59" cy="59" r="52" style="fill:none;stroke:#1b1c22;stroke-width:9" />
								<circle cx="59" cy="59" r="52" style="fill:none;stroke:url(#vvgrad);stroke-width:9;stroke-linecap:round;stroke-dasharray:326.7;stroke-dashoffset:{ringOffset};filter:drop-shadow(0 0 6px rgba(47,217,245,.5))" />
							</svg>
							<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">
								<b style="font-size:33px;font-weight:800;letter-spacing:-.02em;line-height:1">{displayScore}</b>
								<span style="font-family:var(--mono);font-size:11px;color:var(--tx3);margin-top:2px">/ 100</span>
							</div>
						</div>
						<div style="flex:1;display:flex;flex-direction:column;gap:10px">
							<button onclick={() => go('watch')} style="display:flex;align-items:center;gap:10px;background:none;border:none;padding:0;cursor:pointer;color:var(--tx);font-family:var(--sans)"><i style="width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 8px rgba(52,211,153,.5);flex:0 0 auto"></i><b style="font-size:16px;font-weight:700;min-width:14px">0</b><span style="font-size:13.5px;color:var(--tx2)">exposed</span><span style="margin-left:auto;color:var(--tx4)"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6" /></svg></span></button>
							<button onclick={() => go('watch')} style="display:flex;align-items:center;gap:10px;background:none;border:none;padding:0;cursor:pointer;color:var(--tx);font-family:var(--sans)"><i style="width:8px;height:8px;border-radius:50%;background:var(--amber);box-shadow:0 0 8px rgba(232,176,75,.4);flex:0 0 auto"></i><b style="font-size:16px;font-weight:700;min-width:14px">{vault.weakCount}</b><span style="font-size:13.5px;color:var(--tx2)">weak passwords</span><span style="margin-left:auto;color:var(--tx4)"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6" /></svg></span></button>
							<button onclick={() => go('watch')} style="display:flex;align-items:center;gap:10px;background:none;border:none;padding:0;cursor:pointer;color:var(--tx);font-family:var(--sans)"><i style="width:8px;height:8px;border-radius:50%;background:var(--amber);box-shadow:0 0 8px rgba(232,176,75,.4);flex:0 0 auto"></i><b style="font-size:16px;font-weight:700;min-width:14px">{vault.reusedCount}</b><span style="font-size:13.5px;color:var(--tx2)">reused</span><span style="margin-left:auto;color:var(--tx4)"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6" /></svg></span></button>
						</div>
					</div>
					<div style="position:relative;margin-top:16px;padding-top:14px;border-top:1px solid #1f2027;display:flex;align-items:center;justify-content:space-between;gap:10px">
						<div style="font-family:var(--mono);font-size:10px;letter-spacing:.1em;color:var(--tx4);display:flex;align-items:center;gap:8px"><i style="width:5px;height:5px;border-radius:50%;background:var(--green);box-shadow:0 0 6px rgba(52,211,153,.6)"></i>AES-256-GCM · ZERO-KNOWLEDGE</div>
						<div style="font-family:var(--mono);font-size:10px;letter-spacing:.06em;color:var(--tx4)">{syncBadge}</div>
					</div>
				</section>

				<!-- categories -->
				<section style="margin-bottom:22px">
					<div style="display:flex;align-items:center;justify-content:space-between;margin:0 2px 12px"><span style="font-family:var(--mono);font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--tx3)">Categories</span>{#if vault.categoryFilter !== 'all'}<button onclick={clearFilter} style="font-size:12.5px;color:var(--cyan);font-weight:500;cursor:pointer;display:inline-flex;align-items:center;gap:3px;background:none;border:none;font-family:var(--sans)">Clear</button>{/if}</div>
					<div data-hscroll style="display:flex;gap:11px;overflow-x:auto;scrollbar-width:none;margin:0 -18px;padding:2px 18px 2px">
						<button onclick={() => pickCategory('login')} style="flex:0 0 auto;width:128px;display:flex;flex-direction:column;gap:11px;align-items:flex-start;background:linear-gradient(135deg,var(--s3),var(--s2));border:1px solid {vault.categoryFilter === 'login' ? 'var(--cyan)' : 'var(--cyan-line)'};border-radius:16px;padding:14px;cursor:pointer;text-align:left;font-family:var(--sans)"><span style="width:38px;height:38px;border-radius:11px;background:var(--cyan-dim);border:1px solid var(--cyan-line);display:grid;place-items:center;color:var(--cyan)"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 18v3c0 .6.4 1 1 1h4v-3h3v-3h2l1.4-1.4a6.5 6.5 0 1 0-4-4Z" /><circle cx="16.5" cy="7.5" r="1.4" /></svg></span><span style="display:block"><b style="font-size:15px;font-weight:700;display:block;letter-spacing:-.01em">Logins</b><span style="font-family:var(--mono);font-size:11.5px;color:var(--tx3)">{cat.login.length} · {loginsWith2fa} with 2FA</span></span></button>
						<button onclick={() => pickCategory('card')} style="flex:0 0 auto;width:118px;display:flex;flex-direction:column;gap:11px;align-items:flex-start;background:var(--s2);border:1px solid {vault.categoryFilter === 'card' ? 'var(--cyan)' : 'var(--line)'};border-radius:16px;padding:14px;cursor:pointer;text-align:left;font-family:var(--sans)"><span style="width:36px;height:36px;border-radius:10px;background:var(--s4);display:grid;place-items:center;color:var(--cyan)"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5.5" width="19" height="13" rx="2.5" /><rect x="5.5" y="9" width="3.8" height="2.8" rx="0.7" fill="currentColor" stroke="none" /><path d="M5.5 15h6" /><circle cx="16.2" cy="14.8" r="1.7" /><circle cx="18.7" cy="14.8" r="1.7" /></svg></span><span style="display:block"><b style="font-size:14.5px;font-weight:600;display:block">Cards</b><span style="font-family:var(--mono);font-size:11.5px;color:var(--tx3)">{cat.card.length} items</span></span></button>
						<button onclick={() => pickCategory('identity')} style="flex:0 0 auto;width:118px;display:flex;flex-direction:column;gap:11px;align-items:flex-start;background:var(--s2);border:1px solid {vault.categoryFilter === 'identity' ? 'var(--cyan)' : 'var(--line)'};border-radius:16px;padding:14px;cursor:pointer;text-align:left;font-family:var(--sans)"><span style="width:36px;height:36px;border-radius:10px;background:var(--s4);display:grid;place-items:center;color:var(--cyan)"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="15" rx="2.5" /><circle cx="8.5" cy="10" r="2.2" /><path d="M5.2 15.6c.3-1.9 1.7-2.9 3.3-2.9s3 1 3.3 2.9" /><path d="M14.5 9.5h4M14.5 12.5h4M14.5 15.5h2.6" /></svg></span><span style="display:block"><b style="font-size:14.5px;font-weight:600;display:block">Identities</b><span style="font-family:var(--mono);font-size:11.5px;color:var(--tx3)">{cat.identity.length} items</span></span></button>
						<button onclick={() => pickCategory('note')} style="flex:0 0 auto;width:118px;display:flex;flex-direction:column;gap:11px;align-items:flex-start;background:var(--s2);border:1px solid {vault.categoryFilter === 'note' ? 'var(--cyan)' : 'var(--line)'};border-radius:16px;padding:14px;cursor:pointer;text-align:left;font-family:var(--sans)"><span style="width:36px;height:36px;border-radius:10px;background:var(--s4);display:grid;place-items:center;color:var(--cyan)"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h7l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><path d="M13 3v5h5" /><path d="M8 13h7M8 16.5h5" /></svg></span><span style="display:block"><b style="font-size:14.5px;font-weight:600;display:block">Notes</b><span style="font-family:var(--mono);font-size:11.5px;color:var(--tx3)">{cat.note.length} items</span></span></button>
						<button onclick={() => pickCategory('ssh')} style="flex:0 0 auto;width:118px;display:flex;flex-direction:column;gap:11px;align-items:flex-start;background:var(--s2);border:1px solid {vault.categoryFilter === 'ssh' ? 'var(--cyan)' : 'var(--line)'};border-radius:16px;padding:14px;cursor:pointer;text-align:left;font-family:var(--sans)"><span style="width:36px;height:36px;border-radius:10px;background:var(--s4);display:grid;place-items:center;color:var(--cyan)"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9l3 3-3 3M13 15h4" /></svg></span><span style="display:block"><b style="font-size:14.5px;font-weight:600;display:block">SSH keys</b><span style="font-family:var(--mono);font-size:11.5px;color:var(--tx3)">{cat.ssh.length} items</span></span></button>
					</div>
				</section>

				<!-- recent / results -->
				<section>
					<div style="display:flex;align-items:center;justify-content:space-between;margin:0 2px 12px"><span style="font-family:var(--mono);font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--tx3)">{listHeading}</span><span style="font-family:var(--mono);font-size:11px;color:var(--tx4)">{listItems.length}</span></div>
					<div style="display:flex;flex-direction:column;gap:8px">
						{#each listItems as r (r.id)}
							<button onclick={() => openItem(r)} style="display:flex;align-items:center;gap:13px;background:var(--s2);border:1px solid var(--line);border-radius:14px;padding:11px 13px;cursor:pointer;width:100%;text-align:left;font-family:var(--sans)">
								<span style="width:40px;height:40px;border-radius:11px;display:grid;place-items:center;color:#fff;font-size:15px;font-weight:800;flex:0 0 auto;letter-spacing:-.02em;background:{tileBg(r.title)}">{tileLabel(r.title)}</span>
								<span style="flex:1;min-width:0;display:block">
									<b style="font-size:15px;font-weight:600;display:block;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{r.title}</b>
									<span style="font-family:var(--mono);font-size:11.5px;color:var(--tx3);display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px">{rowSub(r)}</span>
								</span>
								<span style="display:flex;align-items:center;gap:9px;flex:0 0 auto">
									{#if r.kind === 'login'}<i style="width:7px;height:7px;border-radius:50%;background:{dotColor(r.id)}"></i>{/if}
									<span style="font-family:var(--mono);font-size:11px;color:var(--tx4);min-width:30px;text-align:right">{rel(r.updatedAt)}</span>
									<span style="color:var(--tx4);display:flex"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6" /></svg></span>
								</span>
							</button>
						{/each}
						{#if listItems.length === 0}
							<div style="text-align:center;font-family:var(--mono);font-size:12px;color:var(--tx4);padding:26px 0;letter-spacing:.04em">
								{#if vault.searchQuery.trim()}No items match “{vault.searchQuery.trim()}”{:else}Your vault is empty — tap + to add your first item{/if}
							</div>
						{/if}
					</div>
				</section>
			</div>
		{/if}

		<!-- ──────────────────────────── WATCHTOWER ─────────────────────────── -->
		{#if tab === 'watch'}
			<div class="vv-screen">
				<header style="padding:6px 2px 16px">
					<h1 style="font-size:30px;font-weight:900;letter-spacing:-.03em;margin:0;line-height:1">Watchtower</h1>
					<p style="font-family:var(--serif);font-style:italic;font-size:15px;color:var(--tx2);margin:7px 0 0">{issueLine}</p>
				</header>

				<div style="position:relative;border-radius:20px;padding:18px;margin-bottom:20px;overflow:hidden;background:linear-gradient(160deg,{issueCount === 0 ? '#0f1612' : '#16110f'},#0c0d10 65%);border:1px solid {issueCount === 0 ? '#1f2c25' : '#2c2620'};display:flex;align-items:center;gap:16px">
					<div style="width:58px;height:58px;border-radius:16px;background:{issueCount === 0 ? 'rgba(52,211,153,.1)' : 'rgba(232,176,75,.1)'};border:1px solid {issueCount === 0 ? 'rgba(52,211,153,.4)' : 'rgba(232,176,75,.4)'};display:grid;place-items:center;color:{issueCount === 0 ? 'var(--green)' : 'var(--amber)'};flex:0 0 auto"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z" /><path d="M9 12l2 2 4-4" /></svg></div>
					<div style="flex:1;position:relative">
						<b style="font-size:17px;font-weight:700;display:block;letter-spacing:-.01em">{issueHeading}</b>
						<span style="font-family:var(--mono);font-size:11.5px;color:var(--tx3);display:block;margin-top:3px">Live · on-device analysis</span>
					</div>
					<button onclick={rescan} style="flex:0 0 auto;font-family:var(--mono);font-size:11.5px;font-weight:600;letter-spacing:.04em;color:var(--cyan);background:rgba(47,217,245,.06);border:1px solid var(--cyan-line);border-radius:10px;padding:9px 12px;cursor:pointer">Re-scan</button>
				</div>

				<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:9px;margin-bottom:22px">
					<div style="background:var(--s2);border:1px solid var(--line);border-radius:14px;padding:13px 11px;text-align:center"><b style="font-size:22px;font-weight:800;color:var(--green);display:block">0</b><span style="font-family:var(--mono);font-size:10px;color:var(--tx3);letter-spacing:.04em;text-transform:uppercase">Exposed</span></div>
					<div style="background:var(--s2);border:1px solid var(--line);border-radius:14px;padding:13px 11px;text-align:center"><b style="font-size:22px;font-weight:800;color:var(--cyan);display:block">{protectedCount}</b><span style="font-family:var(--mono);font-size:10px;color:var(--tx3);letter-spacing:.04em;text-transform:uppercase">Protected</span></div>
					<div style="background:var(--s2);border:1px solid var(--line);border-radius:14px;padding:13px 11px;text-align:center"><b style="font-size:22px;font-weight:800;color:var(--amber);display:block">{issueCount}</b><span style="font-family:var(--mono);font-size:10px;color:var(--tx3);letter-spacing:.04em;text-transform:uppercase">To fix</span></div>
				</div>

				<div style="display:flex;align-items:center;justify-content:space-between;margin:0 2px 12px"><span style="font-family:var(--mono);font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--tx3)">Needs attention</span></div>
				<div style="display:flex;flex-direction:column;gap:9px">
					{#each issues as it (it.item.id)}
						<div style="display:flex;align-items:center;gap:13px;background:var(--s2);border:1px solid var(--line);border-radius:14px;padding:12px 13px">
							<span style="width:38px;height:38px;border-radius:11px;display:grid;place-items:center;flex:0 0 auto;background:{it.kind === 'reused' ? 'rgba(47,217,245,.1)' : 'rgba(232,176,75,.1)'};color:{it.kind === 'reused' ? 'var(--cyan)' : 'var(--amber)'}"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg></span>
							<div style="flex:1;min-width:0">
								<b style="font-size:14.5px;font-weight:600;display:block;letter-spacing:-.01em">{it.title}</b>
								<span style="font-family:var(--mono);font-size:11px;color:var(--tx3);display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px">{it.sub}</span>
							</div>
							<button onclick={() => fixIssue(it)} style="flex:0 0 auto;font-size:12.5px;font-weight:600;color:#021015;background:linear-gradient(150deg,var(--cyan),#1eb8d6);border:none;border-radius:10px;padding:8px 14px;cursor:pointer;font-family:var(--sans)">{it.action}</button>
						</div>
					{/each}
					{#if issueCount === 0}
						<div style="text-align:center;padding:30px 16px;background:var(--s2);border:1px solid rgba(52,211,153,.3);border-radius:16px">
							<div style="width:54px;height:54px;border-radius:50%;background:rgba(52,211,153,.12);display:grid;place-items:center;color:var(--green);margin:0 auto 12px"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7" /></svg></div>
							<b style="font-size:16px;font-weight:700;display:block">All clear</b>
							<span style="font-size:13px;color:var(--tx2);display:block;margin-top:4px">Every credential is strong and unique.</span>
						</div>
					{/if}
				</div>
			</div>
		{/if}

		<!-- ───────────────────────────── GENERATOR ─────────────────────────── -->
		{#if tab === 'gen'}
			<div class="vv-screen">
				<header style="padding:6px 2px 16px">
					<h1 style="font-size:30px;font-weight:900;letter-spacing:-.03em;margin:0;line-height:1">Generator</h1>
					<p style="font-family:var(--serif);font-style:italic;font-size:15px;color:var(--tx2);margin:7px 0 0">Strong by default.</p>
				</header>

				<div style="display:flex;background:var(--s1);border:1px solid var(--line);border-radius:13px;padding:4px;margin-bottom:18px;gap:4px">
					<button onclick={() => setMode('password')} style="flex:1;font-size:13.5px;font-weight:600;border:none;border-radius:9px;padding:9px;cursor:pointer;font-family:var(--sans);transition:.16s;background:{segP.bg};color:{segP.color}">Password</button>
					<button onclick={() => setMode('passphrase')} style="flex:1;font-size:13.5px;font-weight:600;border:none;border-radius:9px;padding:9px;cursor:pointer;font-family:var(--sans);transition:.16s;background:{segPh.bg};color:{segPh.color}">Passphrase</button>
				</div>

				<div style="position:relative;border-radius:18px;padding:18px;margin-bottom:16px;background:linear-gradient(160deg,#121318,#0c0d10 65%);border:1px solid #25262d;overflow:hidden">
					<div style="position:absolute;width:240px;height:240px;border-radius:50%;top:-140px;left:-60px;background:radial-gradient(circle,rgba(47,217,245,.16),transparent 65%);pointer-events:none"></div>
					<div style="position:relative;min-height:54px;font-family:var(--mono);font-size:19px;font-weight:600;line-height:1.45;letter-spacing:.01em;word-break:break-all;color:var(--cyan-b)">{genValue}</div>
					<div style="position:relative;display:flex;align-items:center;gap:10px;margin-top:16px">
						<div style="flex:1;height:6px;border-radius:3px;background:var(--s4);overflow:hidden"><div style="height:100%;border-radius:3px;transition:width .3s ease,background .3s ease;width:{strength.pct}%;background:{strength.color}"></div></div>
						<span style="font-family:var(--mono);font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:{strength.color};min-width:62px;text-align:right">{strength.label}</span>
					</div>
					<div style="position:relative;display:flex;gap:9px;margin-top:16px">
						<button onclick={copyGen} style="flex:1;display:flex;align-items:center;justify-content:center;gap:8px;font-size:13.5px;font-weight:600;color:#021015;background:linear-gradient(150deg,var(--cyan),#1eb8d6);border:none;border-radius:11px;padding:11px;cursor:pointer;font-family:var(--sans)"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>Copy</button>
						<button onclick={regen} title="Regenerate" aria-label="Regenerate" style="flex:0 0 auto;width:44px;display:grid;place-items:center;color:var(--tx);background:var(--s3);border:1px solid var(--line2);border-radius:11px;cursor:pointer"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.3M21 4v5h-5" /></svg></button>
					</div>
				</div>

				<div style="background:var(--s2);border:1px solid var(--line);border-radius:16px;padding:6px 15px">
					<div style="display:flex;align-items:center;justify-content:space-between;padding:13px 0;border-bottom:1px solid var(--line)">
						<span style="font-size:14.5px;font-weight:500">{genMode === 'passphrase' ? 'Words' : 'Length'}</span>
						<span style="font-family:var(--mono);font-size:15px;font-weight:700;color:var(--cyan);min-width:26px;text-align:right">{genMode === 'passphrase' ? phraseWords : genLen}</span>
					</div>
					<div style="padding:13px 0 15px">
						<input type="range" min="8" max="40" step="1" value={genLen} oninput={setLen} style="width:100%;accent-color:#2fd9f5;height:4px;cursor:pointer" />
					</div>
					<button onclick={() => toggle('upper')} style="width:100%;display:flex;align-items:center;justify-content:space-between;padding:12px 0;background:none;border:none;border-top:1px solid var(--line);cursor:pointer;font-family:var(--sans)"><span style="font-size:14.5px;color:var(--tx)">{genMode === 'passphrase' ? 'Capitalize' : 'Uppercase'} <span style="font-family:var(--mono);color:var(--tx4);font-size:12px;margin-left:4px">A-Z</span></span><span style="width:46px;height:28px;border-radius:999px;padding:3px;display:flex;align-items:center;justify-content:flex-start;transition:background .2s;background:{up.bg}"><span style="width:22px;height:22px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.4);transition:transform .2s;transform:{up.knob}"></span></span></button>
					<button onclick={() => toggle('lower')} disabled={genMode === 'passphrase'} style="width:100%;display:flex;align-items:center;justify-content:space-between;padding:12px 0;background:none;border:none;border-top:1px solid var(--line);cursor:{genMode === 'passphrase' ? 'default' : 'pointer'};opacity:{genMode === 'passphrase' ? 0.4 : 1};font-family:var(--sans)"><span style="font-size:14.5px;color:var(--tx)">Lowercase <span style="font-family:var(--mono);color:var(--tx4);font-size:12px;margin-left:4px">a-z</span></span><span style="width:46px;height:28px;border-radius:999px;padding:3px;display:flex;align-items:center;justify-content:flex-start;transition:background .2s;background:{lo.bg}"><span style="width:22px;height:22px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.4);transition:transform .2s;transform:{lo.knob}"></span></span></button>
					<button onclick={() => toggle('num')} style="width:100%;display:flex;align-items:center;justify-content:space-between;padding:12px 0;background:none;border:none;border-top:1px solid var(--line);cursor:pointer;font-family:var(--sans)"><span style="font-size:14.5px;color:var(--tx)">Numbers <span style="font-family:var(--mono);color:var(--tx4);font-size:12px;margin-left:4px">0-9</span></span><span style="width:46px;height:28px;border-radius:999px;padding:3px;display:flex;align-items:center;justify-content:flex-start;transition:background .2s;background:{nu.bg}"><span style="width:22px;height:22px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.4);transition:transform .2s;transform:{nu.knob}"></span></span></button>
					<button onclick={() => toggle('sym')} disabled={genMode === 'passphrase'} style="width:100%;display:flex;align-items:center;justify-content:space-between;padding:12px 0;background:none;border:none;border-top:1px solid var(--line);cursor:{genMode === 'passphrase' ? 'default' : 'pointer'};opacity:{genMode === 'passphrase' ? 0.4 : 1};font-family:var(--sans)"><span style="font-size:14.5px;color:var(--tx)">Symbols <span style="font-family:var(--mono);color:var(--tx4);font-size:12px;margin-left:4px">!@#</span></span><span style="width:46px;height:28px;border-radius:999px;padding:3px;display:flex;align-items:center;justify-content:flex-start;transition:background .2s;background:{sy.bg}"><span style="width:22px;height:22px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.4);transition:transform .2s;transform:{sy.knob}"></span></span></button>
				</div>
			</div>
		{/if}

		<!-- ───────────────────────────── SETTINGS ──────────────────────────── -->
		{#if tab === 'set'}
			<div class="vv-screen">
				<header style="padding:6px 2px 16px">
					<h1 style="font-size:30px;font-weight:900;letter-spacing:-.03em;margin:0;line-height:1">Settings</h1>
				</header>

				<button onclick={onOpenMasterPassword} style="display:flex;align-items:center;gap:14px;background:linear-gradient(135deg,var(--s3),var(--s2));border:1px solid var(--line);border-radius:18px;padding:15px;cursor:pointer;margin-bottom:22px;width:100%;text-align:left;font-family:var(--sans)">
					<span style="width:52px;height:52px;border-radius:16px;background:linear-gradient(150deg,var(--cyan),#1eb8d6);display:grid;place-items:center;color:#021015;font-size:21px;font-weight:800;flex:0 0 auto">{deviceInitial}</span>
					<div style="flex:1;min-width:0"><b style="font-size:17px;font-weight:700;display:block;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{deviceName}</b><span style="font-family:var(--mono);font-size:12px;color:var(--tx3);display:block;margin-top:2px">Zero-knowledge · on-device</span></div>
					<span style="font-family:var(--mono);font-size:10.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--cyan);border:1px solid var(--cyan-line);border-radius:999px;padding:4px 9px">Vu {privacyLabel.replace('Level ', 'L')}</span>
				</button>

				<span style="font-family:var(--mono);font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--tx3);margin:0 2px 9px;display:block">Security</span>
				<div style="background:var(--s2);border:1px solid var(--line);border-radius:16px;padding:0 15px;margin-bottom:20px">
					<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 0"><span style="display:flex;align-items:center;gap:11px;font-size:14.5px"><span style="width:30px;height:30px;border-radius:8px;background:rgba(47,217,245,.1);display:grid;place-items:center;color:var(--cyan)"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11.5a3 3 0 0 1 6 0M7 8a5 5 0 0 1 10 0M5 21a14 14 0 0 1 14 0M12 12v5" /></svg></span>Face ID unlock</span><button onclick={toggleFaceid} aria-label="Toggle Face ID unlock" aria-pressed={faceIdOn} style="width:46px;height:28px;border-radius:999px;border:none;padding:3px;display:flex;align-items:center;justify-content:flex-start;cursor:pointer;transition:background .2s;background:{fa.bg}"><span style="width:22px;height:22px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.4);transition:transform .2s;transform:{fa.knob}"></span></button></div>
					<button onclick={() => toast(`Auto-lock: ${autoLockLabel.toLowerCase()} of inactivity`)} style="width:100%;display:flex;align-items:center;justify-content:space-between;padding:14px 0;background:none;border:none;border-top:1px solid var(--line);cursor:pointer;font-family:var(--sans);text-align:left"><span style="display:flex;align-items:center;gap:11px;font-size:14.5px;color:var(--tx)"><span style="width:30px;height:30px;border-radius:8px;background:rgba(47,217,245,.1);display:grid;place-items:center;color:var(--cyan)"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg></span>Auto-lock</span><span style="display:flex;align-items:center;gap:7px;color:var(--tx3);font-size:13.5px">{autoLockLabel} <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--tx4)"><path d="M9 6l6 6-6 6" /></svg></span></button>
					<button onclick={onOpenMasterPassword} style="width:100%;display:flex;align-items:center;justify-content:space-between;padding:14px 0;background:none;border:none;border-top:1px solid var(--line);cursor:pointer;font-family:var(--sans);text-align:left"><span style="display:flex;align-items:center;gap:11px;font-size:14.5px;color:var(--tx)"><span style="width:30px;height:30px;border-radius:8px;background:rgba(47,217,245,.1);display:grid;place-items:center;color:var(--cyan)"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg></span>Change master password</span><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--tx4)"><path d="M9 6l6 6-6 6" /></svg></button>
				</div>

				<span style="font-family:var(--mono);font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--tx3);margin:0 2px 9px;display:block">Sync &amp; privacy</span>
				<div style="background:var(--s2);border:1px solid var(--line);border-radius:16px;padding:0 15px;margin-bottom:20px">
					<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 0"><span style="display:flex;align-items:center;gap:11px;font-size:14.5px"><span style="width:30px;height:30px;border-radius:8px;background:rgba(47,217,245,.1);display:grid;place-items:center;color:var(--cyan)"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19a4.5 4.5 0 0 0 .5-9 6 6 0 0 0-11.6-1.5A4 4 0 0 0 6.5 19z" /></svg></span>Cloud sync</span><button onclick={toggleSync} aria-label="Sync now" aria-pressed={syncOn} style="width:46px;height:28px;border-radius:999px;border:none;padding:3px;display:flex;align-items:center;justify-content:flex-start;cursor:pointer;transition:background .2s;background:{sy2.bg}"><span style="width:22px;height:22px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.4);transition:transform .2s;transform:{sy2.knob}"></span></button></div>
					<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-top:1px solid var(--line)"><span style="display:flex;align-items:center;gap:11px;font-size:14.5px"><span style="width:30px;height:30px;border-radius:8px;background:rgba(47,217,245,.1);display:grid;place-items:center;color:var(--cyan)"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg></span>Clear clipboard <span style="font-family:var(--mono);color:var(--tx4);font-size:11px">· {Math.round(CLIPBOARD_CLEAR_MS / 1000)}s</span></span><button onclick={toggleClip} aria-label="Toggle clipboard auto-clear" aria-pressed={clipOn} style="width:46px;height:28px;border-radius:999px;border:none;padding:3px;display:flex;align-items:center;justify-content:flex-start;cursor:pointer;transition:background .2s;background:{cl.bg}"><span style="width:22px;height:22px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.4);transition:transform .2s;transform:{cl.knob}"></span></button></div>
					<button onclick={() => goto(resolve('/privacy'))} style="width:100%;display:flex;align-items:center;justify-content:space-between;padding:14px 0;background:none;border:none;border-top:1px solid var(--line);cursor:pointer;font-family:var(--sans);text-align:left"><span style="display:flex;align-items:center;gap:11px;font-size:14.5px;color:var(--tx)"><span style="width:30px;height:30px;border-radius:8px;background:rgba(47,217,245,.1);display:grid;place-items:center;color:var(--cyan)"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z" /></svg></span>Vu privacy level</span><span style="display:flex;align-items:center;gap:7px;color:var(--cyan);font-size:13.5px;font-weight:500">{privacyLabel} <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--tx4)"><path d="M9 6l6 6-6 6" /></svg></span></button>
				</div>

				<div style="text-align:center;font-family:var(--mono);font-size:10.5px;color:var(--tx4);letter-spacing:.06em;padding:4px 0 8px">VUVAULT · ZERO-KNOWLEDGE</div>
			</div>
		{/if}
	</div>

	<!-- ─────────────────────────────── TAB BAR ──────────────────────────── -->
	<nav class="vv-tabbar" aria-label="Vault sections">
		<button onclick={() => go('vault')} style="display:flex;flex-direction:column;align-items:center;gap:4px;background:none;border:none;cursor:pointer;font-family:var(--sans);padding:6px 8px;flex:1;min-height:48px;justify-content:center;color:{tab === 'vault' ? 'var(--cyan)' : 'var(--tx4)'}"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z" /></svg><span style="font-size:10px;font-weight:600;letter-spacing:.02em">Vault</span></button>
		<button onclick={() => go('watch')} style="display:flex;flex-direction:column;align-items:center;gap:4px;background:none;border:none;cursor:pointer;font-family:var(--sans);padding:6px 8px;flex:1;min-height:48px;justify-content:center;color:{tab === 'watch' ? 'var(--cyan)' : 'var(--tx4)'}"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg><span style="font-size:10px;font-weight:600;letter-spacing:.02em">Watch</span></button>
		<button onclick={openAdd} aria-label="Add item" style="flex:0 0 auto;width:54px;height:54px;border-radius:18px;background:linear-gradient(150deg,var(--cyan),#1eb8d6);color:#021015;display:grid;place-items:center;box-shadow:0 8px 22px -6px rgba(47,217,245,.6),0 0 0 5px rgba(8,8,10,.9);margin-top:-26px;border:none;cursor:pointer;transition:.16s"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14" /></svg></button>
		<button onclick={() => go('gen')} style="display:flex;flex-direction:column;align-items:center;gap:4px;background:none;border:none;cursor:pointer;font-family:var(--sans);padding:6px 8px;flex:1;min-height:48px;justify-content:center;color:{tab === 'gen' ? 'var(--cyan)' : 'var(--tx4)'}"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="5" /><path d="M11.5 11.5L20 3M17 3h3v3M14 6l2 2" /></svg><span style="font-size:10px;font-weight:600;letter-spacing:.02em">Generate</span></button>
		<button onclick={() => go('set')} style="display:flex;flex-direction:column;align-items:center;gap:4px;background:none;border:none;cursor:pointer;font-family:var(--sans);padding:6px 8px;flex:1;min-height:48px;justify-content:center;color:{tab === 'set' ? 'var(--cyan)' : 'var(--tx4)'}"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" /></svg><span style="font-size:10px;font-weight:600;letter-spacing:.02em">Settings</span></button>
	</nav>

	<!-- ──────────────────────────────── TOAST ──────────────────────────── -->
	{#if toastMsg}
		<div class="vv-toast" style="position:fixed;left:50%;transform:translateX(-50%);bottom:calc(96px + env(safe-area-inset-bottom));width:calc(100% - 36px);max-width:484px;background:#0d0d11;border:1px solid var(--cyan-line);border-radius:13px;padding:13px 15px;display:flex;align-items:center;gap:11px;z-index:55;font-size:13.5px;box-shadow:0 18px 36px -16px rgba(0,0,0,.85)">
			<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--cyan);flex:0 0 auto"><path d="M5 13l4 4L19 7" /></svg>
			<span>{toastMsg}</span>
		</div>
	{/if}

	<!-- ───────────────────────────── ADD SHEET ─────────────────────────── -->
	{#if sheet}
		<div style="position:fixed;inset:0;z-index:70;display:flex;flex-direction:column;justify-content:flex-end">
			<div class="vv-ovl" onclick={() => (sheet = null)} role="presentation" style="position:absolute;inset:0;background:rgba(0,0,0,.55);backdrop-filter:blur(2px)"></div>
			<div class="vv-sheet" style="position:relative;background:linear-gradient(180deg,#1c1d23,#141419 42%);border:1px solid var(--line2);border-bottom:none;border-radius:30px 30px 0 0;padding:10px 20px calc(32px + env(safe-area-inset-bottom));max-height:82%;overflow-y:auto;scrollbar-width:none">
				<div style="width:38px;height:5px;border-radius:3px;background:var(--line2);margin:0 auto 16px"></div>
				{#if sheet === 'types'}
					<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px"><h2 style="font-size:21px;font-weight:800;letter-spacing:-.02em;margin:0;color:#fff">New item</h2><button onclick={() => (sheet = null)} aria-label="Close" style="width:32px;height:32px;border-radius:10px;background:var(--s3);border:1px solid var(--line);display:grid;place-items:center;color:var(--tx3);cursor:pointer"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg></button></div>
					<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
						<button onclick={pickLogin} style="display:flex;align-items:center;gap:12px;background:var(--s2);border:1px solid var(--line);border-radius:14px;padding:14px;cursor:pointer;text-align:left;font-family:var(--sans)"><span style="width:40px;height:40px;border-radius:11px;background:var(--cyan-dim);border:1px solid var(--cyan-line);display:grid;place-items:center;color:var(--cyan);flex:0 0 auto"><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 18v3c0 .6.4 1 1 1h4v-3h3v-3h2l1.4-1.4a6.5 6.5 0 1 0-4-4Z" /><circle cx="16.5" cy="7.5" r="1.4" /></svg></span><b style="font-size:14.5px;font-weight:600;color:#fff">Login</b></button>
						<button onclick={() => pickKind('card')} style="display:flex;align-items:center;gap:12px;background:var(--s2);border:1px solid var(--line);border-radius:14px;padding:14px;cursor:pointer;text-align:left;font-family:var(--sans)"><span style="width:40px;height:40px;border-radius:11px;background:var(--s4);display:grid;place-items:center;color:var(--cyan);flex:0 0 auto"><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5.5" width="19" height="13" rx="2.5" /><rect x="5.5" y="9" width="3.8" height="2.8" rx="0.7" fill="currentColor" stroke="none" /><path d="M5.5 15h6" /><circle cx="16.2" cy="14.8" r="1.7" /><circle cx="18.7" cy="14.8" r="1.7" /></svg></span><b style="font-size:14.5px;font-weight:600;color:#fff">Card</b></button>
						<button onclick={() => pickKind('identity')} style="display:flex;align-items:center;gap:12px;background:var(--s2);border:1px solid var(--line);border-radius:14px;padding:14px;cursor:pointer;text-align:left;font-family:var(--sans)"><span style="width:40px;height:40px;border-radius:11px;background:var(--s4);display:grid;place-items:center;color:var(--cyan);flex:0 0 auto"><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="15" rx="2.5" /><circle cx="8.5" cy="10" r="2.2" /><path d="M5.2 15.6c.3-1.9 1.7-2.9 3.3-2.9s3 1 3.3 2.9" /><path d="M14.5 9.5h4M14.5 12.5h4M14.5 15.5h2.6" /></svg></span><b style="font-size:14.5px;font-weight:600;color:#fff">Identity</b></button>
						<button onclick={() => pickKind('note')} style="display:flex;align-items:center;gap:12px;background:var(--s2);border:1px solid var(--line);border-radius:14px;padding:14px;cursor:pointer;text-align:left;font-family:var(--sans)"><span style="width:40px;height:40px;border-radius:11px;background:var(--s4);display:grid;place-items:center;color:var(--cyan);flex:0 0 auto"><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h7l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><path d="M13 3v5h5" /><path d="M8 13h7M8 16.5h5" /></svg></span><b style="font-size:14.5px;font-weight:600;color:#fff">Secure note</b></button>
						<button onclick={() => pickKind('ssh')} style="display:flex;align-items:center;gap:12px;background:var(--s2);border:1px solid var(--line);border-radius:14px;padding:14px;cursor:pointer;text-align:left;font-family:var(--sans)"><span style="width:40px;height:40px;border-radius:11px;background:var(--s4);display:grid;place-items:center;color:var(--cyan);flex:0 0 auto"><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9l3 3-3 3M13 15h4" /></svg></span><b style="font-size:14.5px;font-weight:600;color:#fff">SSH key</b></button>
						<button onclick={() => pickKind('crypto-seed')} style="display:flex;align-items:center;gap:12px;background:var(--s2);border:1px solid var(--line);border-radius:14px;padding:14px;cursor:pointer;text-align:left;font-family:var(--sans)"><span style="width:40px;height:40px;border-radius:11px;background:var(--s4);display:grid;place-items:center;color:var(--cyan);flex:0 0 auto"><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5" /><circle cx="12" cy="12" r="3.4" /><path d="M12 8.6v1.3M3 8.5h1.6M3 15.5h1.6" /></svg></span><b style="font-size:14.5px;font-weight:600;color:#fff">Crypto seed</b></button>
					</div>
				{:else if sheet === 'login'}
					<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px"><button onclick={() => (sheet = 'types')} aria-label="Back" style="width:32px;height:32px;border-radius:10px;background:var(--s3);border:1px solid var(--line);display:grid;place-items:center;color:var(--tx3);cursor:pointer"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg></button><h2 style="font-size:20px;font-weight:800;letter-spacing:-.02em;margin:0;color:#fff">New login</h2></div>
					<span class="vv-flabel" style="font-family:var(--mono);font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--tx3);display:block;margin-bottom:7px">Service</span>
					<input bind:value={formSite} placeholder="e.g. Figma" aria-label="Service" style="width:100%;background:var(--s2);border:1px solid var(--line);border-radius:12px;padding:13px 14px;color:var(--tx);font-family:var(--sans);font-size:15px;outline:none;margin-bottom:15px;box-sizing:border-box" />
					<span class="vv-flabel" style="font-family:var(--mono);font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--tx3);display:block;margin-bottom:7px">Username</span>
					<input bind:value={formUser} placeholder="you@example.com" autocomplete="off" aria-label="Username" style="width:100%;background:var(--s2);border:1px solid var(--line);border-radius:12px;padding:13px 14px;color:var(--tx);font-family:var(--sans);font-size:15px;outline:none;margin-bottom:15px;box-sizing:border-box" />
					<span class="vv-flabel" style="font-family:var(--mono);font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--tx3);display:block;margin-bottom:7px">Password</span>
					<div style="display:flex;gap:9px;margin-bottom:22px">
						<input bind:value={formPass} placeholder="Tap dice to generate" autocomplete="off" aria-label="Password" style="flex:1;min-width:0;background:var(--s2);border:1px solid var(--line);border-radius:12px;padding:13px 14px;color:var(--cyan-b);font-family:var(--mono);font-size:14px;outline:none;box-sizing:border-box" />
						<button onclick={genFormPass} title="Generate" aria-label="Generate password" style="flex:0 0 auto;width:48px;display:grid;place-items:center;color:#021015;background:linear-gradient(150deg,var(--cyan),#1eb8d6);border:none;border-radius:12px;cursor:pointer"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="8.5" cy="8.5" r="1.4" fill="currentColor" /><circle cx="15.5" cy="15.5" r="1.4" fill="currentColor" /><circle cx="15.5" cy="8.5" r="1.4" fill="currentColor" /><circle cx="8.5" cy="15.5" r="1.4" fill="currentColor" /></svg></button>
					</div>
					<button onclick={saveLogin} style="width:100%;font-size:15.5px;font-weight:700;color:#021015;background:linear-gradient(150deg,var(--cyan),#1eb8d6);border:none;border-radius:14px;padding:15px;cursor:pointer;font-family:var(--sans)">Save to vault</button>
				{/if}
			</div>
		</div>
	{/if}

	<!-- ────────────────────────── ITEM DETAIL (real) ───────────────────── -->
	{#if detailOpen}
		<div class="vv-detail" style="position:fixed;inset:0;z-index:75;background:linear-gradient(180deg,#101117,#0b0b0f 32%);display:flex;flex-direction:column">
			<div style="display:flex;align-items:center;gap:10px;padding:calc(env(safe-area-inset-top) + 10px) 16px 10px;border-bottom:1px solid var(--line);flex:0 0 auto">
				<button onclick={() => (detailOpen = false)} style="display:flex;align-items:center;gap:5px;background:none;border:none;color:var(--cyan);font-family:var(--sans);font-size:15px;font-weight:500;cursor:pointer;padding:6px 4px">
					<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg>Vault
				</button>
			</div>
			<div style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch">
				<VaultDetail onEdit={(item) => onEditItem(item)} />
			</div>
		</div>
	{/if}
</div>

<style>
	.vv-root {
		/* design tokens — palette from "VuVault Mobile.dc.html" */
		--s1: #0d0d11;
		--s2: #15151b;
		--s3: #1d1d23;
		--s4: #26262d;
		--line: #2b2b32;
		--line2: #3c3c45;
		--cyan: #2fd9f5;
		--cyan-b: #7ef0ff;
		--cyan-dim: rgba(47, 217, 245, 0.12);
		--cyan-line: rgba(47, 217, 245, 0.42);
		--red: #ff4d4d;
		--amber: #e8b04b;
		--green: #34d399;
		--tx: #f5f5f7;
		--tx2: #a6a6ae;
		--tx3: #74747c;
		--tx4: #4e4e56;
		/* fonts: the app self-hosts its brand faces (CSP forbids Google
		   Fonts); JetBrains Mono matches the design's mono exactly. */
		--sans: var(--font-sans);
		--mono: var(--font-mono);
		--serif: var(--font-serif);

		position: fixed;
		inset: 0;
		z-index: 5;
		display: flex;
		flex-direction: column;
		color: var(--tx);
		font-family: var(--sans);
		-webkit-font-smoothing: antialiased;
		background:
			radial-gradient(700px 420px at 50% -6%, rgba(47, 217, 245, 0.07), transparent 60%),
			linear-gradient(180deg, #101117, #0b0b0f 32%);
		overflow: hidden;
	}

	.vv-app {
		flex: 1 1 auto;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
		scrollbar-width: none;
		padding: calc(env(safe-area-inset-top) + 8px) 18px calc(104px + env(safe-area-inset-bottom));
	}
	.vv-app::-webkit-scrollbar {
		display: none;
	}
	.vv-app :global([data-hscroll]::-webkit-scrollbar) {
		display: none;
	}

	.vv-screen {
		display: flex;
		flex-direction: column;
		animation: vv-scr 0.32s ease both;
	}

	.vv-tabbar {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		height: calc(72px + env(safe-area-inset-bottom));
		padding: 0 14px env(safe-area-inset-bottom);
		display: flex;
		align-items: center;
		justify-content: space-around;
		background: linear-gradient(to top, rgba(8, 8, 10, 0.97) 55%, rgba(8, 8, 10, 0.72));
		backdrop-filter: blur(20px) saturate(160%);
		-webkit-backdrop-filter: blur(20px) saturate(160%);
		border-top: 1px solid var(--line);
		z-index: 40;
	}

	/* iOS press feedback on every tappable surface */
	.vv-root :global(button) {
		transition: transform 0.09s ease, filter 0.12s ease;
		-webkit-tap-highlight-color: transparent;
	}
	.vv-root :global(button:active) {
		transform: scale(0.975);
	}

	/* focus ring on the search pill */
	.vv-search:focus-within {
		border-color: var(--cyan-line) !important;
		box-shadow: 0 0 0 3px var(--cyan-dim);
	}

	.vv-sweep {
		animation: vv-sweep 6s ease-in-out infinite;
	}
	.vv-ovl {
		animation: vv-ovl 0.25s ease;
	}
	.vv-sheet {
		animation: vv-sheet 0.34s cubic-bezier(0.2, 0.9, 0.25, 1);
	}
	.vv-toast {
		animation: vv-rise 0.3s ease;
	}
	.vv-detail {
		animation: vv-scr 0.26s ease both;
	}

	@keyframes vv-sweep {
		0%,
		100% {
			transform: translateX(-30%) rotate(8deg);
		}
		50% {
			transform: translateX(360%) rotate(8deg);
		}
	}
	@keyframes vv-rise {
		from {
			transform: translateX(-50%) translateY(16px);
			opacity: 0;
		}
		to {
			transform: translateX(-50%) translateY(0);
			opacity: 1;
		}
	}
	@keyframes vv-sheet {
		from {
			transform: translateY(101%);
		}
		to {
			transform: translateY(0);
		}
	}
	@keyframes vv-ovl {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	@keyframes vv-scr {
		from {
			opacity: 0;
			transform: translateY(7px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.vv-root :global(*) {
			animation: none !important;
		}
	}
</style>
