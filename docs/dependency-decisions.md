# Dependency decisions

Why certain versions are pinned where they are. Reviewed 2026-08-05.

Run `npm audit` and you will see **2 high findings against react-router**. That is
expected and explained below. Everything else is clean.

## SheetJS (`xlsx`) — installed from the vendor tarball, not npm

```
"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
```

The `xlsx` package on the public npm registry is frozen at 0.18.5, which carries a
prototype-pollution advisory (CVE-2023-30533) and a ReDoS (CVE-2024-22363). SheetJS
publishes fixes only to their own CDN. This is the vendor's documented install path.

It is an **install-time** fetch. Vite bundles the result, so nothing is fetched at
runtime and the air-gapped guarantee is unaffected. A build machine does need to reach
`cdn.sheetjs.com` once.

## jsPDF — 4.2.1, not the 2.5.1 the previous tool used

The tool being replaced pins jsPDF 2.5.1, and the original intent was to match it so
behaviour stayed comparable. That turned out to be untenable: 2.5.1 carries a **critical**
ReDoS and DoS pair, and drags in a `dompurify` with an XSS advisory.

There was never a compatibility argument for staying on 2.5.1 anyway. Phase 1 rebuilds
PDF export against the spec rather than porting the old export code, so the new code is
written against 4.2.1 from the start.

## react-router — 7.18.2, with a known advisory that is not reachable here

There is currently **no clean version of react-router**. Two advisories cover
overlapping-but-opposite ranges:

| Range | Advisories |
|---|---|
| 6.0.0 – 7.17.0 | XSS via open redirects; SSR XSS in `ScrollRestoration`; turbo-stream deserialization RCE |
| 7.12.0 – 8.2.0 | RSC-mode CSRF bypass: an action can execute before the 400 response |

`npm audit` suggests downgrading to 7.11.0. That trades one high finding for three, and
the open-redirect XSS in that set is plausibly reachable from a client-side router.

**We stay on 7.18.2.** Its single remaining advisory requires React Router's RSC mode —
React Server Components with server actions. ATLAS is a static SPA served from GitHub
Pages with no server, no SSR, no RSC, and no server actions. The vulnerable code path
does not exist in this deployment.

Revisit when react-router ships a release outside both ranges. If ATLAS ever gains a
backend (Phase 2) and adopts framework mode, this assessment expires and must be redone.

## Deliberately old pins that are clean

- **d3 7.8.5** — matches the version the previous tool vendored, so the ported force and
  radial layouts behave identically. No advisories.
- **html2canvas 1.4.1** — the latest release; the project is dormant. No advisories.

## What is not here

No CDN loads at runtime, by rule. Fonts come from `@fontsource` npm packages and are
fingerprinted into `dist/assets/` by Vite. The CI job greps the built output for remote
URLs and fails if any appear, because "works air-gapped" was previously claimed and
untrue, and a claim like that only counts if something enforces it.
