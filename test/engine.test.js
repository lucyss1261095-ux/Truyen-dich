/* Kiểm tra nhanh engine dịch bằng từ điển mẫu. Chạy: npm test */
const fs = require("fs");
const path = require("path");
const QT = require("../www/engine.js");

const d = QT.createDicts();
const dir = path.join(__dirname, "..", "mau");
[["names", "mau_names.txt"], ["phrases", "mau_vietphrase.txt"], ["hanviet", "mau_hanviet.txt"], ["en", "mau_anh_viet.txt"], ["rules", "mau_luatnhan.txt"]]
  .forEach(([t, f]) => QT.parseInto(d, t, fs.readFileSync(path.join(dir, f), "utf8")));

let fails = 0;
function eq(name, got, want) {
  const ok = got === want;
  console.log(ok ? "PASS" : "FAIL", name);
  if (!ok) { console.log("  got: ", JSON.stringify(got), "\n  want:", JSON.stringify(want)); fails++; }
}

eq("hội thoại", QT.translate("李寒笑着说：“师兄，你想回家吗？”", d), 'Lý Hàn cười nói: "Sư huynh, ngươi muốn về nhà không?"');
eq("tên riêng ưu tiên (không luật nhân)", QT.translate("天剑宗的师兄", d, "zh", false, { rules: false }), "Thiên Kiếm Tông của sư huynh");
eq("tên riêng + luật nhân", QT.translate("天剑宗的师兄", d), "Sư huynh của Thiên Kiếm Tông");
eq("Hán-Việt dự phòng", QT.translate("日月", d), "Nhật nguyệt");
eq("ký tự lạ giữ nguyên", QT.translate("龘", d), "龘");
eq("tiếng Anh cụm từ", QT.translate("The senior brother said he went home.", d), "Sư huynh nói anh ấy đã đi nhà.");
eq("tiếng Anh số nhiều", QT.translate("Swords", d), "Kiếm");

// ---- Luật nhân ----
eq("luật nhân đảo trật tự", QT.translate("我的书", d), "Sách của ta");
eq("luật nhân giữ tên riêng", QT.translate("李寒的朋友", d), "Bằng hữu của Lý Hàn");
eq("luật nhân giữa câu", QT.translate("他看着我的书。", d), "Hắn nhìn sách của ta.");
eq("luật nhân không khớp qua dấu câu", QT.translate("我，的书", d), "Ta, của sách");
eq("tắt luật nhân", QT.translate("我的书", d, "zh", false, { rules: false }), "Ta của sách");
{
  const d2 = QT.createDicts();
  QT.parseInto(d2, "phrases", "我=ta\n他=hắn\n不=không\n是=là\n好=tốt\n的=của\n书=sách");
  QT.parseInto(d2, "rules", "{0}是{1}={0} là {1}\n不{0}不{1}=không {0} không {1}\n{0}的{1}={1} của {0}\n{0}不是{1}={0} chẳng phải {1}");
  eq("luật dài hơn thắng", QT.translate("我不是他", d2), "Ta chẳng phải hắn");
  eq("luật có chữ ở đầu", QT.translate("不好不是", d2), "Không tốt không là");
  eq("luật có {n} thiếu trong mẫu bị bỏ", (QT.parseInto(d2, "rules", "{0}和={1} và"), QT.translate("我和", d2, "zh")), "Ta 和");
}
// ---- chế độ Hán-Việt và nhiều nghĩa ----
eq("chế độ Hán-Việt", QT.translate("李寒的书", d, "zh", false, { mode: "hv" }), "Lý hàn đích 书");
eq("nhiều nghĩa", QT.translate("朋友", d, "zh", false, { multi: true }), "[Bằng hữu/bạn]");
eq("một nghĩa mặc định", QT.translate("朋友", d), "Bằng hữu");
process.exit(fails ? 1 : 0);
