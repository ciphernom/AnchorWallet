// crypto.js — seed/mnemonic, anchor file encrypt/decrypt, derivation (BIP84 only)
import * as bip39 from 'https://esm.sh/@scure/bip39@1.2.1';
import { wordlist } from 'https://esm.sh/@scure/bip39@1.2.1/wordlists/english';
import { HDKey } from 'https://esm.sh/@scure/bip32@1.4.0';
import * as ecc from 'https://esm.sh/@bitcoinerlab/secp256k1@1.2.0?bundle';
import * as bitcoin from 'https://esm.sh/bitcoinjs-lib@6.1.5';
bitcoin.initEccLib(ecc);

export function generateMnemonic12() {
  return bip39.generateMnemonic(wordlist, 128);
}

export async function mnemonicToSeed(mnemonic) {
  return await bip39.mnemonicToSeed(mnemonic);
}

export async function makeAnchorFile(mnemonic, password, network='mainnet') {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  const iterations = 300000; // fixed for MVP
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt','decrypt']
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payload = { mnemonic };
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, enc.encode(JSON.stringify(payload)));
  return {
    version: 1,
    network,
    kdf: { name: 'PBKDF2-HMAC-SHA256', salt_b64: b64(salt), iterations },
    cipher: { name: 'AES-256-GCM', iv_b64: b64(iv) },
    enc_payload_b64: b64(new Uint8Array(ct))
  };
}

export async function openAnchorFile(fileJson, password) {
  const enc = new TextEncoder();
  const { kdf, cipher, enc_payload_b64 } = fileJson;
  const salt = fromB64(kdf.salt_b64);
  const iv = fromB64(cipher.iv_b64);
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: kdf.iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt','decrypt']
  );
  const ptBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, fromB64(enc_payload_b64));
  const payload = JSON.parse(new TextDecoder().decode(ptBuf));
  if (!payload.mnemonic) throw new Error('Invalid file payload');
  return payload.mnemonic;
}

export async function deriveAccount(seed, network='mainnet') {
  // seed is Uint8Array
  const root = HDKey.fromMasterSeed(new Uint8Array(seed));
  const coin = network === 'mainnet' ? 0 : 1;
  const path = `m/84'/${coin}'/0'`;
  const node = root.derive(path);
  return { root, node, path };
}

export function getNextReceive(accountNode, index, network = 'mainnet') {
  if (!accountNode) throw new Error('Session locked/expired — reopen your wallet first.');
  // external chain (0), index i — derive relatively
  const i = Number(index) >>> 0;           // ensure a non-negative integer
  const child = accountNode.deriveChild(0).deriveChild(i);
  const net = (network === 'mainnet') ? bitcoin.networks.bitcoin : bitcoin.networks.testnet; // testnet also covers signet
  const p2wpkh = bitcoin.payments.p2wpkh({ pubkey: Buffer.from(child.publicKey), network: net });

 return { key: child, address: p2wpkh.address };
}

export function zeroSecrets(state) {
  state.mnemonic = null; state.root = null; state.node = null; state.receiveIndex = 0;
}

// utils b64
function b64(bytes) {
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
  let binary = ''; for (let i=0;i<bytes.byteLength;i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
function fromB64(b64str) {
  const binary = atob(b64str); const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i=0;i<len;i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
