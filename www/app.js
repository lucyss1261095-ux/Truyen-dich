/* app.js - giao diện Truyện Dịch (offline). Cần engine.js (QT) và samples.js (SAMPLES, tùy chọn). */
(function () {
  "use strict";

  var $ = function (s) { return document.querySelector(s); };
  var tick = function () { return new Promise(function (r) { setTimeout(r, 0); }); };

  var TYPE_LABEL = { names: "Tên riêng", phrases: "Cụm từ", hanviet: "Hán-Việt", en: "Anh-Việt", rules: "Luật nhân", user: "Của tôi" };
  var KIND_LABEL = {
    n: "Tên riêng",
    p: "Cụm từ",
    h: "Hán-Việt (chưa có trong cụm từ)",
    x: "Chưa có trong từ điển"
  };

  var dicts = QT.createDicts();
  var meta = [];
  var segs = [];
  var settings = { lang: "auto", fs: 18, spaced: false, mode: "vp", multi: false, rules: true };
  var busy = false;
  var mode = "dict";
  var aiText = "";
  var aiCtl = null;
  var aiCfg = { preset: "openai", base: "", key: "", model: "", genre: "tienhiep" };

  /* ---------- tiện ích ---------- */
  var toastTimer;
  function toast(msg) {
    var t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2800);
  }

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* đầy bộ nhớ: bỏ qua */ } }

  function showLoading(msg) {
    var el = $("#loading");
    el.textContent = msg || "";
    el.hidden = !msg;
  }

  /* ---------- IndexedDB: lưu từ điển trong máy ---------- */
  var DB_NAME = "truyendich";
  var STORE = "dicts";
  var dbp = null;

  function db() {
    if (!dbp) {
      dbp = new Promise(function (res, rej) {
        var r = indexedDB.open(DB_NAME, 2);
        r.onupgradeneeded = function () {
          var d0 = r.result;
          [STORE, "books", "booktext"].forEach(function (n) { if (!d0.objectStoreNames.contains(n)) d0.createObjectStore(n, { keyPath: "id" }); });
        };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
      });
    }
    return dbp;
  }

  function tx(mode, fn, store) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var name = store || STORE;
        var t = d.transaction(name, mode);
        var rq = fn(t.objectStore(name));
        t.oncomplete = function () { res(rq ? rq.result : undefined); };
        t.onerror = function () { rej(t.error); };
        t.onabort = function () { rej(t.error); };
      });
    });
  }
  function dbAll() { return tx("readonly", function (s) { return s.getAll(); }); }
  function dbGet(id) { return tx("readonly", function (s) { return s.get(id); }); }
  function dbPut(rec) { return tx("readwrite", function (s) { return s.put(rec); }); }
  function dbDel(id) { return tx("readwrite", function (s) { return s["delete"](id); }); }

  /* ---------- đọc file (tự nhận UTF-8 / UTF-16 / GBK) ---------- */
  function decodeBytes(buf) {
    var u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (u[0] === 0xff && u[1] === 0xfe) return new TextDecoder("utf-16le").decode(u);
    if (u[0] === 0xfe && u[1] === 0xff) return new TextDecoder("utf-16be").decode(u);
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(u);
    } catch (e) {
      try { return new TextDecoder("gb18030").decode(u); } catch (e2) { return new TextDecoder("utf-8").decode(u); }
    }
  }
  async function readFileText(file) {
    return decodeBytes(await file.arrayBuffer());
  }

  function guessType(name) {
    var n = name.toLowerCase().replace(/^.*[\\/]/, "");
    if (/ignored|pronoun|trollgoal|lacviet|thieuchuu/.test(n)) return "skip";
    if (/luat/.test(n)) return "rules";
    if (/phien|hanviet|han-viet|han_viet|pinyin/.test(n)) return "hanviet";
    if (/name/.test(n)) return "names";
    if (/phrase/.test(n)) return "phrases";
    if (/(^|[^a-z])(en|anh|english)([^a-z]|$)/.test(n)) return "en";
    return null;
  }

  /* ---------- nạp từ điển ---------- */
  function updateStats() {
    var s = QT.stats(dicts);
    var total = s.names + s.phrases + s.hanviet + s.en + s.rules;
    $("#stats").textContent = total ? total.toLocaleString("vi-VN") + " mục từ điển" : "Chưa có từ điển";
    $("#hint").hidden = total > 0;
  }

  function renderDictList() {
    var ul = $("#dict-list");
    ul.textContent = "";
    if (!meta.length) {
      var li0 = document.createElement("li");
      li0.className = "empty";
      li0.textContent = "Chưa có từ điển nào.";
      ul.appendChild(li0);
      return;
    }
    meta.forEach(function (m) {
      var li = document.createElement("li");
      var box = document.createElement("div");
      box.className = "meta";
      var nm = document.createElement("div");
      nm.className = "nm";
      nm.textContent = m.name;
      var sub = document.createElement("div");
      sub.className = "sub";
      sub.textContent = (TYPE_LABEL[m.type] || m.type) + " · " + m.count.toLocaleString("vi-VN") + " mục";
      box.appendChild(nm);
      box.appendChild(sub);
      var del = document.createElement("button");
      del.type = "button";
      del.textContent = "Xóa";
      del.addEventListener("click", async function () {
        if (!confirm("Xóa từ điển “" + m.name + "”?")) return;
        await dbDel(m.id);
        await rebuild();
      });
      li.appendChild(box);
      li.appendChild(del);
      ul.appendChild(li);
    });
  }

  async function rebuild() {
    showLoading("Đang nạp từ điển...");
    var recs = await dbAll();
    var order = { hanviet: 0, phrases: 1, names: 2, en: 3, rules: 4, user: 5 };
    recs.sort(function (a, b) { return (order[a.type] - order[b.type]) || (a.at - b.at); });
    dicts = QT.createDicts();
    meta = [];
    for (var i = 0; i < recs.length; i++) {
      var r = recs[i];
      var c = QT.parseInto(dicts, r.type, r.text);
      if (r.type === "user") QT.parseInto(dicts, "en", r.text); // mục tự thêm dùng được cho cả tiếng Anh
      meta.push({ id: r.id, type: r.type, name: r.name, count: c });
      r.text = null;
      await tick();
    }
    showLoading("");
    renderDictList();
    updateStats();
  }

  // Nạp một file từ điển (đã ở dạng byte). inZip: file nằm trong zip -> chỉ nhận loại đã nhận ra được.
  async function importBytes(name, bytes, inZip, sel) {
    var base = name.replace(/^.*[\\/]/, "");
    if (!/\.txt$/i.test(base)) return "skip";
    var type = sel && sel !== "auto" ? sel : guessType(base);
    if (type === "skip") return "skip";
    if (!type) {
      if (inZip) return "skip";
      type = "phrases";
      toast("Không đoán được loại của " + base + ", tạm xếp là Cụm từ");
    }
    showLoading("Đang đọc " + base + "...");
    await tick();
    var text = decodeBytes(bytes);
    await dbPut({ id: type + "|" + base, type: type, name: base, text: text, at: Date.now() });
    return "ok";
  }

  async function importAny(name, bytes, sel) {
    var added = 0, skipped = 0, errors = [];
    if (window.Zip && Zip.isZip(bytes) && (/\.zip$/i.test(name) || !/\.txt$/i.test(name))) {
      showLoading("Đang giải nén " + name + "...");
      await tick();
      var entries = await Zip.read(bytes, function (n) { return /\.txt$/i.test(n) && guessType(n) !== "skip"; });
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].error) { errors.push(entries[i].name + ": " + entries[i].error); continue; }
        var r = await importBytes(entries[i].name, entries[i].data, true, sel);
        if (r === "ok") added++; else skipped++;
      }
    } else {
      var r2 = await importBytes(name, bytes, false, sel);
      if (r2 === "ok") added++; else skipped++;
    }
    return { added: added, skipped: skipped, errors: errors };
  }

  async function finishImport(total) {
    if (total.added) await rebuild();
    showLoading("");
    var msg = total.added ? "Đã nạp " + total.added + " file từ điển" : "Không có file từ điển nào được nạp";
    if (total.skipped) msg += " (bỏ qua " + total.skipped + " file không nhận ra hoặc chưa hỗ trợ, như IgnoredChinesePhrases, Pronouns)";
    if (total.errors.length) msg += ". Lỗi: " + total.errors[0];
    toast(msg);
  }

  async function importFiles(files) {
    var sel = $("#sel-type").value;
    var total = { added: 0, skipped: 0, errors: [] };
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var bytes = new Uint8Array(await f.arrayBuffer());
      var r = await importAny(f.name, bytes, sel);
      total.added += r.added; total.skipped += r.skipped; total.errors = total.errors.concat(r.errors);
    }
    await finishImport(total);
  }

  async function importFromUrl(url) {
    url = (url || "").trim();
    if (!url) { toast("Dán link file từ điển (.txt hoặc .zip) vào ô"); return; }
    showLoading("Đang tải từ điển...");
    var res = await WebText.fetchBytes(url);
    var name = decodeURIComponent((url.split("?")[0].split("#")[0].split("/").pop()) || "tudien.txt");
    var r = await importAny(name, res.bytes, $("#sel-type").value);
    await finishImport(r);
  }

  async function loadSamples() {
    var S = window.SAMPLES;
    if (!S) { toast("Không có từ điển mẫu"); return; }
    var keys = ["hanviet", "phrases", "names", "en", "rules"];
    for (var i = 0; i < keys.length; i++) {
      var t = keys[i];
      if (S[t]) await dbPut({ id: t + "|mau_" + t + ".txt", type: t, name: "mau_" + t + ".txt (mẫu)", text: S[t], at: Date.now() });
    }
    await rebuild();
    toast("Đã nạp từ điển mẫu (rất nhỏ, chỉ để thử)");
  }

  async function saveUser(src, meaning) {
    src = (src || "").trim();
    meaning = (meaning || "").replace(/[\r\n]+/g, " ").trim();
    if (!src || !meaning) { toast("Cần nhập cả chữ gốc và nghĩa"); return false; }
    var line = src + "=" + meaning;
    QT.parseInto(dicts, "user", line);
    QT.parseInto(dicts, "en", line);
    var old = await dbGet("user|__user__");
    var text = old ? old.text : "";
    if (text && text.slice(-1) !== "\n") text += "\n";
    await dbPut({ id: "user|__user__", type: "user", name: "Mục thêm nhanh của tôi", text: text + line + "\n", at: old ? old.at : Date.now() });
    var found = false;
    for (var i = 0; i < meta.length; i++) {
      if (meta[i].id === "user|__user__") { meta[i].count++; found = true; }
    }
    if (!found) meta.push({ id: "user|__user__", type: "user", name: "Mục thêm nhanh của tôi", count: 1 });
    renderDictList();
    updateStats();
    return true;
  }

  /* ---------- dịch ---------- */
  var BATCH = 80;

  function transOpts() { return { mode: settings.mode, multi: settings.multi, rules: settings.rules }; }

  async function doTranslate() {
    if (busy) return;
    var src = $("#src").value;
    if (!src.trim()) { toast("Chưa có văn bản để dịch"); return; }
    lsSet("td_src", src);
    aiText = "";
    setMode("dict");
    busy = true;
    $("#btn-go").disabled = true;
    var lang = settings.lang === "auto" ? QT.detectLang(src) : settings.lang;
    var st = QT.stats(dicts);
    if (lang === "zh" && !(st.names + st.phrases + st.hanviet)) toast("Chưa có từ điển tiếng Trung, kết quả sẽ rất sơ sài");
    if (lang === "en" && !st.en) toast("Chưa có từ điển Anh-Việt, kết quả sẽ giữ nguyên chữ Anh");
    var mainTop = $("main").scrollTop;
    try {
      var lines = src.split("\n");
      var all = [];
      for (var i = 0; i < lines.length; i += BATCH) {
        var part = lines.slice(i, i + BATCH).join("\n");
        var sg = QT.translateSegments(part, dicts, lang, transOpts());
        for (var j = 0; j < sg.length; j++) all.push(sg[j]);
        if (i + BATCH < lines.length) all.push({ text: "\n", nl: true });
        $("#prog").textContent = "Đang dịch " + Math.min(100, Math.round(((i + BATCH) / lines.length) * 100)) + "%";
        await tick();
      }
      segs = all;
      await renderSegs();
      showPane("out");
      $("main").scrollTop = mainTop;
    } catch (e) {
      toast("Lỗi khi dịch: " + (e && e.message ? e.message : e));
    }
    $("#prog").textContent = "";
    $("#btn-go").disabled = false;
    busy = false;
  }

  async function renderSegs() {
    if (mode === "ai") return;
    var out = $("#out");
    out.textContent = "";
    var prevNl = false;
    var frag = document.createDocumentFragment();
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (s.nl) {
        if (settings.spaced) { if (!prevNl) frag.appendChild(document.createTextNode("\n\n")); }
        else frag.appendChild(document.createTextNode("\n"));
        prevNl = true;
      } else {
        prevNl = false;
        var sp = document.createElement("span");
        sp.className = "w k-" + s.kind;
        sp.dataset.i = i;
        sp.textContent = s.text;
        frag.appendChild(sp);
      }
      if (i % 4000 === 3999) {
        out.appendChild(frag);
        frag = document.createDocumentFragment();
        await tick();
      }
    }
    out.appendChild(frag);
  }

  function showPane(which) {
    var isOut = which === "out";
    $("#pane-src").hidden = isOut;
    $("#pane-out").hidden = !isOut;
    $("#seg-src").classList.toggle("on", !isOut);
    $("#seg-out").classList.toggle("on", isOut);
    $("main").scrollTop = 0;
  }

  /* ---------- sao chép / chia sẻ ---------- */
  function plainOut() { return (mode === "ai" && aiText) ? aiText : QT.segsToText(segs, settings.spaced); }

  function copyText(t) {
    var ok = function () { toast("Đã chép"); };
    var fallback = function () {
      var ta = document.createElement("textarea");
      ta.value = t;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); ok(); } catch (e) { toast("Không chép được"); }
      document.body.removeChild(ta);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok, fallback);
    else fallback();
  }

  async function shareText() {
    var t = plainOut();
    if (!t) { toast("Chưa có bản dịch"); return; }
    var cap = window.Capacitor;
    if (cap && cap.Plugins && cap.Plugins.Share) {
      try {
        await cap.Plugins.Share.share({ title: "Bản dịch", text: t, dialogTitle: "Chia sẻ / Lưu bản dịch" });
        return;
      } catch (e) {
        if (/cancel/i.test(String((e && e.message) || e))) return;
      }
    }
    if (navigator.share) {
      try { await navigator.share({ title: "Bản dịch", text: t }); return; } catch (e) { if (e && e.name === "AbortError") return; }
    }
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([t], { type: "text/plain;charset=utf-8" }));
    a.download = "ban_dich.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /* ---------- bảng thông tin khi chạm vào một từ ---------- */
  var curSrc = "";

  function openSheet(i) {
    var s = segs[i];
    if (!s || !s.src) return;
    curSrc = s.src;
    $("#sh-src").textContent = s.src;
    $("#sh-kind").textContent = KIND_LABEL[s.kind] || "";
    var hv = /[㐀-鿿]/.test(s.src) ? QT.hanvietOf(s.src, dicts) : "";
    $("#sh-hv").textContent = hv ? "Hán-Việt: " + hv : "";
    var alts = $("#sh-alts");
    alts.textContent = "";
    (s.alts || "").split("/").forEach(function (m) {
      m = m.trim();
      if (!m) return;
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = m;
      b.addEventListener("click", function () { applyUser(m); });
      alts.appendChild(b);
    });
    $("#sh-input").value = s.text.trim();
    $("#sheet").hidden = false;
  }

  async function applyUser(meaning) {
    if (await saveUser(curSrc, meaning)) {
      $("#sheet").hidden = true;
      toast("Đã lưu, đang dịch lại...");
      await doTranslate();
    }
  }

  /* ---------- AI (online) ---------- */
  function loadAi() {
    try { var c = JSON.parse(lsGet("td_ai") || "{}"); for (var k in c) if (k in aiCfg && typeof c[k] === "string") aiCfg[k] = c[k]; } catch (e) { /* mặc định */ }
    $("#ai-preset").value = aiCfg.preset;
    $("#ai-base").value = aiCfg.base;
    $("#ai-key").value = aiCfg.key;
    $("#ai-model").value = aiCfg.model;
    $("#ai-genre").value = aiCfg.genre;
    syncAiUi();
  }
  function readAiForm() {
    aiCfg.preset = $("#ai-preset").value;
    aiCfg.base = $("#ai-base").value.trim();
    aiCfg.key = $("#ai-key").value.trim();
    aiCfg.model = $("#ai-model").value.trim();
    aiCfg.genre = $("#ai-genre").value;
    lsSet("td_ai", JSON.stringify(aiCfg));
    syncAiUi();
  }
  function syncAiUi() {
    var gem = aiCfg.preset === "gemini";
    $("#ai-base-wrap").hidden = gem;
    $("#ai-model").placeholder = gem ? "gemini-2.5-flash" : "Tên model do nhà cung cấp cấp";
  }

  function setMode(m) {
    mode = m;
    $("#mode-dict").classList.toggle("on", m === "dict");
    $("#mode-ai").classList.toggle("on", m === "ai");
    var out = $("#out");
    if (m === "ai") {
      out.textContent = aiText || "Chưa có bản AI. Bấm “Tối ưu bằng AI”.";
      $("#tip-out").textContent = "Bản AI dựa trên bản từ điển. Chuyển về “Bản từ điển” để chạm sửa nghĩa từng từ.";
    } else {
      $("#tip-out").textContent = "Chạm vào một từ để xem chữ gốc, nghĩa khác và sửa nghĩa.";
      renderSegs();
    }
  }

  function aiErrorMessage(e) {
    var m = (e && e.message) || String(e);
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "Không kết nối được. Kiểm tra mạng, Base URL, hoặc dịch vụ chưa cho phép gọi từ trình duyệt (CORS).";
    return m;
  }

  async function runAi() {
    if (aiCtl) return;
    var src = $("#src").value;
    if (!src.trim()) { toast("Chưa có văn bản gốc"); return; }
    readAiForm();
    aiCtl = new AbortController();
    $("#btn-ai").hidden = true;
    $("#btn-ai-stop").hidden = false;
    aiText = "";
    setMode("ai");
    try {
      aiText = await QTAI.optimize({
        cfg: aiCfg, genre: aiCfg.genre, source: src, lang: settings.lang, dicts: dicts, QT: QT, signal: aiCtl.signal,
        onProgress: function (d, t) { $("#ai-prog").textContent = "AI đang tối ưu " + d + "/" + t; },
        onChunk: function (txt) { aiText = txt; $("#out").textContent = txt; }
      });
      toast("AI đã tối ưu xong");
    } catch (e) {
      if (e && e.name === "AbortError") toast("Đã dừng, giữ phần đã xong");
      else toast("Lỗi AI: " + aiErrorMessage(e));
    }
    $("#ai-prog").textContent = "";
    $("#btn-ai").hidden = false;
    $("#btn-ai-stop").hidden = true;
    aiCtl = null;
    if (!aiText) setMode("dict");
  }

  async function testAi() {
    readAiForm();
    toast("Đang kiểm tra...");
    try {
      var r = await QTAI.test(aiCfg);
      toast("Kết nối OK: " + r);
    } catch (e) { toast("Lỗi: " + aiErrorMessage(e)); }
  }

  /* ---------- cài đặt ---------- */
  function loadSettings() {
    try {
      var s = JSON.parse(lsGet("td_settings") || "{}");
      if (s.lang) settings.lang = s.lang;
      if (s.fs) settings.fs = s.fs;
      settings.spaced = !!s.spaced;
      if (s.mode === "hv") settings.mode = "hv";
      settings.multi = !!s.multi;
      if (s.rules === false) settings.rules = false;
    } catch (e) { /* dùng mặc định */ }
  }
  function applySettings() {
    $("#sel-lang").value = settings.lang;
    $("#chk-spaced").checked = settings.spaced;
    $("#sel-mode").value = settings.mode;
    $("#chk-multi").checked = settings.multi;
    $("#chk-rules").checked = settings.rules;
    document.documentElement.style.setProperty("--fs", settings.fs + "px");
  }
  function saveSettings() { lsSet("td_settings", JSON.stringify(settings)); }

  /* ---------- gắn sự kiện ---------- */
  var srcTimer;
  function bind() {
    document.querySelectorAll(".tabbtn").forEach(function (b) {
      b.addEventListener("click", function () {
        document.querySelectorAll(".tabbtn").forEach(function (x) { x.classList.toggle("on", x === b); });
        document.querySelectorAll(".tab").forEach(function (t) { t.classList.toggle("active", t.id === "tab-" + b.dataset.tab); });
      });
    });

    $("#seg-src").addEventListener("click", function () { showPane("src"); });
    $("#seg-out").addEventListener("click", function () { showPane("out"); });

    $("#src").addEventListener("input", function () {
      clearTimeout(srcTimer);
      srcTimer = setTimeout(function () { lsSet("td_src", $("#src").value); }, 600);
    });

    $("#btn-paste").addEventListener("click", async function () {
      try {
        var t = await navigator.clipboard.readText();
        if (t) { $("#src").value = t; lsSet("td_src", t); toast("Đã dán"); } else toast("Bộ nhớ tạm đang trống");
      } catch (e) {
        toast("Không dán tự động được: giữ lâu vào khung rồi chọn Dán");
        $("#src").focus();
      }
    });
    $("#btn-open").addEventListener("click", function () { $("#file-text").click(); });
    $("#file-text").addEventListener("change", async function () {
      var f = this.files && this.files[0];
      this.value = "";
      if (!f) return;
      if (f.size > 400000 && window.Books) { window.Books.importFile(f); return; }
      try {
        var t = await readFileText(f);
        $("#src").value = t;
        lsSet("td_src", t);
        showPane("src");
        toast("Đã mở " + f.name);
      } catch (e) { toast("Không đọc được file"); }
    });
    $("#btn-clear").addEventListener("click", function () {
      $("#src").value = "";
      lsSet("td_src", "");
    });
    $("#sel-lang").addEventListener("change", function () { settings.lang = this.value; saveSettings(); });
    $("#btn-go").addEventListener("click", doTranslate);

    $("#btn-copy").addEventListener("click", function () {
      var t = plainOut();
      if (t) copyText(t); else toast("Chưa có bản dịch");
    });
    $("#btn-share").addEventListener("click", shareText);
    $("#btn-minus").addEventListener("click", function () { settings.fs = Math.max(13, settings.fs - 1); applySettings(); saveSettings(); });
    $("#btn-plus").addEventListener("click", function () { settings.fs = Math.min(34, settings.fs + 1); applySettings(); saveSettings(); });
    function retranslate() {
      saveSettings();
      if (!busy && $("#src").value.trim()) doTranslate();
    }
    $("#sel-mode").addEventListener("change", function () { settings.mode = this.value; retranslate(); });
    $("#chk-multi").addEventListener("change", function () { settings.multi = this.checked; retranslate(); });
    $("#chk-rules").addEventListener("change", function () { settings.rules = this.checked; retranslate(); });
    $("#chk-spaced").addEventListener("change", async function () {
      settings.spaced = this.checked;
      saveSettings();
      if (segs.length) await renderSegs();
    });

    $("#out").addEventListener("click", function (e) {
      var el = e.target.closest ? e.target.closest(".w") : null;
      if (el) openSheet(+el.dataset.i);
    });

    $("#btn-import").addEventListener("click", function () { $("#file-dict").click(); });
    $("#file-dict").addEventListener("change", async function () {
      var files = Array.prototype.slice.call(this.files || []);
      this.value = "";
      if (!files.length) return;
      try { await importFiles(files); } catch (e) { showLoading(""); toast("Lỗi nạp từ điển: " + (e && e.message ? e.message : e)); }
    });
    $("#btn-dict-url").addEventListener("click", async function () {
      var b = this;
      b.disabled = true;
      try { await importFromUrl($("#dict-url").value); }
      catch (e) {
        showLoading("");
        var m = (e && e.message) || String(e);
        if (/Failed to fetch|NetworkError|Load failed/i.test(m)) m = "Không tải được (mất mạng hoặc trang chặn). Bản APK trên điện thoại tải được nhiều link hơn trình duyệt.";
        toast("Lỗi: " + m);
      }
      b.disabled = false;
    });
    $("#btn-sample").addEventListener("click", function () {
      loadSamples().catch(function (e) { toast("Lỗi: " + (e && e.message ? e.message : e)); });
    });
    $("#btn-quick").addEventListener("click", async function () {
      if (await saveUser($("#q-src").value, $("#q-vi").value)) {
        $("#q-src").value = "";
        $("#q-vi").value = "";
        toast("Đã lưu");
      }
    });

    $("#btn-ai").addEventListener("click", runAi);
    $("#btn-ai-stop").addEventListener("click", function () { if (aiCtl) aiCtl.abort(); });
    $("#mode-dict").addEventListener("click", function () { setMode("dict"); });
    $("#mode-ai").addEventListener("click", function () { setMode("ai"); });
    $("#ai-test").addEventListener("click", testAi);
    ["#ai-preset", "#ai-base", "#ai-key", "#ai-model", "#ai-genre"].forEach(function (id) { $(id).addEventListener("change", readAiForm); });
    $("#sh-close").addEventListener("click", function () { $("#sheet").hidden = true; });
    $("#sheet").addEventListener("click", function (e) { if (e.target === this) this.hidden = true; });
    $("#sh-save").addEventListener("click", function () { applyUser($("#sh-input").value); });
  }

  function init() {
    loadSettings();
    applySettings();
    loadAi();
    var saved = lsGet("td_src");
    if (saved) $("#src").value = saved;
    bind();
    rebuild().catch(function (e) {
      showLoading("");
      toast("Không mở được kho từ điển: " + (e && e.message ? e.message : e));
    });
    if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol) && !window.Capacitor) {
      navigator.serviceWorker.register("sw.js").catch(function () { /* bỏ qua */ });
    }
  }

  window.TD = {
    tx: tx, toast: toast, readFileText: readFileText, getDicts: function () { return dicts; },
    getSettings: function () { return settings; },
    transOpts: transOpts,
    setSource: function (t) { $("#src").value = t; lsSet("td_src", t); },
    go: doTranslate,
    showTab: function (name) { var b = document.querySelector('.tabbtn[data-tab="' + name + '"]'); if (b) b.click(); },
    showPane: showPane
  };

  init();
})();
