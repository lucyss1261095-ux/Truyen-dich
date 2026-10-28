/*
 * engine.js - Lõi dịch offline kiểu Quick Translator.
 *  - Tiếng Trung: khớp cụm dài nhất theo thứ tự Tên riêng > Cụm từ (VietPhrase) > Hán-Việt từng chữ.
 *  - Tiếng Anh: khớp cụm/từ theo từ điển Anh-Việt do người dùng nạp.
 * Định dạng từ điển (.txt, UTF-8): mỗi dòng "gốc=nghĩa1/nghĩa2". Dòng bắt đầu bằng # là ghi chú.
 * Nghĩa rỗng ("着=") nghĩa là bỏ qua từ đó khi dịch.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.QT = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var MAX_ZH = 24; // độ dài cụm tối đa khi khớp (ký tự)
  var MAX_EN = 6; // số từ tối đa của một cụm tiếng Anh

  function createDicts() {
    return {
      names: new Map(),
      phrases: new Map(),
      hanviet: new Map(),
      en: new Map(),
      rules: new Map(), // Luật nhân: mẫu -> thay thế
      rulesCache: null,
      maxZh: 1,
      maxEn: 1
    };
  }

  function mapFor(d, type) {
    return type === "user" ? d.names : d[type];
  }

  // Nạp một đoạn văn bản từ điển vào d. type: names | phrases | hanviet | en | rules | user
  function parseInto(d, type, text) {
    var map = mapFor(d, type);
    var count = 0;
    if (!map) return 0;
    if (type === "rules") d.rulesCache = null;
    var isEn = type === "en";
    var lines = text.split("\n");
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li];
      if (li === 0 && line.charCodeAt(0) === 0xfeff) line = line.slice(1);
      if (line.charCodeAt(line.length - 1) === 13) line = line.slice(0, -1);
      if (!line || line.charAt(0) === "#") continue;
      var idx = line.indexOf("=");
      if (idx < 0) idx = line.indexOf("\t");
      if (idx < 0) idx = line.indexOf("|");
      if (idx <= 0) continue;
      var k = line.slice(0, idx).trim();
      if (!k) continue;
      var v = line.slice(idx + 1).trim();
      if (isEn) {
        k = k.toLowerCase().replace(/\s+/g, " ");
        var wc = k.split(" ").length;
        if (wc > d.maxEn) d.maxEn = Math.min(wc, MAX_EN);
      } else if (type !== "hanviet" && type !== "rules") {
        if (k.length > d.maxZh) d.maxZh = Math.min(k.length, MAX_ZH);
      }
      map.set(k, v);
      count++;
    }
    return count;
  }

  // Lấy nghĩa đầu tiên trong "nghĩa1/nghĩa2/..."
  function first(v) {
    var i = v.indexOf("/");
    return (i < 0 ? v : v.slice(0, i)).trim();
  }

  function isHan(cp) {
    return (
      (cp >= 0x4e00 && cp <= 0x9fff) ||
      (cp >= 0x3400 && cp <= 0x4dbf) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0x20000 && cp <= 0x2fa1f) ||
      cp === 0x3007
    );
  }

  function normalizeWidth(s) {
    return s.replace(/[０-９Ａ-Ｚａ-ｚ]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xfee0);
    });
  }

  function detectLang(text) {
    var s = text.slice(0, 5000);
    var han = (s.match(/[㐀-鿿豈-﫿]/g) || []).length;
    var latin = (s.match(/[A-Za-z]/g) || []).length;
    if (han > 0 && han / (han + latin) > 0.15) return "zh";
    return "en";
  }

  // [loại, ký tự đầu ra]. pc = dấu đóng/ngắt câu, po = mở ngoặc/ngoặc kép, qc = đóng ngoặc kép, w = như một từ
  var PUNCT = {
    "，": ["pc", ","], "、": ["pc", ","], "。": ["pc", "."], "！": ["pc", "!"],
    "？": ["pc", "?"], "：": ["pc", ":"], "；": ["pc", ";"],
    "…": ["pc", "..."], "‥": ["pc", ".."],
    "“": ["po", '"'], "‘": ["po", '"'], "「": ["po", '"'], "『": ["po", '"'],
    "《": ["po", '"'], "〈": ["po", '"'],
    "”": ["qc", '"'], "’": ["qc", '"'], "」": ["qc", '"'], "』": ["qc", '"'],
    "》": ["qc", '"'], "〉": ["qc", '"'],
    "（": ["po", "("], "(": ["po", "("], "）": ["pc", ")"], ")": ["pc", ")"],
    "【": ["po", "["], "[": ["po", "["], "】": ["pc", "]"], "]": ["pc", "]"],
    "—": ["w", "—"], "－": ["w", "-"], "～": ["w", "~"], "·": ["w", "·"],
    ",": ["pc", ","], ".": ["pc", "."], "!": ["pc", "!"], "?": ["pc", "?"], ":": ["pc", ":"], ";": ["pc", ";"]
  };

  var RE_ALNUM = /[A-Za-z0-9]+(?:[.,'’\-][A-Za-z0-9]+)*/y;

  function pushPunct(toks, ch, state) {
    if (ch === '"') {
      toks.push({ k: state.quoteOpen ? "qc" : "po", t: '"', s: ch });
      state.quoteOpen = !state.quoteOpen;
      return;
    }
    var p = PUNCT[ch];
    if (p) {
      var last = toks[toks.length - 1];
      // gộp dấu ba chấm / gạch dài lặp lại
      if (last && last.t === p[1] && (p[1] === "..." || p[1] === "—")) return;
      toks.push({ k: p[0], t: p[1], s: ch });
    } else {
      toks.push({ k: "w", t: ch, s: ch, kind: "x" });
    }
  }

  // Hiện nhiều nghĩa kiểu Quick Translator: [nghĩa1/nghĩa2]
  function show(v, multi) {
    if (!multi || v.indexOf("/") < 0) return first(v);
    var a = v.split("/").map(function (x) { return x.trim(); }).filter(Boolean);
    return a.length > 1 ? "[" + a.join("/") + "]" : first(v);
  }

  function tokenizeZh(text, d, opts) {
    var hvOnly = !!(opts && opts.mode === "hv");
    var multi = !!(opts && opts.multi);
    text = normalizeWidth(text);
    var toks = [];
    var n = text.length;
    var i = 0;
    var state = { quoteOpen: false };
    var maxL = d.maxZh;
    while (i < n) {
      var cp = text.codePointAt(i);
      var w = cp > 0xffff ? 2 : 1;
      var ch = text.substr(i, w);
      if (ch === "\n") { toks.push({ k: "nl", t: "\n", s: "\n" }); i++; continue; }
      if (/\s/.test(ch)) { i += w; continue; }
      if (isHan(cp)) {
        var j = i;
        while (j < n) {
          var c2 = text.codePointAt(j);
          if (!isHan(c2)) break;
          j += c2 > 0xffff ? 2 : 1;
        }
        var hit = null;
        for (var L = hvOnly ? 0 : Math.min(maxL, j - i); L >= 1; L--) {
          var sub = text.substr(i, L);
          var v = d.names.get(sub);
          if (v !== undefined) { hit = { kind: "n", s: sub, v: v }; break; }
          v = d.phrases.get(sub);
          if (v !== undefined) { hit = { kind: "p", s: sub, v: v }; break; }
        }
        if (hit) {
          toks.push({ k: "w", kind: hit.kind, s: hit.s, t: show(hit.v, multi), alts: hit.v });
          i += hit.s.length;
          continue;
        }
        var hv = d.hanviet.get(ch);
        if (hv !== undefined) toks.push({ k: "w", kind: "h", s: ch, t: first(hv).toLowerCase(), alts: hv });
        else toks.push({ k: "w", kind: "x", s: ch, t: ch });
        i += w;
        continue;
      }
      if (/[A-Za-z0-9]/.test(ch)) {
        RE_ALNUM.lastIndex = i;
        var m = RE_ALNUM.exec(text);
        if (m) {
          toks.push({ k: "w", kind: "x", s: m[0], t: m[0] });
          i += m[0].length;
          continue;
        }
      }
      pushPunct(toks, ch, state);
      i += w;
    }
    return toks;
  }

  function stems(w) {
    var r = [];
    if (w.length > 4 && w.slice(-3) === "ies") r.push(w.slice(0, -3) + "y");
    if (w.length > 3 && w.slice(-2) === "es") r.push(w.slice(0, -2));
    if (w.length > 3 && w.slice(-1) === "s") r.push(w.slice(0, -1));
    if (w.length > 4 && w.slice(-2) === "ed") { r.push(w.slice(0, -2)); r.push(w.slice(0, -1)); }
    if (w.length > 5 && w.slice(-3) === "ing") { r.push(w.slice(0, -3)); r.push(w.slice(0, -3) + "e"); }
    if (w.length > 4 && w.slice(-2) === "ly") r.push(w.slice(0, -2));
    return r;
  }

  var RE_EN_WORD = /^[A-Za-zÀ-ɏ]/;

  function tokenizeEn(text, d) {
    var re = /[A-Za-zÀ-ɏ]+(?:['’][A-Za-z]+)*|\d+(?:[.,]\d+)*|\n|[^\sA-Za-z\d]/g;
    var items = text.match(re) || [];
    var n = items.length;
    var toks = [];
    var state = { quoteOpen: false };
    for (var i = 0; i < n; i++) {
      var it = items[i];
      if (it === "\n") { toks.push({ k: "nl", t: "\n", s: "\n" }); continue; }
      if (RE_EN_WORD.test(it)) {
        var run = 1;
        while (i + run < n && run < d.maxEn && RE_EN_WORD.test(items[i + run])) run++;
        var hit = null;
        for (var L = run; L >= 1 && !hit; L--) {
          var phrase = items.slice(i, i + L).join(" ");
          var key = phrase.toLowerCase();
          var v = d.en.get(key);
          if (v === undefined && L === 1) {
            var st = stems(key);
            for (var q = 0; q < st.length; q++) {
              v = d.en.get(st[q]);
              if (v !== undefined) break;
            }
          }
          if (v !== undefined) hit = { L: L, s: phrase, v: v };
        }
        if (hit) {
          toks.push({ k: "w", kind: "p", s: hit.s, t: first(hit.v), alts: hit.v });
          i += hit.L - 1;
        } else {
          toks.push({ k: "w", kind: "x", s: it, t: it });
        }
        continue;
      }
      if (/^\d/.test(it)) { toks.push({ k: "w", kind: "x", s: it, t: it }); continue; }
      pushPunct(toks, it, state);
    }
    return toks;
  }

  var RE_LETTER = /^\p{L}/u;

  function cap(t) {
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  // Ghép token thành các đoạn chữ có khoảng trắng, viết hoa đầu câu.
  function layout(toks) {
    var segs = [];
    var needSpace = false;
    var capNext = true;
    var afterColon = false;
    for (var i = 0; i < toks.length; i++) {
      var tk = toks[i];
      var t = tk.t;
      var text;
      if (tk.k === "nl") {
        segs.push({ text: "\n", nl: true });
        needSpace = false; capNext = true; afterColon = false;
        continue;
      }
      if (t === "") continue;
      if (tk.k === "w") {
        if (capNext && RE_LETTER.test(t.replace(/^\[/, ""))) { t = t.charAt(0) === "[" ? "[" + cap(t.slice(1)) : cap(t); capNext = false; }
        text = (needSpace ? " " : "") + t;
        needSpace = true; afterColon = false;
      } else if (tk.k === "po") {
        text = (needSpace ? " " : "") + t;
        needSpace = false;
        if (afterColon) capNext = true;
        afterColon = false;
      } else if (tk.k === "qc") {
        text = t;
        needSpace = true; afterColon = false;
      } else {
        text = t;
        needSpace = true;
        afterColon = t === ":";
        if (t === "." || t === "!" || t === "?") capNext = true;
      }
      segs.push({ text: text, src: tk.s, kind: tk.kind || tk.k, alts: tk.alts });
    }
    return segs;
  }


  /* ---------- Luật nhân (LuatNhan.txt) ----------
   * Mẫu: {0}的{1}={1} của {0}. Chữ Hán trong mẫu phải khớp đúng các từ đã tách; mỗi {n} khớp đúng một từ.
   * Áp dụng trên chuỗi từ đã tách, rồi mới ghép câu.
   */
  function c0(str) { return String.fromCodePoint(str.codePointAt(0)); }

  function splitParts(str) {
    var out = [];
    var re = /\{(\d+)\}/g;
    var last = 0;
    var m;
    while ((m = re.exec(str)) !== null) {
      if (m.index > last) out.push({ lit: str.slice(last, m.index) });
      out.push({ ph: +m[1] });
      last = m.index + m[0].length;
    }
    if (last < str.length) out.push({ lit: str.slice(last) });
    return out;
  }

  function compileRules(d) {
    if (d.rulesCache) return d.rulesCache;
    var R = { byFirst: {}, byPh: {}, any: false };
    d.rules.forEach(function (rep, pat) {
      var parts = splitParts(normalizeWidth(pat.trim()));
      if (!parts.length) return;
      var lits = 0;
      var phs = {};
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].lit !== undefined) lits += parts[i].lit.length;
        else {
          if (i > 0 && parts[i - 1].ph !== undefined) return; // hai {n} liền nhau: mơ hồ, bỏ qua
          phs[parts[i].ph] = 1;
        }
      }
      if (!lits) return;
      var out = splitParts(first(rep));
      for (var q = 0; q < out.length; q++) {
        if (out[q].ph !== undefined && !phs[out[q].ph]) return; // thay thế dùng {n} không có trong mẫu
        if (out[q].lit !== undefined) out[q].lit = out[q].lit.trim();
      }
      var rule = { parts: parts, out: out, rank: lits * 10 + parts.length };
      var bucket;
      if (parts[0].ph !== undefined) {
        if (parts.length < 2) return;
        bucket = R.byPh;
        var key = c0(parts[1].lit);
        (bucket[key] = bucket[key] || []).push(rule);
      } else {
        bucket = R.byFirst;
        var key2 = c0(parts[0].lit);
        (bucket[key2] = bucket[key2] || []).push(rule);
      }
      R.any = true;
    });
    [R.byFirst, R.byPh].forEach(function (b) {
      for (var k in b) b[k].sort(function (a, z) { return z.rank - a.rank; });
    });
    d.rulesCache = R;
    return R;
  }

  function matchRule(rule, toks, i) {
    var caps = {};
    var pos = i;
    var parts = rule.parts;
    for (var pi = 0; pi < parts.length; pi++) {
      var part = parts[pi];
      var t = toks[pos];
      if (!t || t.k !== "w" || !t.s) return null;
      if (part.ph !== undefined) {
        caps[part.ph] = t;
        pos++;
      } else {
        var lit = part.lit;
        var acc = "";
        while (acc.length < lit.length) {
          t = toks[pos];
          if (!t || t.k !== "w" || !t.s) return null;
          acc += t.s;
          pos++;
          if (lit.indexOf(acc) !== 0) return null;
        }
        if (acc !== lit) return null;
      }
    }
    return { end: pos, caps: caps, rule: rule };
  }

  function firstMatch(list, toks, i) {
    if (!list) return null;
    for (var q = 0; q < list.length; q++) {
      var m = matchRule(list[q], toks, i);
      if (m) return m;
    }
    return null;
  }

  function applyRules(toks, d) {
    var R = compileRules(d);
    if (!R.any) return toks;
    var out = [];
    var i = 0;
    var n = toks.length;
    while (i < n) {
      var tk = toks[i];
      var best = null;
      if (tk.k === "w" && tk.s) {
        best = firstMatch(R.byFirst[c0(tk.s)], toks, i);
        if (i + 1 < n && toks[i + 1].k === "w" && toks[i + 1].s) {
          var m2 = firstMatch(R.byPh[c0(toks[i + 1].s)], toks, i);
          if (m2 && (!best || m2.rule.rank > best.rule.rank)) best = m2;
        }
      }
      if (!best) { out.push(tk); i++; continue; }
      var o = best.rule.out;
      for (var q = 0; q < o.length; q++) {
        if (o[q].ph !== undefined) out.push(best.caps[o[q].ph]);
        else if (o[q].lit) out.push({ k: "w", kind: "r", s: "", t: o[q].lit });
      }
      i = best.end;
    }
    return out;
  }

  function translateSegments(text, d, lang, opts) {
    opts = opts || {};
    if (!lang || lang === "auto") lang = detectLang(text);
    var toks;
    if (lang === "zh") {
      toks = tokenizeZh(text, d, opts);
      if (opts.mode !== "hv" && opts.rules !== false && d.rules.size) toks = applyRules(toks, d);
    } else toks = tokenizeEn(text, d);
    return layout(toks);
  }

  // spaced = true: cách một dòng trống giữa các đoạn
  function segsToText(segs, spaced) {
    var out = [];
    var prevNl = false;
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (s.nl) {
        if (spaced) { if (!prevNl) out.push("\n\n"); } else out.push("\n");
        prevNl = true;
      } else {
        out.push(s.text);
        prevNl = false;
      }
    }
    return out.join("").replace(/^\n+/, "").replace(/\n+$/, "");
  }

  function translate(text, d, lang, spaced, opts) {
    return segsToText(translateSegments(text, d, lang, opts), spaced);
  }

  function hanvietOf(s, d) {
    return Array.from(s)
      .map(function (c) {
        var v = d.hanviet.get(c);
        return v === undefined ? c : first(v).toLowerCase();
      })
      .join(" ");
  }

  function stats(d) {
    return { names: d.names.size, phrases: d.phrases.size, hanviet: d.hanviet.size, en: d.en.size, rules: d.rules.size };
  }

  return {
    createDicts: createDicts,
    parseInto: parseInto,
    translateSegments: translateSegments,
    segsToText: segsToText,
    translate: translate,
    detectLang: detectLang,
    hanvietOf: hanvietOf,
    first: first,
    stats: stats
  };
});
