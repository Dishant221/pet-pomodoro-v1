#!/usr/bin/env node
// One-off: public/favicon.svg → public/favicon.ico (32 px PNG wrapped in an ICO
// container — valid since Vista and in every browser). Browsers, bots and
// bookmark tools request /favicon.ico by convention regardless of <link rel>;
// without the file each request is a 404. Re-run only if favicon.svg changes.
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';

const svg = readFileSync('public/favicon.svg');
const png = await sharp(svg, { density: 384 }).resize(32, 32).png().toBuffer();

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);  // reserved
header.writeUInt16LE(1, 2);  // type: icon
header.writeUInt16LE(1, 4);  // one image
const entry = Buffer.alloc(16);
entry.writeUInt8(32, 0);               // width
entry.writeUInt8(32, 1);               // height
entry.writeUInt8(0, 2);                // palette
entry.writeUInt8(0, 3);                // reserved
entry.writeUInt16LE(1, 4);             // planes
entry.writeUInt16LE(32, 6);            // bpp
entry.writeUInt32LE(png.length, 8);    // size
entry.writeUInt32LE(22, 12);           // offset = 6 + 16
writeFileSync('public/favicon.ico', Buffer.concat([header, entry, png]));
console.log(`wrote public/favicon.ico (${22 + png.length} bytes)`);
