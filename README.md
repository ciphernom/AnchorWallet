# Anchor — PWA Bitcoin Wallet (MVP)

## Run
```bash
# any static server will do
npx http-server . -p 5173 --cors
# then open http://localhost:5173
```
The PWA will register a service worker (`/sw.js`).

## Files
- `index.html` — UI and screens
- `js/crypto.js` — mnemonic, Anchor File encryption (AES-GCM + PBKDF2), derivation
- `js/mempool.js` — minimal wrappers for mempool.space
- `js/tx.js` — tx build/sign via bitcoinjs-lib (P2WPKH)
- `js/qr.js` — QR generate/scan
- `sw.js` — basic cache; no signed updates (cut for MVP)
- `manifest.json` — PWA metadata

## Notes
- For privacy, consider swapping mempool.space for your own Esplora instance later.
- This MVP uses a trivial change strategy and a small scan window. It's good enough to move funds; avoid complex coin control.
- Keep your **Anchor File** and password separate; write down the seed on paper, offline.

