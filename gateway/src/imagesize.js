// Width and height of a PNG, JPEG, WebP, GIF or AVIF file, read from its header.
// Used to price upscaling (fal bills per megapixel of output).
import fs from 'node:fs';

function fromBuffer(b) {
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47) {
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  if (b.length >= 10 && b.toString('ascii', 0, 3) === 'GIF') {
    return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  }
  if (b.length >= 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = b.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    if (chunk === 'VP8L') {
      const bits = b.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    return null;
  }
  // AVIF/HEIF: the "ispe" box holds the image size.
  if (b.length >= 12 && b.toString('ascii', 4, 8) === 'ftyp') {
    const at = b.indexOf('ispe');
    if (at > 0 && at + 16 <= b.length) return { width: b.readUInt32BE(at + 8), height: b.readUInt32BE(at + 12) };
    return null;
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i += 1; continue; }
      const marker = b[i + 1];
      if (marker === 0xff) { i += 1; continue; }
      const len = b.readUInt16BE(i + 2);
      // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
      }
      i += 2 + len;
    }
  }
  return null;
}

export function imageSize(file) {
  const fd = fs.openSync(file, 'r');
  try {
    // JPEG frame headers can sit after large EXIF blocks.
    const size = Math.min(fs.fstatSync(fd).size, 512 * 1024);
    const buf = Buffer.alloc(size);
    fs.readSync(fd, buf, 0, size, 0);
    const dims = fromBuffer(buf);
    return dims && dims.width > 0 && dims.height > 0 ? dims : null;
  } finally {
    fs.closeSync(fd);
  }
}
