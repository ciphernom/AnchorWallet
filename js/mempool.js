// mempool.js — simple wrappers around mempool.space API (networks)
let BASE = 'https://mempool.space/api';
export function setMempoolNetwork(net){
  if (net === 'testnet') BASE = 'https://mempool.space/testnet/api';
  else if (net === 'signet') BASE = 'https://mempool.space/signet/api';
  else BASE = 'https://mempool.space/api';
}

export async function addrBalance(address) {
  const r = await fetch(`${BASE}/address/${address}`);
  if (!r.ok) throw new Error('balance fetch failed');
  return r.json();
}
export async function addrUtxos(address) {
  const r = await fetch(`${BASE}/address/${address}/utxo`);
  if (!r.ok) throw new Error('utxos fetch failed');
  return r.json(); // [{txid, vout, value, status:{confirmed}}]
}
export async function addrTxids(address) {
  const r = await fetch(`${BASE}/address/${address}/txs`);
  if (!r.ok) return [];
  const arr = await r.json();
  return arr.map(x => x.txid);
}
export async function fetchRawTx(txid) {
  const r = await fetch(`${BASE}/tx/${txid}/hex`);
  if (!r.ok) throw new Error('raw tx fetch failed');
  const hex = (await r.text()).trim();
  if (!/^[0-9a-fA-F]+$/.test(hex)) throw new Error('unexpected tx hex');
  return hex;
}
export async function broadcastTx(hex) {
  const r = await fetch(`${BASE}/tx`, { method:'POST', body: hex, headers:{'content-type':'text/plain'} });
  if (!r.ok) throw new Error('broadcast failed');
  const txid = await r.text();
  return txid;
}
