#!/usr/bin/env node
// Generate a Dooby donor activation code for a display name.
//
//   node scripts/gen-activation-code.js "Donor Name"
//
// Signs the normalized name with the developer's ECDSA P-256 private key.
// The extension verifies it with the matching public key embedded in
// js/donor.js (DonorManager.ACTIVATION_PUBLIC_KEY), so codes cannot be
// forged from the public source.
//
// Private key location (first found wins):
//   - $DOOBY_ACTIVATION_KEY  (path to PEM)
//   - ~/.dooby/activation-key.pem
// Never commit the private key.
const { createPrivateKey, sign, createPublicKey } = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const name = process.argv.slice(2).join(' ');
if (!name.trim()) {
  console.error('usage: node scripts/gen-activation-code.js "Donor Name"');
  process.exit(1);
}

const keyPath = process.env.DOOBY_ACTIVATION_KEY || path.join(os.homedir(), '.dooby', 'activation-key.pem');
if (!fs.existsSync(keyPath)) {
  console.error(`private key not found at ${keyPath}\nset DOOBY_ACTIVATION_KEY or put the PEM at ~/.dooby/activation-key.pem`);
  process.exit(1);
}

const normalized = name.toLowerCase().replace(/\s+/g, '');
const privateKey = createPrivateKey(fs.readFileSync(keyPath));
// dsaEncoding 'ieee-p1363' gives the raw 64-byte r||s form WebCrypto expects.
const sig = sign('sha256', Buffer.from(normalized, 'utf8'), { key: privateKey, dsaEncoding: 'ieee-p1363' });
const code = 'DOOBY-' + sig.toString('base64url');

// Sanity check against the public key embedded in the extension.
const donorSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'donor.js'), 'utf8');
const m = donorSrc.match(/ACTIVATION_PUBLIC_KEY:\s*(\{[^}]*\})/);
if (m) {
  const embedded = JSON.parse(m[1]);
  const mine = createPublicKey(privateKey).export({ format: 'jwk' });
  if (embedded.x !== mine.x || embedded.y !== mine.y) {
    console.error('WARNING: this private key does not match the public key in js/donor.js; the code will be rejected.');
  }
}

console.log(`Display name : ${name.trim()}`);
console.log(`Activation   : ${code}`);
console.log('\nSend both to the donor. The code only works with that name (case/spacing-insensitive).');
