/*
 * webtext.js - Tải một trang web và lấy phần chữ chính của truyện.
 * Trong APK (Capacitor) gọi mạng bằng plugin gốc nên không bị chặn CORS; trong trình duyệt thường sẽ bị chặn.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.WebText = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var UA = "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36";

  function decode(bytes, contentType) {
    var cs = null;
    var m = /charset=([\w-]+)/i.exec(contentType || "");
    if (m) cs = m[1];
    if (!cs) {
      var head = "";
      var n = Math.min(bytes.length, 4000);
      for (var i = 0; i < n; i++) head += String.fromCharCode(bytes[i]);
      m = /charset\s*=\s*["']?([\w-]+)/i.exec(head);
      if (m) cs = m[1];
    }
    cs = (cs || "utf-8").toLowerCase();
    if (/^(gbk|gb2312|x-gbk|gb18030)$/.test(cs)) cs = "gb18030";
    try { return new TextDecoder(cs).decode(bytes); } catch (e) { return new TextDecoder("utf-8").decode(bytes); }
  }

  function b64ToBytes(b64) {
    var bin = atob(b64);
    var u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }

  // Tải về dạng byte. Trả { bytes: Uint8Array, contentType }
  async function fetchBytes(url) {
    if (!/^https?:\/\//i.test(url)) throw new Error("Link phải bắt đầu bằng http:// hoặc https://");
    var cap = typeof window !== "undefined" ? window.Capacitor : null;
    var http = cap && cap.Plugins && cap.Plugins.CapacitorHttp;
    if (http && http.request) {
      var r = await http.request({ url: url, method: "GET", responseType: "arraybuffer", headers: { "User-Agent": UA, Accept: "text/html,*/*" } });
      if (r.status >= 400) throw new Error("Trang trả về lỗi HTTP " + r.status);
      var ct = r.headers && (r.headers["Content-Type"] || r.headers["content-type"]);
      return { bytes: typeof r.data === "string" ? b64ToBytes(r.data) : new Uint8Array(r.data), contentType: ct };
    }
    var resp = await fetch(url);
    if (!resp.ok) throw new Error("Trang trả về lỗi HTTP " + resp.status);
    return { bytes: new Uint8Array(await resp.arrayBuffer()), contentType: resp.headers.get("content-type") };
  }

  async function fetchHtml(url) {
    var r = await fetchBytes(url);
    return decode(r.bytes, r.contentType);
  }

  var BLOCK = { P: 1, DIV: 1, LI: 1, H1: 1, H2: 1, H3: 1, H4: 1, TR: 1, SECTION: 1, ARTICLE: 1 };
  var NAV_LINE = /^(上一[章页頁篇节]|下一[章页頁篇节]|目录|目錄|返回|加入书签|加入書籤|投票推荐|推荐票|章节错误|章節錯誤|Previous|Next|Table of Contents)/i;

  function walk(node, out) {
    if (node.nodeType === 3) { out.push(node.nodeValue); return; }
    if (node.nodeType !== 1) return;
    var tag = node.tagName;
    if (tag === "BR") { out.push("\n"); return; }
    var block = BLOCK[tag];
    if (block) out.push("\n");
    for (var c = node.firstChild; c; c = c.nextSibling) walk(c, out);
    if (block) out.push("\n");
  }

  function textOf(el) {
    var out = [];
    walk(el, out);
    return out.join("");
  }

  function score(el) {
    var s = 0;
    for (var c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) s += c.nodeValue.trim().length;
      else if (c.nodeType === 1 && c.tagName === "P") s += c.textContent.trim().length;
    }
    return s;
  }

  function clean(t) {
    var lines = t.replace(/[ 　]/g, " ").split("\n");
    var res = [];
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i].trim();
      if (l && !NAV_LINE.test(l)) res.push(l);
    }
    return res.join("\n");
  }

  var RE_NEXT = /^\s*(下一[章页頁篇节節張张]|下[页頁]|下一|Next(\s+Chapter)?|Tiếp(\s+theo)?|Chương\s+sau|Sau)\s*[>›»→]?\s*$/i;
  var RE_PREV = /^\s*[<‹«←]?\s*(上一[章页頁篇节節張张]|上[页頁]|上一|Prev(ious)?(\s+Chapter)?|Trước|Chương\s+trước)\s*$/i;

  function findLinks(doc, baseUrl) {
    var res = { next: "", prev: "" };
    function abs(h) {
      if (!h || /^(javascript:|#|mailto:)/i.test(h.trim())) return "";
      try { return new URL(h, baseUrl).href; } catch (e) { return ""; }
    }
    var rn = doc.querySelector('link[rel="next"], a[rel="next"]');
    var rp = doc.querySelector('link[rel="prev"], a[rel="prev"]');
    if (rn) res.next = abs(rn.getAttribute("href"));
    if (rp) res.prev = abs(rp.getAttribute("href"));
    var as = doc.querySelectorAll("a[href]");
    for (var i = 0; i < as.length; i++) {
      var t = (as[i].textContent || "").replace(/[\s\u3000]+/g, " ").trim();
      if (!t || t.length > 20) continue;
      if (!res.next && RE_NEXT.test(t)) res.next = abs(as[i].getAttribute("href"));
      else if (!res.prev && RE_PREV.test(t)) res.prev = abs(as[i].getAttribute("href"));
    }
    return res;
  }

  function extract(html, baseUrl) {
    return parse(html, baseUrl).text;
  }

  function parse(html, baseUrl) {
    var doc = new DOMParser().parseFromString(html, "text/html");
    var links = findLinks(doc, baseUrl || "http://localhost/");
    ["script", "style", "noscript", "nav", "header", "footer", "aside", "form", "iframe", "svg", "button", "select"].forEach(function (t) {
      var els = doc.querySelectorAll(t);
      for (var i = 0; i < els.length; i++) els[i].remove();
    });
    var best = null;
    var bestScore = 0;
    var cands = doc.querySelectorAll("div, article, section, main, td, body");
    for (var i = 0; i < cands.length; i++) {
      var sc = score(cands[i]);
      if (sc > bestScore) { bestScore = sc; best = cands[i]; }
    }
    var text = clean(textOf(bestScore >= 50 && best ? best : doc.body));
    var h1 = doc.querySelector("h1");
    var title = h1 ? h1.textContent.trim() : "";
    if (title && text.indexOf(title) < 0) text = title + "\n" + text;
    return { text: text, next: links.next, prev: links.prev, title: title };
  }

  // Trả { text, next, prev, title, url }
  async function loadUrl(url) {
    url = url.trim();
    var html = await fetchHtml(url);
    var r = parse(html, url);
    if (r.text.replace(/\s+/g, "").length < 30) throw new Error("Không tìm thấy nội dung truyện trong trang này (có thể trang cần đăng nhập hoặc tải bằng JavaScript)");
    r.url = url;
    return r;
  }

  return { decode: decode, extract: extract, parse: parse, fetchBytes: fetchBytes, fetchHtml: fetchHtml, loadUrl: loadUrl };
});
