// tx.js — build P2WPKH tx using bitcoinjs-lib (network‑aware)
import * as bitcoin from 'https://esm.sh/bitcoinjs-lib@6.1.5?bundle';
import ecc from 'https://esm.sh/@bitcoinerlab/secp256k1@1.2.0?bundle';
import { ECPairFactory } from 'https://esm.sh/ecpair@2.1.0?bundle';
import { fetchRawTx } from './mempool.js';

bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);
let NETWORK = bitcoin.networks.bitcoin; // default mainnet
export function setNetwork(net){ NETWORK = (net === 'mainnet') ? bitcoin.networks.bitcoin : bitcoin.networks.testnet; }

export function validateAddress(addr) {
  try {
    bitcoin.address.toOutputScript(addr, NETWORK);
    return true;
  } catch { return false; }
}

export function satsToBtc(sats) {
  return (sats/1e8).toFixed(8);
}
export function btcToSats(btc) {
  return Math.round(parseFloat(btc)*1e8);
}

export async function buildAndSignTx({ accountNode, utxos, toAddress, amountSats, feeRate }) {
  const psbt = new bitcoin.Psbt({ network: NETWORK });

  // coin selection: accumulative smallest-first
  const sorted = utxos.slice().sort((a,b)=>a.value-b.value);
  let selected = []; let total = 0;
  for (const u of sorted) { selected.push(u); total += u.value; if (total >= amountSats) break; }
  if (total < amountSats) throw new Error('Insufficient funds');

  // rough fee: ~110 vB per input + ~31 vB per output (p2wpkh) + 10
  const vsize = (selected.length * 110) + (2 * 31) + 10;
  const fee = Math.max(feeRate * vsize, 150); // floor min fee
  const change = total - amountSats - fee;
  if (change < 0) throw new Error('Insufficient for fee');

  // Inputs: need nonWitnessUtxo for each
  for (const u of selected) {
    const raw = await fetchRawTx(u.txid);
    psbt.addInput({
      hash: u.txid,
      index: u.vout,
      nonWitnessUtxo: Buffer.from(raw, 'hex'),
    });
  }

  // Outputs
  psbt.addOutput({ address: toAddress, value: amountSats });
  // Change back to change chain index 0
  const changeKey = accountNode.deriveChild(1).deriveChild(0);
  const changeAddr = bitcoin.payments.p2wpkh({ pubkey: Buffer.from(changeKey.publicKey), network: NETWORK }).address;
  if (change > 546) psbt.addOutput({ address: changeAddr, value: change });

  // Sign: derive keys for inputs by matching scriptPubKey to our derived addresses
  const candidates = [];
  for (let i=0;i<20;i++) candidates.push(accountNode.deriveChild(0).deriveChild(i));
  for (let i=0;i<selected.length; i++) {
    const prev = bitcoin.Transaction.fromBuffer(psbt.data.inputs[i].nonWitnessUtxo);
    const prevOut = prev.outs[selected[i].vout];
    const script = prevOut.script;
    let pair = null;
    for (const n of candidates) {
      const pay = bitcoin.payments.p2wpkh({ pubkey: Buffer.from(n.publicKey), network: NETWORK });
      const outScript = bitcoin.address.toOutputScript(pay.address, NETWORK);
      if (outScript.equals(script)) { pair = n; break; }
    }
    if (!pair) throw new Error('Key for input not found (scan window too small)');
    const ecp = ECPair.fromPrivateKey(Buffer.from(pair.privateKey));
    psbt.signInput(i, ecp);
  }
  psbt.finalizeAllInputs();
  const tx = psbt.extractTransaction();
  return { hex: tx.toHex(), txid: tx.getId() };
}
