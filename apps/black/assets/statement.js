/* BLACK bank statements: reads OFX / QFX / QBO, bank-style CSV or Excel exports, and text PDFs in the browser.
 * Nothing is stored. Only a compact summary (account numbers masked) goes with the brief.
 * Exposes window.BLACK_STMT = { isStatementFile, parseOfx, fromSheet, parsePdf, sheetFor, promptBlock, HELP }.
 */
(function () {
  "use strict";
  var PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
  var PDF_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  var MAX_PAGES = 15, MAX_TXNS = 60, MAX_TEXT = 7000, MAX_CHARS = 11000;
  var HELP = "Download a statement: in your bank’s website or app, open the account → <b>Statements</b> or <b>Activity</b> → <b>Download</b>, then pick CSV, OFX/QFX (Quicken) or PDF. " +
    'Bank help: <a href="https://www.wellsfargo.com/help/online-banking/statement-faqs/" target="_blank" rel="noopener">Wells Fargo</a> · ' +
    '<a href="https://www.usbank.com/customer-service/knowledge-base/KB0069323.html" target="_blank" rel="noopener">U.S. Bank</a> · ' +
    '<a href="https://www.americanexpress.com/us/customer-service/faq.download-export-transactions-software.html" target="_blank" rel="noopener">American Express</a>. ' +
    "Read in your browser; only a summary with account numbers masked goes with your brief, and nothing is stored.";

  // ---------- helpers ----------
  function mask(s) {
    return String(s == null ? "" : s)
      .replace(/\b(?:\d[ -]?){12,19}\b/g, function (m) { var d = m.replace(/\D/g, ""); return "••" + d.slice(-4); })
      .replace(/\b\d{6,}\b/g, function (m) { return "••" + m.slice(-4); });
  }
  function amt(v) {
    if (typeof v === "number") return isFinite(v) ? v : null;
    var s = String(v == null ? "" : v).trim(); if (!s) return null;
    var neg = /^\(.*\)$/.test(s) || /^-|-$|\bDR\b/i.test(s);
    var n = parseFloat(s.replace(/[^\d.]/g, ""));
    return isFinite(n) ? (neg ? -n : n) : null;
  }
  function date(v) {
    if (v instanceof Date) return isNaN(v) ? null : v;
    var s = String(v == null ? "" : v).trim();
    var m = /^(\d{4})(\d{2})(\d{2})/.exec(s); // OFX 20261003120000
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/.exec(s); // 10/03/2026
    if (m) return new Date(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[1] - 1, +m[2]);
    var d = new Date(s); return isNaN(d) ? null : d;
  }
  function day(d) { return d ? d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" }) : ""; }
  function money(v, cur) {
    if (v == null) return "";
    var s = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (v < 0 ? "−" : "") + (cur && cur !== "USD" ? cur + " " : "$") + s;
  }
  function cap(w) { w = String(w).toLowerCase(); return w.charAt(0).toUpperCase() + w.slice(1); }
  function payee(desc) { return String(desc || "").replace(/[#*]?\d[\d\/.-]*/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 3).join(" ").toUpperCase() || "OTHER"; }

  // ---------- OFX / QFX / QBO ----------
  function tag(src, t) { var m = new RegExp("<" + t + ">([^<\\r\\n]*)", "i").exec(src); return m ? m[1].trim() : ""; }
  function parseOfx(txt) {
    var txns = [], re = /<STMTTRN>([\s\S]*?)(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>)/gi, m;
    while ((m = re.exec(txt))) {
      var b = m[1], a = amt(tag(b, "TRNAMT"));
      if (a == null) continue;
      txns.push({ d: date(tag(b, "DTPOSTED")), desc: mask((tag(b, "NAME") + " " + tag(b, "MEMO")).trim()), amt: a });
    }
    var led = /<LEDGERBAL>([\s\S]*?)(<\/LEDGERBAL>|<AVAILBAL>|$)/i.exec(txt), av = /<AVAILBAL>([\s\S]*?)(<\/AVAILBAL>|$)/i.exec(txt);
    var st = {
      source: "OFX", bank: tag(txt, "ORG"), account: mask(tag(txt, "ACCTID")), type: /<CCSTMTRS>/i.test(txt) ? "Credit card" : cap(tag(txt, "ACCTTYPE") || "Bank"),
      currency: tag(txt, "CURDEF") || "USD", from: date(tag(txt, "DTSTART")), to: date(tag(txt, "DTEND")),
      closing: led ? amt(tag(led[1], "BALAMT")) : null, available: av ? amt(tag(av[1], "BALAMT")) : null, txns: txns
    };
    return finish(st);
  }

  // ---------- CSV / Excel that looks like a bank export ----------
  function col(header, re) { for (var i = 0; i < header.length; i++) if (re.test(String(header[i]).toLowerCase())) return i; return -1; }
  function fromSheet(sheet) {
    var h = sheet.header;
    var di = col(h, /date|posted/), si = col(h, /desc|payee|merchant|narrat|details|memo|^name|transaction$/);
    var ai = col(h, /^amount|amount$|^amt/), de = col(h, /debit|withdraw|paid out|money out/), cr = col(h, /credit|deposit|paid in|money in/), bi = col(h, /balance/);
    if (di < 0 || (ai < 0 && (de < 0 || cr < 0))) return null;
    var txns = [], bal = [];
    sheet.data.forEach(function (r) {
      var a = ai >= 0 ? amt(r[ai]) : (amt(r[cr]) || 0) - Math.abs(amt(r[de]) || 0);
      var d = date(r[di]);
      if (a == null || !d) return;
      txns.push({ d: d, desc: mask(si >= 0 ? r[si] : ""), amt: a });
      if (bi >= 0 && amt(r[bi]) != null) bal.push({ d: d, b: amt(r[bi]), a: a });
    });
    if (txns.length < 2) return null;
    var st = { source: "CSV", txns: txns, currency: "USD" };
    if (bal.length) {
      // Rows on the same day keep file order; files are usually newest-first or oldest-first.
      var newestFirst = bal[0].d >= bal[bal.length - 1].d;
      st.closing = newestFirst ? bal[0].b : bal[bal.length - 1].b;
      var first = newestFirst ? bal[bal.length - 1] : bal[0];
      st.opening = +(first.b - first.a).toFixed(2);
    }
    return finish(st);
  }

  // ---------- PDF (text-based statements) ----------
  var pdfLib = null;
  function loadPdf() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (pdfLib) return pdfLib;
    pdfLib = new Promise(function (res, rej) {
      var s = document.createElement("script"); s.src = PDFJS; s.async = true;
      s.onload = function () { if (!window.pdfjsLib) return rej(new Error("lib")); window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER; res(window.pdfjsLib); };
      s.onerror = function () { pdfLib = null; rej(new Error("lib")); };
      document.head.appendChild(s);
    });
    return pdfLib;
  }
  function parsePdf(buf) {
    return loadPdf().then(function (lib) { return lib.getDocument({ data: buf }).promise; }).then(function (doc) {
      var pages = Math.min(doc.numPages, MAX_PAGES), jobs = [];
      for (var i = 1; i <= pages; i++) jobs.push(doc.getPage(i).then(function (p) { return p.getTextContent(); }));
      return Promise.all(jobs).then(function (contents) {
        var lines = [];
        contents.forEach(function (c) {
          var rows = {};
          c.items.forEach(function (it) { var y = Math.round(it.transform[5]); (rows[y] = rows[y] || []).push(it); });
          Object.keys(rows).map(Number).sort(function (a, b) { return b - a; }).forEach(function (y) {
            var t = rows[y].sort(function (a, b) { return a.transform[4] - b.transform[4]; }).map(function (x) { return x.str; }).join(" ").replace(/\s+/g, " ").trim();
            if (t) lines.push(t);
          });
        });
        var text = mask(lines.join("\n"));
        if (text.replace(/\s/g, "").length < 80) { var e = new Error("scan"); throw e; }
        var bal = function (re) { var m = re.exec(text); return m ? amt(m[2]) : null; };
        var MONEY = "(-?\\$?\\(?[\\d,]+\\.\\d{2}\\)?)";
        var txns = [];
        lines.forEach(function (l) {
          var m = /^(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s+(.+?)\s+(-?\$?\(?[\d,]+\.\d{2}\)?)(?:\s+-?\$?[\d,]+\.\d{2})?$/.exec(l);
          if (m) txns.push({ d: null, ds: m[1], desc: mask(m[2]).slice(0, 80), amt: amt(m[3]), unsigned: !/[-(]/.test(m[3]) });
        });
        var st = {
          source: "PDF", pages: doc.numPages, text: text.slice(0, MAX_TEXT), textCut: text.length > MAX_TEXT,
          opening: bal(new RegExp("(beginning|opening|previous|starting) balance[^\\d\\-$(]*" + MONEY, "i")),
          closing: bal(new RegExp("(ending|closing|new|current) balance[^\\d\\-$(]*" + MONEY, "i")),
          account: (/(account|acct)[^\n]{0,30}?(••\d{4})/i.exec(text) || [])[2] || "", txns: txns, currency: "USD"
        };
        st.n = txns.length;
        return st;
      });
    });
  }

  // ---------- summary ----------
  function finish(st) {
    var t = st.txns.filter(function (x) { return x.amt != null; });
    st.txns = t.sort(function (a, b) { return (b.d || 0) - (a.d || 0); });
    st.n = t.length;
    st.in = sum(t.filter(function (x) { return x.amt > 0; }));
    st.out = sum(t.filter(function (x) { return x.amt < 0; }));
    st.fees = sum(t.filter(function (x) { return x.amt < 0 && /\b(fee|charge|overdraft|interest charged|service chg)\b/i.test(x.desc); }));
    if (!st.from && t.length) st.from = t[t.length - 1].d;
    if (!st.to && t.length) st.to = t[0].d;
    var g = {};
    t.forEach(function (x) { if (x.amt < 0) { var k = payee(x.desc); g[k] = (g[k] || 0) + x.amt; } });
    st.top = Object.keys(g).map(function (k) { return [k, g[k]]; }).sort(function (a, b) { return a[1] - b[1]; }).slice(0, 8);
    st.big = t.filter(function (x) { return x.amt < 0; }).sort(function (a, b) { return a.amt - b.amt; }).slice(0, 5);
    return st;
  }
  function sum(a) { return +a.reduce(function (n, x) { return n + x.amt; }, 0).toFixed(2); }
  function label(st) { return (st.bank ? st.bank + " · " : "") + (st.type ? st.type + " " : "") + (st.account ? "account " + st.account : st.bank || st.type ? "statement" : "Bank statement"); }

  // Preview table for the attach tray.
  function sheetFor(st) {
    var data = st.txns.slice(0, MAX_TXNS).map(function (x) { return [x.d ? day(x.d) : x.ds || "", x.desc, money(x.amt, st.currency)]; });
    return { name: "Statement", rows: data.length, cols: 3, header: ["Date", "Description", "Amount"], data: data, stats: [] };
  }

  function promptBlock(st, name) {
    var cur = st.currency, o = ["[Attached bank statement: " + name + " · " + label(st) + (st.from || st.to ? " · " + day(st.from) + " to " + day(st.to) : "") +
      " · " + st.n + " transactions" + (st.pages ? " · " + st.pages + "-page PDF" : "") + " · read in the user's browser, account numbers masked]"];
    var facts = [];
    if (st.opening != null) facts.push("Opening balance " + money(st.opening, cur));
    if (st.closing != null) facts.push("Closing balance " + money(st.closing, cur));
    if (st.available != null) facts.push("Available " + money(st.available, cur));
    if (st.source !== "PDF") facts.push("Money in " + money(st.in, cur), "Money out " + money(st.out, cur), "Net " + money(+(st.in + st.out).toFixed(2), cur), "Fees " + money(st.fees, cur));
    if (facts.length) o.push(facts.join(" · "));
    if (st.source !== "PDF" && st.top.length) o.push("Top spending by payee: " + st.top.map(function (x) { return x[0] + " " + money(x[1], cur); }).join("; "));
    if (st.source !== "PDF" && st.big.length) o.push("Largest debits: " + st.big.map(function (x) { return day(x.d) + " " + x.desc.slice(0, 40) + " " + money(x.amt, cur); }).join("; "));
    if (st.txns.length) {
      o.push("", (st.source === "PDF" ? "Transaction-looking lines (sign may be missing; check the text below): " : "Transactions, newest first:"), "| Date | Description | Amount |", "|---|---|---|");
      st.txns.slice(0, MAX_TXNS).forEach(function (x) { o.push("| " + (x.d ? day(x.d) : x.ds || "") + " | " + String(x.desc).replace(/\|/g, "/").slice(0, 60) + " | " + money(x.amt, cur) + " |"); });
      if (st.n > MAX_TXNS) o.push("(" + (st.n - MAX_TXNS) + " older transactions not shown; use the totals above)");
    }
    if (st.text) o.push("", "Statement text" + (st.textCut ? " (first part)" : "") + ":", st.text);
    var t = o.join("\n");
    return t.length > MAX_CHARS ? t.slice(0, MAX_CHARS) + "\n(statement truncated to fit)" : t;
  }

  window.BLACK_STMT = {
    isStatementFile: function (n) { return /\.(ofx|qfx|qbo|pdf)$/i.test(n); },
    parseOfx: parseOfx, fromSheet: fromSheet, parsePdf: parsePdf, sheetFor: sheetFor, promptBlock: promptBlock, label: label, money: money, HELP: HELP
  };
})();
