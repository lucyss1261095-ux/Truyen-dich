/*
 * ai.js - Tối ưu bản dịch bằng AI (cần mạng). Hỗ trợ:
 *   - "openai": mọi dịch vụ tương thích OpenAI (POST {base}/chat/completions) - dùng cho FurAI nếu có endpoint này.
 *   - "gemini": Google Gemini (generateContent).
 * AI nhận: văn bản gốc + bản dịch từ điển (nháp) + danh sách tên riêng/thuật ngữ, rồi viết lại cho tự nhiên.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.QTAI = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var GENRE = {
    tienhiep: "Tiên hiệp/huyền huyễn: giữ Hán-Việt cho cảnh giới, chiêu thức, danh xưng (kim đan, nguyên anh, tông môn...). Xưng hô: ta/ngươi, hắn/nàng, huynh/muội, sư huynh/sư đệ.",
    ngontinh: "Ngôn tình hiện đại: văn mềm, tự nhiên, thuần Việt; xưng hô anh/em, cậu/tớ, tôi/cô... theo quan hệ nhân vật; tránh Hán-Việt nặng nề.",
    dothi: "Đô thị: thuần Việt, khẩu ngữ, giọng người Việt thời nay, hạn chế Hán-Việt cổ.",
    khac: "Văn phong tự nhiên của người Việt, chọn xưng hô hợp ngữ cảnh."
  };

  function sleep(ms, signal) {
    return new Promise(function (res, rej) {
      var t = setTimeout(res, ms);
      if (signal) signal.addEventListener("abort", function () { clearTimeout(t); rej(abortError()); }, { once: true });
    });
  }
  function abortError() { var e = new Error("Đã dừng"); e.name = "AbortError"; return e; }

  function trimBase(u) { return String(u || "").trim().replace(/\/+$/, ""); }

  function buildPrompt(o) {
    var terms = o.terms.length ? o.terms.map(function (t) { return "- " + t[0] + " = " + t[1]; }).join("\n") : "(không có)";
    var ctx = o.prev ? "\nĐoạn bản dịch ngay trước (để giữ mạch, tên và xưng hô nhất quán):\n" + o.prev.slice(-600) + "\n" : "";
    return (
      "Bạn là dịch giả truyện chuyên nghiệp, dịch " + (o.lang === "zh" ? "tiếng Trung" : "tiếng Anh") + " sang tiếng Việt.\n" +
      "Dưới đây có văn bản gốc và một bản dịch nháp tự động từ từ điển (nhiều chỗ cứng, sai trật tự, thiếu mượt). " +
      "Hãy viết lại thành bản dịch hoàn chỉnh, tự nhiên như người Việt viết.\n" +
      "Yêu cầu:\n" +
      "- Dựa vào văn bản gốc làm chuẩn, dùng bản nháp để tham khảo tên riêng và thuật ngữ. Không thêm/bớt tình tiết.\n" +
      "- Thể loại: " + (GENRE[o.genre] || GENRE.khac) + "\n" +
      "- Thành ngữ, tiếng lóng: dịch ý rồi diễn đạt theo cách người Việt nói.\n" +
      "- BẮT BUỘC dùng đúng cách dịch trong danh sách tên riêng/thuật ngữ bên dưới; giữ nhất quán tên.\n" +
      "- Giữ nguyên bố cục đoạn/dòng thoại. Chỉ trả về bản dịch, không giải thích, không ghi chú.\n\n" +
      "Tên riêng / thuật ngữ:\n" + terms + "\n" + ctx +
      "\nVăn bản gốc:\n" + o.source + "\n\nBản dịch nháp từ từ điển:\n" + o.draft
    );
  }

  async function postJSON(url, headers, body, signal) {
    var r = await fetch(url, { method: "POST", headers: headers, body: JSON.stringify(body), signal: signal });
    var txt = await r.text();
    var data = null;
    try { data = JSON.parse(txt); } catch (e) { /* để dưới xử lý */ }
    if (!r.ok) {
      var m = data && (data.error && (data.error.message || data.error) || data.message) || txt.slice(0, 200);
      var err = new Error("HTTP " + r.status + ": " + (typeof m === "string" ? m : JSON.stringify(m)));
      err.status = r.status;
      throw err;
    }
    if (!data) throw new Error("Máy chủ trả về dữ liệu không đọc được");
    return data;
  }

  async function callOnce(cfg, prompt, signal) {
    if (cfg.preset === "gemini") {
      var model = cfg.model || "gemini-2.5-flash";
      var url = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent";
      var d = await postJSON(url, { "Content-Type": "application/json", "x-goog-api-key": cfg.key }, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4 }
      }, signal);
      var c = d.candidates && d.candidates[0];
      var parts = c && c.content && c.content.parts;
      var text = parts ? parts.map(function (p) { return p.text || ""; }).join("") : "";
      if (!text) throw new Error("AI không trả về nội dung" + (c && c.finishReason ? " (" + c.finishReason + ")" : ""));
      return text.trim();
    }
    var base = trimBase(cfg.base);
    if (!base) throw new Error("Chưa nhập Base URL");
    var d2 = await postJSON(base + "/chat/completions", { "Content-Type": "application/json", Authorization: "Bearer " + cfg.key }, {
      model: cfg.model,
      temperature: 0.4,
      messages: [{ role: "user", content: prompt }]
    }, signal);
    var ch = d2.choices && d2.choices[0];
    var t2 = ch && ch.message && ch.message.content;
    if (Array.isArray(t2)) t2 = t2.map(function (p) { return p.text || ""; }).join("");
    if (!t2) throw new Error("AI không trả về nội dung");
    return String(t2).trim();
  }

  async function call(cfg, prompt, signal, retries) {
    retries = retries == null ? 3 : retries;
    for (var a = 0; ; a++) {
      try {
        return await callOnce(cfg, prompt, signal);
      } catch (e) {
        if (e.name === "AbortError") throw e;
        var retryable = !e.status || e.status === 429 || e.status >= 500;
        if (!retryable || a >= retries) throw e;
        await sleep(2000 * (a + 1), signal);
      }
    }
  }

  function checkCfg(cfg) {
    if (!cfg.key) throw new Error("Chưa nhập API key (tab AI)");
    if (cfg.preset !== "gemini" && !trimBase(cfg.base)) throw new Error("Chưa nhập Base URL (tab AI)");
    if (cfg.preset !== "gemini" && !cfg.model) throw new Error("Chưa nhập tên model (tab AI)");
  }

  async function test(cfg, signal) {
    checkCfg(cfg);
    var out = await call(cfg, "Chỉ trả lời đúng một từ: OK", signal, 0);
    return out.slice(0, 60);
  }

  // Chia nguồn theo dòng thành các khối không vượt maxChars
  function splitChunks(text, maxChars) {
    var lines = text.split("\n");
    var chunks = [];
    var cur = [];
    var len = 0;
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      if (!ln.trim()) { if (cur.length) cur.push(ln); continue; }
      if (len + ln.length > maxChars && cur.length) {
        chunks.push(cur.join("\n").trim());
        cur = [];
        len = 0;
      }
      cur.push(ln);
      len += ln.length + 1;
    }
    if (cur.join("").trim()) chunks.push(cur.join("\n").trim());
    return chunks;
  }

  /*
   * opts: { cfg, genre, source, lang, dicts, QT, onProgress(done,total), onChunk(text), signal }
   * Trả về toàn bộ bản AI (các khối nối bằng dòng trống).
   */
  async function optimize(opts) {
    checkCfg(opts.cfg);
    var QT = opts.QT;
    var lang = opts.lang === "auto" || !opts.lang ? QT.detectLang(opts.source) : opts.lang;
    var chunks = splitChunks(opts.source, lang === "zh" ? 1200 : 3000);
    var results = [];
    var prev = "";
    for (var i = 0; i < chunks.length; i++) {
      if (opts.signal && opts.signal.aborted) throw abortError();
      var src = chunks[i];
      var segs = QT.translateSegments(src, opts.dicts, lang);
      var draft = QT.segsToText(segs, false);
      var seen = {};
      var terms = [];
      for (var j = 0; j < segs.length && terms.length < 80; j++) {
        var s = segs[j];
        if (s.kind === "n" && s.src && !seen[s.src]) { seen[s.src] = 1; terms.push([s.src, s.text.trim()]); }
      }
      var prompt = buildPrompt({ source: src, draft: draft, terms: terms, prev: prev, genre: opts.genre, lang: lang });
      var out = await call(opts.cfg, prompt, opts.signal);
      results.push(out);
      prev = out;
      if (opts.onChunk) opts.onChunk(results.join("\n\n"));
      if (opts.onProgress) opts.onProgress(i + 1, chunks.length);
    }
    return results.join("\n\n");
  }

  return { optimize: optimize, test: test, buildPrompt: buildPrompt, splitChunks: splitChunks };
});
