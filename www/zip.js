/*
 * zip.js - Đọc file .zip ngay trong máy (không cần thư viện ngoài). Hỗ trợ kiểu lưu "stored" và "deflate".
 * Zip.read(bytes, filter?) -> Promise<[{ name, data: Uint8Array }]>. filter(name) trả false để bỏ qua (không giải nén).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Zip = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

  function isZip(bytes) { return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b; }

  async function inflateRaw(data) {
    if (typeof DecompressionStream === "undefined") throw new Error("Máy không hỗ trợ giải nén zip, hãy giải nén rồi chọn từng file .txt");
    var ds = new DecompressionStream("deflate-raw");
    var w = ds.writable.getWriter();
    w.write(data);
    w.close();
    return new Uint8Array(await new Response(ds.readable).arrayBuffer());
  }

  function decodeName(b, flags) {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(b); } catch (e) {
      try { return new TextDecoder("gb18030").decode(b); } catch (e2) { return new TextDecoder("utf-8").decode(b); }
    }
  }

  async function read(bytes, filter) {
    var min = Math.max(0, bytes.length - 65557);
    var i = bytes.length - 22;
    for (; i >= min; i--) if (u32(bytes, i) === 0x06054b50) break;
    if (i < min) throw new Error("Không phải file zip hợp lệ");
    var count = u16(bytes, i + 10);
    var p = u32(bytes, i + 16);
    var out = [];
    for (var k = 0; k < count; k++) {
      if (u32(bytes, p) !== 0x02014b50) break;
      var flags = u16(bytes, p + 8);
      var method = u16(bytes, p + 10);
      var csize = u32(bytes, p + 20);
      var nlen = u16(bytes, p + 28);
      var elen = u16(bytes, p + 30);
      var clen = u16(bytes, p + 32);
      var loff = u32(bytes, p + 42);
      var name = decodeName(bytes.subarray(p + 46, p + 46 + nlen), flags);
      p += 46 + nlen + elen + clen;
      if (/\/$/.test(name)) continue;
      if (filter && !filter(name)) continue;
      if (csize === 0xffffffff || loff === 0xffffffff) { out.push({ name: name, error: "Zip64 chưa hỗ trợ" }); continue; }
      var lnlen = u16(bytes, loff + 26);
      var lelen = u16(bytes, loff + 28);
      var start = loff + 30 + lnlen + lelen;
      var raw = bytes.subarray(start, start + csize);
      if (flags & 1) { out.push({ name: name, error: "File zip có đặt mật khẩu" }); continue; }
      if (method === 0) out.push({ name: name, data: raw });
      else if (method === 8) out.push({ name: name, data: await inflateRaw(raw) });
      else out.push({ name: name, error: "Kiểu nén không hỗ trợ" });
    }
    return out;
  }

  return { read: read, isZip: isZip };
});
