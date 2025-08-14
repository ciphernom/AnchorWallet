import { setMempoolNetwork, addrBalance, addrUtxos, addrTxids, broadcastTx } from './mempool.js';
import { generateMnemonic12, mnemonicToSeed, makeAnchorFile, openAnchorFile, deriveAccount, getNextReceive, zeroSecrets } from './crypto.js';
import { setNetwork as setTxNetwork, buildAndSignTx, validateAddress, satsToBtc, btcToSats } from './tx.js';
import { drawQr, startScan, stopScan } from './qr.js';

// ------- utilities -------
const $  = (sel) => document.querySelector(sel);
const on = (sel, ev, fn) => { const el = $(sel); if (el) el.addEventListener(ev, fn); };
const show = (id) => $(id).classList.remove('hidden');
const hide = (id) => $(id).classList.add('hidden');

// ------- state -------
let STATE = {
  network: 'mainnet',
  mnemonic: null,
  root: null,
  node: null,
  receiveIndex: 0,
};

// ------- network init + header toggle -------
{
  const q = new URLSearchParams(location.search);
  const net = q.get('net');
  if (net && ['mainnet','testnet','signet'].includes(net)) STATE.network = net;
  setMempoolNetwork(STATE.network);
  setTxNetwork(STATE.network);

  // Add a simple network toggle into the header
  const header = document.querySelector('header');
  if (header && !document.getElementById('net-select')) {
    const sel = document.createElement('select');
    sel.id = 'net-select';
    sel.innerHTML = `
      <option value="mainnet">Mainnet</option>
      <option value="testnet">Testnet</option>
      <option value="signet">Signet</option>`;
    sel.value = STATE.network;
    sel.style.cssText = 'margin-left:auto;background:#0b0f14;color:#e7f1ff;border:1px solid #1c2633;border-radius:8px;padding:6px 8px;';
    header.appendChild(sel);
    sel.addEventListener('change', async () => {
      const val = sel.value;
      if (!['mainnet','testnet','signet'].includes(val)) return;
      STATE.network = val;
      setMempoolNetwork(val);
      setTxNetwork(val);
      const p = new URLSearchParams(location.search); p.set('net', val);
      history.replaceState(null, '', location.pathname + '?' + p.toString());
      if (STATE.mnemonic) {
        const seed = await mnemonicToSeed(STATE.mnemonic);
        const { node } = await deriveAccount(seed, STATE.network);
        STATE.node = node;
        STATE.receiveIndex = 0;
        await refreshWallet();
      }
    });
  }
}

// ------- helper -------
async function findFirstUnusedIndex(maxScan = 20) {
  if (!STATE.node) throw new Error('Session not open');
  for (let i = 0; i < maxScan; i++) {
    const { address } = getNextReceive(STATE.node, i, STATE.network);
    try {
      const b = await addrBalance(address);
      const used =
        (b?.chain_stats?.funded_txo_count || 0) + (b?.mempool_stats?.funded_txo_count || 0) > 0;
      if (!used) return i;                  // first unused address → return its index
    } catch (_) {
      // network hiccup: just continue; worst case we keep current index
    }
  }
  return maxScan; // everything in window looks used; advance to end of window
}

// ------- screens -------
const go = (screenId) => {
  ['#screen-landing','#screen-create','#screen-open','#screen-restore','#screen-wallet']
    .forEach(id => hide(id));
  show(screenId);
};
go('#screen-landing');

// ------- PWA install -------
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; });
on('#btn-install', 'click', async () => {
  if (!deferredPrompt) return alert('Already installed or not supported.');
  deferredPrompt.prompt(); deferredPrompt = null;
});

// ------- Create -------
on('#btn-create', 'click', async () => {
  go('#screen-create');
  const m = generateMnemonic12();
  const mn = document.getElementById('mnemonic');
  if (mn) mn.value = m;
});

on('#btn-save-anchor', 'click', async () => {
  const m = /** @type {HTMLTextAreaElement} */(document.getElementById('mnemonic'))?.value.trim();
  if (!m) return alert('No mnemonic');
  const pwd = /** @type {HTMLInputElement} */(document.getElementById('create-password'))?.value;
  if (!pwd) return alert('Set a password');
  const json = await makeAnchorFile(m, pwd, STATE.network);
  const blob = new Blob([JSON.stringify(json,null,2)], { type:'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'anchor.json'; a.click();
  URL.revokeObjectURL(a.href);
  await openSessionFromMnemonic(m);
  go('#screen-wallet');
  await refreshWallet();
});
on('#btn-cancel-create','click',()=>go('#screen-landing'));

// ------- Restore -------
on('#btn-restore','click',()=>go('#screen-restore'));
on('#btn-restore-do','click', async () => {
  const m = /** @type {HTMLTextAreaElement} */(document.getElementById('restore-mnemonic'))?.value.trim();
  const pwd = /** @type {HTMLInputElement} */(document.getElementById('restore-password'))?.value;
  if (!m || !pwd) return alert('Enter seed and a password');
  const json = await makeAnchorFile(m, pwd, STATE.network);
  const blob = new Blob([JSON.stringify(json,null,2)], { type:'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'anchor.json'; a.click();
  URL.revokeObjectURL(a.href);
  await openSessionFromMnemonic(m);
  go('#screen-wallet');
  await refreshWallet();
});
on('#btn-cancel-restore','click',()=>go('#screen-landing'));

// ------- Open -------
on('#btn-open','click',()=>go('#screen-open'));
on('#btn-open-do','click', async () => {
  const f = /** @type {HTMLInputElement} */(document.getElementById('file-input'))?.files?.[0];
  const pwd = /** @type {HTMLInputElement} */(document.getElementById('open-password'))?.value;
  if (!f || !pwd) return alert('Missing file/password');
  try {
    const text = await f.text();
    const json = JSON.parse(text);
    // Optional: if you saved network in the file, you can restore it here:
    if (json?.network && ['mainnet','testnet','signet'].includes(json.network)) {
      STATE.network = json.network;
      setMempoolNetwork(STATE.network);
      setTxNetwork(STATE.network);
      const sel = document.getElementById('net-select'); if (sel) sel.value = STATE.network;
    }
    const mnemonic = await openAnchorFile(json, pwd);
    await openSessionFromMnemonic(mnemonic);
    go('#screen-wallet');
    await refreshWallet();
  } catch (e) {
    console.error(e);
    alert('Could not open file: ' + e.message);
  }
});
on('#btn-cancel-open','click',()=>go('#screen-landing'));

// ------- Lock -------
on('#btn-lock','click', () => {
  stopScan();
  zeroSecrets(STATE);
  go('#screen-landing');
});

// ------- Receive -------
on('#btn-receive','click', async () => {
  if (!STATE.node) {  // session was wiped (lock/visibility/refresh)
    alert('Session locked. Please open your wallet (Anchor File) again.');
    go('#screen-open');
    return;
  }
  hide('#panel-send'); show('#panel-receive');
  // auto-advance to the first unused receive address
  STATE.receiveIndex = await findFirstUnusedIndex(20);
  const { address } = getNextReceive(STATE.node, STATE.receiveIndex, STATE.network);
  const input = /** @type {HTMLInputElement} */(document.getElementById('receive-address'));
  if (input) input.value = address;
  drawQr(address, document.getElementById('qr-canvas'));
});
on('#btn-copy-addr','click', async () => {
  const v = /** @type {HTMLInputElement} */(document.getElementById('receive-address'))?.value;
  if (!v) return;
  try { await navigator.clipboard.writeText(v); alert('Copied'); } catch (_) {}
});

// ------- Send -------
on('#btn-send','click', async () => { hide('#panel-receive'); show('#panel-send'); });

on('#btn-scan','click', async () => {
  const video = document.getElementById('qr-video');
  if (!video) return;
  video.classList.remove('hidden');
  await startScan(video, (text) => {
    video.classList.add('hidden');
    stopScan();
    const to = /** @type {HTMLInputElement} */(document.getElementById('send-to'));
    if (to) to.value = text;
  });
});

on('#btn-send-do','click', async () => {
  const to = /** @type {HTMLInputElement} */(document.getElementById('send-to'))?.value.trim();
  const amtBtc = /** @type {HTMLInputElement} */(document.getElementById('send-amount'))?.value.trim();
  const feeRate = parseInt(/** @type {HTMLInputElement} */(document.getElementById('send-fee'))?.value, 10) || 5;
  if (!to || !validateAddress(to)) return alert('Bad address');
  const amountSats = btcToSats(amtBtc || '0');
  try {
    const fromAddr = getNextReceive(STATE.node, STATE.receiveIndex, STATE.network).address; // simplest
    const utxos = await addrUtxos(fromAddr);
    const { hex, txid } = await buildAndSignTx({ accountNode: STATE.node, utxos, toAddress: to, amountSats, feeRate });
    const st = document.getElementById('send-status');
    if (st) st.textContent = 'Built: ' + txid + ' (broadcasting)';
    const broadcasted = await broadcastTx(hex);
    if (st) st.textContent = 'Broadcasted: ' + broadcasted;
    await refreshWallet();
  } catch (e) {
    const st = document.getElementById('send-status');
    if (st) st.textContent = 'Error: ' + e.message;
  }
});

// ------- session helpers -------
async function openSessionFromMnemonic(mnemonic) {
  STATE.mnemonic = mnemonic;
  const seed = await mnemonicToSeed(mnemonic);
  const { node } = await deriveAccount(seed, STATE.network);
  STATE.node = node;
  STATE.receiveIndex = 0;
}

async function refreshWallet() {
  // Show balance for first N derived addresses (simple scan window=10)
  const addrs = [];
  for (let i=0;i<10;i++) addrs.push(getNextReceive(STATE.node, i, STATE.network).address);
  let satTotal = 0;
  for (const a of addrs) {
    try {
      const b = await addrBalance(a);
      satTotal += (b.chain_stats.funded_txo_sum - b.chain_stats.spent_txo_sum)
                + (b.mempool_stats.funded_txo_sum - b.mempool_stats.spent_txo_sum);
    } catch (_) {}
  }
  const bal = document.getElementById('balance');
  if (bal) bal.textContent = satsToBtc(satTotal) + ' BTC';

  // keep receiveIndex pointing at the first unused address
  try {
    STATE.receiveIndex = await findFirstUnusedIndex(20);
  } catch (_) {}

  // recent: show last txids for first address only (super simple)
  const recent = document.getElementById('recent');
  if (!recent) return;
  recent.innerHTML = '';
  try {
    const txids = await addrTxids(addrs[0]);
    txids.slice(0,6).forEach(t => {
      const div = document.createElement('div');
      div.textContent = t;
      recent.appendChild(div);
    });
  } catch (_) {}
}

// Security hygiene
let idleTimer = null;
const LOCK_AFTER_MS = 5 * 60 * 1000; // 5 minutes; tweak as you like
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    stopScan();
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => zeroSecrets(STATE), LOCK_AFTER_MS);
  } else {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
});
window.addEventListener('beforeunload', () => { stopScan(); zeroSecrets(STATE); });

// ------- SW -------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js', { scope: './' });
}
