/*
 * chapters.js - Tách file truyện dài thành các chương.
 * split(text) -> [[vị_trí_bắt_đầu, "tiêu đề"], ...]; chương i kết thúc ở vị trí bắt đầu của chương i+1.
 * Nhận diện: 第N章/节/回/卷..., "Chương N", "Chapter N". Không thấy thì cắt theo dung lượng.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Chapters = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var NUM = "[0-9\\uff10-\\uff19\\u96f6\\u3007\\u4e00\\u4e8c\\u4e09\\u56db\\u4e94\\u516d\\u4e03\\u516b\\u4e5d\\u5341\\u767e\\u5343\\u4e07\\u4e24\\u58f9\\u8d30\\u53c1\\u8086\\u4f0d\\u9646\\u67d2\\u634c\\u7396\\u62fe\\u4f70\\u4edf]";
  var SP = "[ \\t\\u3000]*";
  var RE_SRC =
    "^" + SP + "(" +
    "\\u7b2c" + SP + NUM + "+" + SP + "[\\u7ae0\\u8282\\u7bc0\\u56de\\u5377\\u96c6\\u90e8\\u7bc7\\u8bdd\\u8a71][^\\n]{0,50}" +
    "|(?:chương|chapter)" + SP + "\\d+[^\\n]{0,60}" +
    "|(?:\\u5377|quyển)" + SP + NUM + "+[^\\n]{0,30}" +
    ")[ \\t\\u3000\\r]*$";

  var MIN_BODY = 80;      // chương ngắn hơn mức này coi là dòng mục lục, bỏ qua
  var MAX_CHAPTER = 40000; // chương dài hơn mức này thì cắt nhỏ
  var PIECE = 20000;
  var FALLBACK = 6000;

  function cutBySize(text, from, to, piece) {
    var cuts = [];
    var p = from;
    while (to - p > piece * 1.5) {
      var nl = text.indexOf("\n", p + piece);
      if (nl < 0 || nl >= to) break;
      p = nl + 1;
      cuts.push(p);
    }
    return cuts;
  }

  function split(text) {
    var re = new RegExp(RE_SRC, "gim");
    var found = [];
    var m;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      // m.index có thể nằm trước khoảng trắng đầu dòng: giữ nguyên
      found.push([m.index, m[1].replace(/[\s　]+/g, " ").trim()]);
    }

    var chapters = [];
    if (found.length >= 2) {
      // bỏ dòng mục lục: chương gần như không có nội dung
      var kept = [];
      for (var i = 0; i < found.length; i++) {
        var end = i + 1 < found.length ? found[i + 1][0] : text.length;
        if (end - found[i][0] >= MIN_BODY || i === found.length - 1) kept.push(found[i]);
      }
      found = kept.length >= 2 ? kept : found;
      if (found[0][0] > 0 && text.slice(0, found[0][0]).replace(/\s+/g, "").length > 200) chapters.push([0, "Mở đầu"]);
      for (var k = 0; k < found.length; k++) {
        var s = found[k][0];
        var e = k + 1 < found.length ? found[k + 1][0] : text.length;
        chapters.push([s, found[k][1]]);
        if (e - s > MAX_CHAPTER) {
          var cuts = cutBySize(text, s, e, PIECE);
          for (var c = 0; c < cuts.length; c++) chapters.push([cuts[c], found[k][1] + " (phần " + (c + 2) + ")"]);
        }
      }
      return chapters;
    }

    // không có dấu hiệu chương: cắt theo dung lượng
    var cuts2 = cutBySize(text, 0, text.length, FALLBACK);
    chapters.push([0, "Phần 1"]);
    for (var j = 0; j < cuts2.length; j++) chapters.push([cuts2[j], "Phần " + (j + 2)]);
    return chapters;
  }

  function range(chapters, i, textLength) {
    return [chapters[i][0], i + 1 < chapters.length ? chapters[i + 1][0] : textLength];
  }

  return { split: split, range: range };
});
