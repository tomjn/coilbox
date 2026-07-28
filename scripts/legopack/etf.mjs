/**
 * Minimal reader for the Erlang external term format, enough for `.wings`
 * files. Only the tags Wings3D actually emits are implemented, so an unknown
 * tag throws rather than being skipped.
 *
 * Representation, chosen so 60 MB of terms decode without wrapper objects:
 *
 * - atom       -> JS string
 * - tuple      -> JS array
 * - list       -> JS array
 * - Erlang string (a list of small ints) -> JS array of numbers
 * - binary     -> Uint8Array
 * - integer    -> number
 * - float      -> number
 *
 * Tuples and lists are both arrays. Wings records are tuples whose first
 * element is an atom, so callers tell them apart with `typeof x[0] ===
 * "string"`. Erlang strings decode to number arrays, so they never collide
 * with atoms.
 */

import { inflateSync } from "node:zlib";

const VERSION_MAGIC = 131;

const TAG = {
  NEW_FLOAT: 70,
  COMPRESSED: 80,
  SMALL_INTEGER: 97,
  INTEGER: 98,
  FLOAT: 99,
  ATOM: 100,
  SMALL_TUPLE: 104,
  LARGE_TUPLE: 105,
  NIL: 106,
  STRING: 107,
  LIST: 108,
  BINARY: 109,
  SMALL_BIG: 110,
  LARGE_BIG: 111,
  SMALL_ATOM: 115,
  ATOM_UTF8: 118,
  SMALL_ATOM_UTF8: 119,
};

class Reader {
  /** @param {Uint8Array} bytes */
  constructor(bytes) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.at = 0;
  }

  u8() {
    return this.bytes[this.at++];
  }

  u16() {
    const v = this.view.getUint16(this.at);
    this.at += 2;
    return v;
  }

  u32() {
    const v = this.view.getUint32(this.at);
    this.at += 4;
    return v;
  }

  i32() {
    const v = this.view.getInt32(this.at);
    this.at += 4;
    return v;
  }

  f64() {
    const v = this.view.getFloat64(this.at);
    this.at += 8;
    return v;
  }

  take(n) {
    const v = this.bytes.subarray(this.at, this.at + n);
    this.at += n;
    return v;
  }

  latin1(n) {
    return Buffer.from(this.take(n)).toString("latin1");
  }

  bignum(n) {
    const sign = this.u8();
    let value = 0n;
    const digits = this.take(n);
    for (let i = n - 1; i >= 0; i--) value = (value << 8n) | BigInt(digits[i]);
    return Number(sign ? -value : value);
  }

  term() {
    const tag = this.u8();
    switch (tag) {
      case TAG.SMALL_INTEGER:
        return this.u8();
      case TAG.INTEGER:
        return this.i32();
      case TAG.NEW_FLOAT:
        return this.f64();
      case TAG.FLOAT:
        // Legacy 31-byte text encoding.
        return Number.parseFloat(this.latin1(31));
      case TAG.ATOM:
      case TAG.ATOM_UTF8:
        return this.latin1(this.u16());
      case TAG.SMALL_ATOM:
      case TAG.SMALL_ATOM_UTF8:
        return this.latin1(this.u8());
      case TAG.SMALL_TUPLE:
        return this.tuple(this.u8());
      case TAG.LARGE_TUPLE:
        return this.tuple(this.u32());
      case TAG.NIL:
        return [];
      case TAG.STRING: {
        const n = this.u16();
        return Array.from(this.take(n));
      }
      case TAG.LIST: {
        const n = this.u32();
        const out = new Array(n);
        for (let i = 0; i < n; i++) out[i] = this.term();
        // Wings only writes proper lists, so the tail is always NIL. Read and
        // drop it rather than assuming, so an improper list fails loudly.
        const tail = this.term();
        if (!Array.isArray(tail) || tail.length !== 0) {
          throw new Error("improper list: tail is not NIL");
        }
        return out;
      }
      case TAG.BINARY:
        return this.take(this.u32());
      case TAG.SMALL_BIG:
        return this.bignum(this.u8());
      case TAG.LARGE_BIG:
        return this.bignum(this.u32());
      default:
        throw new Error(`unsupported term tag ${tag} at offset ${this.at - 1}`);
    }
  }

  tuple(n) {
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = this.term();
    return out;
  }
}

/**
 * Decode a term. `bytes` must start at the version magic byte.
 *
 * @param {Uint8Array} bytes
 */
export function decodeTerm(bytes) {
  if (bytes[0] !== VERSION_MAGIC) {
    throw new Error(`expected version magic ${VERSION_MAGIC}, got ${bytes[0]}`);
  }
  let body = bytes.subarray(1);

  if (body[0] === TAG.COMPRESSED) {
    const expected = new DataView(
      body.buffer,
      body.byteOffset + 1,
      4,
    ).getUint32(0);
    body = inflateSync(body.subarray(5));
    if (body.length !== expected) {
      throw new Error(
        `inflated to ${body.length} bytes, header says ${expected}`,
      );
    }
  }

  return new Reader(body).term();
}
