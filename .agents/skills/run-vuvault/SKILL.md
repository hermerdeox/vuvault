---
name: run-vuvault
description: Launch and drive the VuVault SvelteKit PWA locally — dev server on 5173, or the wrangler Pages build on 8788 when you need the real D1/R2 API. Use when asked to run, start, screenshot, or manually verify VuVault in a real browser (onboarding, unlock, vault, recovery), rather than only running tests.
---

# Running VuVault

Browser-only zero-knowledge vault. Everything that touches plaintext runs
in the page, so "run it" always means **a real browser against a dev
server** — `curl` only ever proves the shell loaded, because `/onboarding`,
`/unlock`, `/recover` and `/vault` are all `ssr=false`.

Two modes. Pick the smaller one that answers the question.

| Mode | Port | Gets you | Use when |
|---|---|---|---|
| **A. Vite dev** | 5173 | Full client. Demo auth on. No API, no D1/R2. | Almost always — UI, onboarding, recovery, vault |
| **B. Wrangler Pages** | 8788 | Real `/api/*`, D1, R2, OPAQUE | Sync, blobs, OPAQUE, anything server-side |

## Mode A — dev server

```bash
npm run dev -- --port 5173     # background it
for i in $(seq 1 30); do curl -sf http://localhost:5173/ >/dev/null && break; sleep 1; done
```

Stop with `lsof -ti:5173 -sTCP:LISTEN | xargs -r kill`. Don't `pkill -f vite`
— it can match the agent's own command line.

## Mode B — wrangler, with the API

```bash
npm run dev:api > dev-api.log 2>&1 &     # build + migrate + seed + serve on 8788
for i in $(seq 1 120); do curl -fsS http://localhost:8788/api/capabilities >/dev/null && break; sleep 1; done
```

`scripts/dev-api.mjs` mirrors the CI `m3 d1/r2 sync e2e` job. What it
handles that a hand-rolled `wrangler pages dev` gets wrong:

- **`.dev.vars` needs `AKD_SIGNING_KEY_HEX`.** It is the root for the
  anonymous-token keys; without it `/api/v0/tokens/issue` answers 503 and
  every v2 sync call fails. The script creates `.dev.vars` from
  `.dev.vars.example` with a fresh random key when it is missing.
- **The `PUBLIC_*` values must reach the serve, not just the build.** The
  client reads them through `$env/dynamic/public`, which wrangler resolves
  when it serves; build-time env alone ships a client with no sync origin
  and onboarding fails with "Registration failed". The script passes them
  to both (`--binding` at serve). Check with
  `curl -s http://localhost:8788/_app/env.js`.
- **`OPAQUE_SERVER_ID` must be `vuvault.app`.** The client derives its
  server id from `getRpId()`; the top-level `wrangler.toml` value is
  `preview.vuvault.app`, and the mismatch fails the OPAQUE AKE MAC verify
  at login with a misleading error.

`PUBLIC_M3_E2E_AUTH=true` (the script's default) swaps WebAuthn for a
deterministic PRF shim — the only way to exercise **production** auth mode
headlessly. `PUBLIC_M3_E2E_AUTH=false npm run dev:api` uses a real passkey.

The build rewrites the tracked `.bundle-digest`; revert it if you did not
mean to change the bundle. Stop with
`lsof -ti:8788 -sTCP:LISTEN | xargs -r kill`.

## Driving it

`chromium-cli` is **not** installed here. Use the Playwright that ships as a
project devDependency — and **write the driver inside the repo**, because a
script in a scratch directory cannot resolve `@playwright/test`:

```bash
cat > ./__tmp_drive.mjs <<'EOF'
import { chromium } from '@playwright/test';   // NOT 'playwright'
...
EOF
node ./__tmp_drive.mjs; rm -f ./__tmp_drive.mjs
```

Delete it afterwards — the repo root is otherwise clean and CI greps it.

**Always wait on the project's hydration marker.** Every guard and store
reads from IndexedDB after mount, so acting earlier races them:

```js
const hyd = () => page.waitForFunction(
  () => document.documentElement.dataset.hydrated === 'true',
  undefined, { timeout: 15000 }
);
```

Prefer `tests/e2e/helpers.ts` (`completeDemoOnboarding`, `clearStorage`) and
`_helpers.ts` (`waitForHydration`) over re-deriving selectors — they are
maintained with the UI.

## Getting past the route guards

`/vault` redirects to `/unlock`, and `/unlock` to `/onboarding`, when there
is no local account. A fresh browser profile has none, so **almost every
interesting screen needs onboarding run first.** Demo mode is the only path
without a real authenticator, and it exists only because `dev` sets
`isDemoAuthEnabled()`.

Six steps, in this exact order (welcome → identity → secret → recovery →
touch → provision):

```js
await page.goto(BASE + '/onboarding'); await hyd();
await page.getByRole('button', { name: 'Begin setup' }).click();
await page.locator('input[type="text"]').first().fill('Recon Mac');
await page.getByRole('button', { name: 'Continue', exact: true }).click();
await page.waitForTimeout(400);

// Capture the Secret Key HERE — it is shown once and never re-revealed.
const sk = (await page.locator('.secret-value .grp').allInnerTexts()).join(' ').trim();

await page.locator('input[type="checkbox"]').first().check();
await page.getByRole('button', { name: 'Continue', exact: true }).click();
const RP = 'Jasper! Maple! Lantern! Orchid!';   // passes the ≥16-char, ~80-bit policy
await page.getByLabel('Recovery Password', { exact: true }).fill(RP);
await page.getByLabel('Confirm Recovery Password').fill(RP);
await page.getByLabel(/I have saved this Recovery Password separately/).check();
await page.getByRole('button', { name: 'Continue', exact: true }).click();
await page.getByRole('button', { name: 'Use demo mode' }).click();
await page.getByRole('button', { name: 'Continue in demo mode' }).click();
await page.getByRole('button', { name: 'Continue', exact: true }).click();
await page.getByRole('button', { name: 'Enter your vault' })
  .waitFor({ state: 'visible', timeout: 30000 });        // provisioning is slow
await page.getByRole('button', { name: 'Enter your vault' }).click();
await page.waitForURL(/\/vault/, { timeout: 20000 });
```

There is **no way to re-read the Secret Key after onboarding** — no reveal,
no re-export without retyping it. Grab it during step 3 or restart.

## Driving the recovery flow

`/recover` has no route guard and renders standalone, but the options gate on
local state:

- Fresh profile → "Lost my passkey" is **disabled**, badged
  `NO ACCOUNT ON THIS DEVICE`. Onboard first.
- "Restore from sync" and "Threshold recovery (FROST)" are permanently
  disabled — genuinely not implemented, not a launch failure.

```js
await page.goto(BASE + '/recover'); await hyd();
await page.getByText('Lost my passkey', { exact: true }).first().click();
await page.locator('textarea').first().fill(sk);
await page.locator('input[type="password"]').first().fill(RP);
await page.getByRole('button', { name: /recover \+ re-bind/i }).first().click();
await page.waitForTimeout(9000);          // Argon2id at 256 MiB: seconds, not ms
```

**A correct password parks the button on "Registering passkey…" and never
finishes.** That is success, not a hang: the envelope opened and it moved on
to a WebAuthn ceremony headless Chromium cannot satisfy. To assert the
envelope itself, check that no `[role=alert]` appeared. To see the failure
path instead, submit a wrong password and read the alert.

## Gotchas

- **No `timeout(1)` on macOS.** It is GNU coreutils; the bare `timeout 30
  bash -c ...` idiom from the generic run guidance dies with `command not
  found` here. Poll with `for i in $(seq 1 30); do ... && break; sleep 1; done`.
- **Argon2id dominates every timing.** Provisioning, unlock with a master
  password, and recovery each burn 2–3 s at the 256 MiB preset. Generous
  `waitFor` timeouts; never a bare `sleep`.
- **Auto-lock fires at 5 min idle and 30 s hidden.** A long scripted session
  or a backgrounded tab locks the vault mid-run and bounces to `/unlock`.
- **Vite logs a wall of `css_unused_selector` warnings on boot.** Cosmetic —
  it is not a failed start.
- **`prefers-reduced-motion` is not needed**; the shell is usable immediately
  after `data-hydrated`.
- **Check `page.on('console')` for errors before declaring success.** The
  shell renders happily while a store throws underneath.
- **Screenshot, then look at it.** The two themes are switched by
  `[data-theme]` on the root; a blank dark frame and a failure to hydrate
  look identical in the DOM.
