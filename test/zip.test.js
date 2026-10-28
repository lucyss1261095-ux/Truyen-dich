/* Kiểm tra đọc zip + nạp từ điển kiểu Quick Translator. Chạy: npm test */
const Zip = require("../www/zip.js");
const QT = require("../www/engine.js");
const bytes = new Uint8Array(Buffer.from("UEsDBBQAAAAIAIBwXF3NjeDBNAAAAJwDAAARAAAAUVQvVmlldFBocmFzZS50eHR7v3v/s46JtiWJvFxP9i6wzUs/tuHYwkxerqc7Op62ttgWH9ugkFFamZcxKjIqMipCXxEAUEsDBBQAAAAIAIBwXF3Q+B6FEwAAABAAAAAMAAAAUVQvTmFtZXMudHh0eza37+n6SbY+h/cqeBxekMcFAFBLAwQUAAAACACAcFxdAAAAAAIAAAAAAAAACAAAAFFUL0RhdGEvAwBQSwMEFAAAAAgAgHBcXYMW3IwDAAAAAQAAAAoAAABRVC9ub3RlLm1kqwAAUEsBAhQDFAAAAAgAgHBcXc2N4ME0AAAAnAMAABEAAAAAAAAAAAAAAIABAAAAAFFUL1ZpZXRQaHJhc2UudHh0UEsBAhQDFAAAAAgAgHBcXdD4HoUTAAAAEAAAAAwAAAAAAAAAAAAAAIABYwAAAFFUL05hbWVzLnR4dFBLAQIUAxQAAAAIAIBwXF0AAAAAAgAAAAAAAAAIAAAAAAAAAAAAEAD9QaAAAABRVC9EYXRhL1BLAQIUAxQAAAAIAIBwXF2DFtyMAwAAAAEAAAAKAAAAAAAAAAAAAACAAcgAAABRVC9ub3RlLm1kUEsFBgAAAAAEAAQA5wAAAPMAAAAAAA==", "base64"));
let fails = 0;
const ok = (n, c, x) => { console.log(c ? "PASS" : "FAIL", n, c ? "" : x || ""); if (!c) fails++; };
(async () => {
  ok("nhận ra zip", Zip.isZip(bytes));
  const all = await Zip.read(bytes, n => /\.txt$/i.test(n));
  ok("chỉ lấy file .txt, bỏ thư mục", all.length === 2 && all.every(e => e.data), JSON.stringify(all.map(e => e.name)));
  const d = QT.createDicts();
  for (const e of all) QT.parseInto(d, /Names/.test(e.name) ? "names" : "phrases", new TextDecoder().decode(e.data));
  ok("BOM + CRLF được xử lý", QT.translate("李寒说你", d) === "Lý Hàn 说 ngươi", QT.translate("李寒说你", d));
  let threw = false; try { await Zip.read(new Uint8Array([1, 2, 3, 4, 5])); } catch (e) { threw = true; }
  ok("báo lỗi file không phải zip", threw);
  process.exit(fails ? 1 : 0);
})();
