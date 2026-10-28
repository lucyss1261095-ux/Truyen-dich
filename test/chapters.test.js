/* Kiểm tra tách chương. Chạy: npm test */
const Ch = require("../www/chapters.js");
let fails = 0;
const ok = (n, c, x) => { console.log(c ? "PASS" : "FAIL", n, c ? "" : x || ""); if (!c) fails++; };

let text = "作者：测试\n" + Array.from({ length: 10 }, (_, i) => `第${i + 1}章 目录项`).join("\n") + "\n";
for (let i = 1; i <= 50; i++) text += `第${i}章 标题${i}\n` + "文字内容很多很多。".repeat(20) + "\n";
const c = Ch.split(text);
ok("bỏ mục lục, đủ 50 chương", c.filter(x => /^第\d+章 标题/.test(x[1])).length === 50, c.length);

const t2 = "第一章 开始\r\n" + "文字内容。\n".repeat(30) + "第二百零三章 结束\r\n" + "文字内容。\n".repeat(30) + "Chương 3: Kết\r\n" + "Nội dung.\n".repeat(30);
const c2 = Ch.split(t2);
ok("Hán số, CRLF, Chương", c2.length === 3 && c2[1][1] === "第二百零三章 结束" && /^Chương 3/.test(c2[2][1]), JSON.stringify(c2));

const noch = ("没有章节标记的一行文字。".repeat(20) + "\n").repeat(300);
ok("không có chương thì cắt theo dung lượng", Ch.split(noch).length > 5);
ok("câu văn thường không bị nhầm là chương", Ch.split("他说第三章很好看。\n" + "内容。\n".repeat(50)).length === 1);
process.exit(fails ? 1 : 0);
