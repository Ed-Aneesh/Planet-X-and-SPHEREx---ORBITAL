/* =====================================================================
   gif.js — a small animated-GIF encoder (feature F25: GIF export), so the
   blink can be saved and shared without any server or library.

   GIF stores up to 256 colours per picture. Our frames are mostly grey
   (SPHEREx images are single-band), so the palette is 192 greys plus a
   4×4×4 colour cube (64 colours) for the yellow ring and labels.
   Pixels are compressed with LZW, the method the GIF standard requires.
   ===================================================================== */

const GIF = {
  palette() {
    const p = [];
    for (let i = 0; i < 192; i++) { const v = Math.round(i * 255 / 191); p.push(v, v, v); }
    const lv = [0, 85, 170, 255];
    for (let r = 0; r < 4; r++) for (let g = 0; g < 4; g++) for (let b = 0; b < 4; b++) p.push(lv[r], lv[g], lv[b]);
    return p;
  },

  /* RGBA pixels -> palette indices */
  index(data) {
    const n = data.length / 4, out = new Uint8Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const r = data[j], g = data[j + 1], b = data[j + 2];
      if (Math.abs(r - g) < 12 && Math.abs(g - b) < 12) out[i] = Math.round(((r + g + b) / 3) * 191 / 255);
      else out[i] = 192 + ((r >> 6) << 4) + ((g >> 6) << 2) + (b >> 6);
    }
    return out;
  },

  /* LZW for GIF, minimum code size 8 (same scheme as the widely used omggif encoder) */
  lzw(indices) {
    const minCode = 8, clear = 1 << minCode, eoi = clear + 1;
    let codeSize = minCode + 1, next = eoi + 1, table = new Map();
    const out = [];
    let cur = 0, nbits = 0;
    const emit = c => {
      cur |= c << nbits; nbits += codeSize;
      while (nbits >= 8) { out.push(cur & 255); cur >>>= 8; nbits -= 8; }
    };
    emit(clear);
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const k = indices[i], key = (prefix << 8) | k;
      const found = table.get(key);
      if (found !== undefined) { prefix = found; continue; }
      emit(prefix);
      if (next === 4096) {
        emit(clear); next = eoi + 1; codeSize = minCode + 1; table = new Map();
      } else {
        if (next >= (1 << codeSize)) codeSize++;
        table.set(key, next++);
      }
      prefix = k;
    }
    emit(prefix); emit(eoi);
    if (nbits > 0) out.push(cur & 255);
    return out;
  },

  /* frames: ImageData[] (same size); delayMs per frame. Returns a Blob. */
  encode(frames, delayMs) {
    const w = frames[0].width, h = frames[0].height, bytes = [];
    const u16 = v => bytes.push(v & 255, (v >> 8) & 255);
    const str = s => { for (const ch of s) bytes.push(ch.charCodeAt(0)); };
    str("GIF89a"); u16(w); u16(h); bytes.push(0xF7, 0, 0);          // global colour table of 256
    bytes.push(...this.palette());
    bytes.push(0x21, 0xFF, 11); str("NETSCAPE2.0"); bytes.push(3, 1, 0, 0, 0);   // loop forever
    const delay = Math.max(2, Math.round(delayMs / 10));
    for (const f of frames) {
      bytes.push(0x21, 0xF9, 4, 0x04); u16(delay); bytes.push(0, 0);      // graphic control
      bytes.push(0x2C); u16(0); u16(0); u16(w); u16(h); bytes.push(0);    // image descriptor
      bytes.push(8);
      const data = this.lzw(this.index(f.data));
      for (let i = 0; i < data.length; i += 255) {
        const part = data.slice(i, i + 255);
        bytes.push(part.length, ...part);
      }
      bytes.push(0);
    }
    bytes.push(0x3B);
    return new Blob([new Uint8Array(bytes)], { type: "image/gif" });
  }
};
