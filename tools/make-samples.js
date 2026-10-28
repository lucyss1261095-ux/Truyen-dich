/* Tạo www/samples.js từ thư mục mau/. Chạy: node tools/make-samples.js */
const fs = require("fs"), path = require("path");
const dir = path.join(__dirname, "..", "mau");
const S = {};
for (const [k, f] of [["names", "mau_names.txt"], ["phrases", "mau_vietphrase.txt"], ["hanviet", "mau_hanviet.txt"], ["en", "mau_anh_viet.txt"], ["rules", "mau_luatnhan.txt"]])
  S[k] = fs.readFileSync(path.join(dir, f), "utf8");
fs.writeFileSync(path.join(__dirname, "..", "www", "samples.js"), "/* Từ điển mẫu rất nhỏ, chỉ để thử. Tạo tự động: node tools/make-samples.js */\nwindow.SAMPLES = " + JSON.stringify(S, null, 1) + ";\n");
console.log("samples.js ok");
