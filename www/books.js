/* books.js - Thư viện truyện (file lớn, tách chương), dịch cả truyện ra file, và dịch trang web từ link. */
(function () {
  "use strict";

  var TD = window.TD;
  var $ = function (s) { return document.querySelector(s); };
  var tick = function () { return new Promise(function (r) { setTimeout(r, 0); }); };

  var PAGE = 200; // số chương hiện mỗi lần
  var cur = null; // { meta, text }
  var shown = 0;
  var exporting = null; // { stop: bool }
  var activeChap = -1;
  var web = null; // { url, next, prev, title } khi đang đọc trang web

  /* ---------- kho dữ liệu ---------- */
  function dbAllBooks() { return TD.tx("readonly", function (s) { return s.getAll(); }, "books"); }
  function dbPutMeta(m) { return TD.tx("readwrite", function (s) { return s.put(m); }, "books"); }
  function dbGetText(id) { return TD.tx("readonly", function (s) { return s.get(id); }, "booktext"); }
  function dbPutText(id, text) { return TD.tx("readwrite", function (s) { return s.put({ id: id, text: text }); }, "booktext"); }
  async function dbDelBook(id) {
    await TD.tx("readwrite", function (s) { return s["delete"](id); }, "books");
    await TD.tx("readwrite", function (s) { return s["delete"](id); }, "booktext");
  }

  function status(msg) {
    var el = $("#book-status");
    el.textContent = msg || "";
    el.hidden = !msg;
  }

  function mb(n) { return (n / 1048576).toFixed(1) + " MB"; }

  /* ---------- danh sách truyện ---------- */
  async function renderBooks() {
    var ul = $("#book-list");
    ul.textContent = "";
    var books = await dbAllBooks();
    books.sort(function (a, b) { return b.at - a.at; });
    if (!books.length) {
      var e = document.createElement("li");
      e.className = "empty";
      e.textContent = "Chưa có truyện nào.";
      ul.appendChild(e);
      return;
    }
    books.forEach(function (m) {
      var li = document.createElement("li");
      var box = document.createElement("div");
      box.className = "meta";
      var nm = document.createElement("div");
      nm.className = "nm";
      nm.textContent = m.name;
      var sub = document.createElement("div");
      sub.className = "sub";
      sub.textContent = m.chapters.length.toLocaleString("vi-VN") + " chương · " + mb(m.size) + " · đang ở chương " + (m.pos + 1);
      box.appendChild(nm);
      box.appendChild(sub);
      var open = document.createElement("button");
      open.type = "button";
      open.textContent = "Mở";
      open.addEventListener("click", function () { openBook(m.id); });
      var del = document.createElement("button");
      del.type = "button";
      del.textContent = "Xóa";
      del.addEventListener("click", async function () {
        if (!confirm("Xóa truyện “" + m.name + "”?")) return;
        await dbDelBook(m.id);
        renderBooks();
      });
      var act = document.createElement("div");
      act.style.display = "flex";
      act.style.gap = "6px";
      act.appendChild(open);
      act.appendChild(del);
      li.appendChild(box);
      li.appendChild(act);
      ul.appendChild(li);
    });
  }

  async function importFile(file) {
    TD.showTab("books");
    try {
      status("Đang đọc " + file.name + " (" + mb(file.size) + ")...");
      await tick();
      var text = await TD.readFileText(file);
      status("Đang tách chương...");
      await tick();
      var chapters = Chapters.split(text);
      var id = "b" + Date.now();
      status("Đang lưu vào máy...");
      await tick();
      await dbPutText(id, text);
      await dbPutMeta({ id: id, name: file.name.replace(/\.txt$/i, ""), size: file.size, chars: text.length, chapters: chapters, pos: 0, at: Date.now() });
      status("");
      TD.toast("Đã nhập " + chapters.length.toLocaleString("vi-VN") + " chương");
      await renderBooks();
    } catch (e) {
      status("");
      TD.toast("Không nhập được: " + (e && e.message ? e.message : e));
    }
  }

  /* ---------- xem một truyện ---------- */
  async function openBook(id) {
    var books = await dbAllBooks();
    var meta = books.filter(function (b) { return b.id === id; })[0];
    var rec = await dbGetText(id);
    if (!meta || !rec) { TD.toast("Không đọc được truyện này"); return; }
    cur = { meta: meta, text: rec.text };
    $("#book-home").hidden = true;
    $("#book-view").hidden = false;
    $("#book-title").textContent = meta.name + " · " + meta.chapters.length.toLocaleString("vi-VN") + " chương";
    $("#chap-list").textContent = "";
    shown = 0;
    var start = Math.max(0, meta.pos - 3);
    shown = start;
    appendChapters(Math.max(PAGE, meta.pos + 20 - start));
    var li = $("#chap-list").querySelector("li.cur");
    if (li && li.scrollIntoView) li.scrollIntoView({ block: "center" });
  }

  function chapTitle(i) {
    var t = cur.meta.chapters[i][1];
    var d = TD.getDicts();
    var vi = t;
    try { vi = QT.translate(t, d, "auto"); } catch (e) { /* giữ nguyên */ }
    return { vi: vi, src: t };
  }

  function appendChapters(n) {
    var ul = $("#chap-list");
    var total = cur.meta.chapters.length;
    var end = Math.min(total, shown + n);
    var frag = document.createDocumentFragment();
    for (var i = shown; i < end; i++) {
      (function (i) {
        var li = document.createElement("li");
        if (i === cur.meta.pos) li.className = "cur";
        var box = document.createElement("div");
        box.className = "meta";
        var tt = chapTitle(i);
        var nm = document.createElement("div");
        nm.className = "nm";
        nm.textContent = tt.vi;
        box.appendChild(nm);
        if (tt.vi !== tt.src) {
          var sub = document.createElement("div");
          sub.className = "sub";
          sub.textContent = tt.src;
          box.appendChild(sub);
        }
        li.appendChild(box);
        li.addEventListener("click", function () { openChapter(i); });
        frag.appendChild(li);
      })(i);
    }
    ul.appendChild(frag);
    shown = end;
    $("#btn-chap-more").hidden = shown >= total;
  }

  function chapterText(i) {
    var r = Chapters.range(cur.meta.chapters, i, cur.text.length);
    return cur.text.slice(r[0], r[1]);
  }

  async function openChapter(i) {
    if (!cur) return;
    var n = cur.meta.chapters.length;
    if (i < 0 || i >= n) return;
    activeChap = i;
    web = null;
    cur.meta.pos = i;
    dbPutMeta(cur.meta).catch(function () { /* không quan trọng */ });
    TD.setSource(chapterText(i));
    TD.showTab("translate");
    await TD.go();
    updateNav();
  }

  function updateNav() {
    var nav = $("#book-nav");
    if (web) {
      nav.hidden = false;
      var host = "";
      try { host = new URL(web.url).hostname; } catch (e) { /* bỏ qua */ }
      $("#chap-label").textContent = host || "Trang web";
      $("#chap-prev").disabled = !web.prev;
      $("#chap-next").disabled = !web.next;
      return;
    }
    if (!cur || activeChap < 0) { nav.hidden = true; return; }
    nav.hidden = false;
    var n = cur.meta.chapters.length;
    $("#chap-label").textContent = "Chương " + (activeChap + 1) + "/" + n;
    $("#chap-prev").disabled = activeChap <= 0;
    $("#chap-next").disabled = activeChap >= n - 1;
  }

  /* ---------- dịch cả truyện ra file ---------- */
  function safeName(s) { return s.replace(/[\\/:*?"<>|]+/g, "_").trim() || "truyen"; }

  async function saveFile(name, text) {
    var cap = window.Capacitor;
    var P = cap && cap.Plugins;
    if (P && P.Filesystem) {
      var CH = 500000;
      var first = true;
      for (var i = 0; i < text.length;) {
        var end = Math.min(text.length, i + CH);
        var c = text.charCodeAt(end - 1);
        if (end < text.length && c >= 0xd800 && c <= 0xdbff) end--;
        var part = text.slice(i, end);
        if (first) await P.Filesystem.writeFile({ path: name, data: part, directory: "CACHE", encoding: "utf8" });
        else await P.Filesystem.appendFile({ path: name, data: part, directory: "CACHE", encoding: "utf8" });
        first = false;
        i = end;
        $("#book-prog").textContent = "Đang ghi file " + Math.round((i / text.length) * 100) + "%";
        await tick();
      }
      var u = await P.Filesystem.getUri({ path: name, directory: "CACHE" });
      if (P.Share) { await P.Share.share({ title: name, url: u.uri, dialogTitle: "Lưu bản dịch" }); return; }
    }
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 60000);
  }

  async function exportAll() {
    if (!cur || exporting) return;
    var ctl = { stop: false };
    exporting = ctl;
    $("#btn-book-export").hidden = true;
    $("#btn-book-stop").hidden = false;
    var settings = TD.getSettings();
    var d = TD.getDicts();
    var n = cur.meta.chapters.length;
    var parts = [];
    var t0 = Date.now();
    try {
      for (var i = 0; i < n; i++) {
        if (ctl.stop) break;
        var body = QT.translate(chapterText(i), d, settings.lang, true, TD.transOpts());
        parts.push(body);
        if (i % 5 === 4 || i === n - 1) {
          var el = (Date.now() - t0) / 1000;
          var eta = Math.round((el / (i + 1)) * (n - i - 1));
          $("#book-prog").textContent = "Đang dịch " + (i + 1) + "/" + n + " chương · còn khoảng " + eta + " giây";
          await tick();
        }
      }
      if (parts.length) {
        var out = parts.join("\n\n");
        var name = safeName(cur.meta.name) + "_vi" + (ctl.stop ? "_" + parts.length + "chuong" : "") + ".txt";
        await saveFile(name, out);
        TD.toast(ctl.stop ? "Đã dừng, lưu " + parts.length + " chương đã dịch" : "Đã dịch xong " + n + " chương");
      }
    } catch (e) {
      TD.toast("Lỗi: " + (e && e.message ? e.message : e));
    }
    $("#book-prog").textContent = "";
    $("#btn-book-export").hidden = false;
    $("#btn-book-stop").hidden = true;
    exporting = null;
  }

  /* ---------- dịch trang web ---------- */
  async function loadUrl(urlArg) {
    var url = (typeof urlArg === "string" ? urlArg : $("#url-in").value).trim();
    if (!url) { TD.toast("Dán link trang truyện vào ô trên"); return; }
    var btn = $("#btn-url");
    btn.disabled = true;
    $("#chap-prev").disabled = true;
    $("#chap-next").disabled = true;
    TD.toast("Đang tải trang...");
    try {
      var r = await WebText.loadUrl(url);
      $("#url-in").value = url;
      try { localStorage.setItem("td_url", url); } catch (e0) { /* bỏ qua */ }
      TD.setSource(r.text);
      activeChap = -1;
      web = { url: url, next: r.next, prev: r.prev, title: r.title };
      await TD.go();
      updateNav();
      if (!r.next && !r.prev) TD.toast("Không tìm thấy nút chương sau/trước trên trang này");
    } catch (e) {
      var m = (e && e.message) || String(e);
      if (/Failed to fetch|NetworkError|Load failed/i.test(m)) m = "Không tải được trang (mất mạng, hoặc trình duyệt chặn). Bản APK cài trên điện thoại sẽ tải được nhiều trang hơn.";
      TD.toast(m);
      updateNav();
    }
    btn.disabled = false;
  }

  /* ---------- gắn sự kiện ---------- */
  $("#btn-book-import").addEventListener("click", function () { $("#file-book").click(); });
  $("#file-book").addEventListener("change", function () {
    var f = this.files && this.files[0];
    this.value = "";
    if (f) importFile(f);
  });
  $("#btn-book-back").addEventListener("click", function () {
    if (exporting) exporting.stop = true;
    cur = null;
    $("#book-view").hidden = true;
    $("#book-home").hidden = false;
    renderBooks();
  });
  $("#btn-chap-more").addEventListener("click", function () { appendChapters(PAGE); });
  $("#btn-book-goto").addEventListener("click", function () {
    var n = parseInt($("#book-goto").value, 10);
    if (!cur || !n || n < 1 || n > cur.meta.chapters.length) { TD.toast("Số chương không hợp lệ"); return; }
    openChapter(n - 1);
  });
  $("#btn-book-export").addEventListener("click", exportAll);
  $("#btn-book-stop").addEventListener("click", function () { if (exporting) exporting.stop = true; });
  $("#chap-prev").addEventListener("click", function () {
    if (web) { if (web.prev) loadUrl(web.prev); } else openChapter(activeChap - 1);
  });
  $("#chap-next").addEventListener("click", function () {
    if (web) { if (web.next) loadUrl(web.next); } else openChapter(activeChap + 1);
  });
  $("#btn-url").addEventListener("click", function () { loadUrl(); });
  $("#url-in").addEventListener("keydown", function (e) { if (e.key === "Enter") loadUrl(); });
  // dịch văn bản tự nhập thì không còn thuộc chương nào
  $("#btn-go").addEventListener("click", function () { activeChap = -1; web = null; updateNav(); }, true);
  try { var lastUrl = localStorage.getItem("td_url"); if (lastUrl) $("#url-in").value = lastUrl; } catch (e1) { /* bỏ qua */ }

  window.Books = { importFile: importFile };
  renderBooks().catch(function () { /* kho chưa sẵn sàng */ });
})();
