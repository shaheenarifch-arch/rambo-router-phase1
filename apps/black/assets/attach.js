/* BLACK attachments: Excel / CSV / calendar (.ics) upload for briefs.
 * Calendar files are parsed in the browser into a list of events (no library needed).
 * The file is read in the browser with SheetJS (loaded from cdnjs only when a file is picked).
 * Nothing is uploaded or stored server side: BLACK receives a compact text summary of the data
 * (columns, row count, numeric totals and the first rows), capped so briefs stay fast.
 * Exposes window.BLACK_ATTACH = { current(), clear(), promptBlock(), onChange(fn) }.
 */
(function () {
  "use strict";
  var LIB = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
  var MAX_BYTES = 5 * 1024 * 1024, MAX_SHEETS = 3, MAX_ROWS = 40, MAX_COLS = 20, MAX_CHARS = 11000;
  var OK = /\.(xlsx|xlsm|xls|csv|ics)$/i, ICS = /\.ics$/i, MAX_EVENTS = 80;
  var HELP = 'How to export a calendar file: <a href="https://support.google.com/calendar/answer/37111?hl=en" target="_blank" rel="noopener">Google</a> \u00b7 ' +
    '<a href="https://support.microsoft.com/en-us/outlook/export-an-outlook-calendar-to-google-calendar" target="_blank" rel="noopener">Outlook</a> \u00b7 ' +
    '<a href="https://support.apple.com/guide/calendar/icl1023/mac" target="_blank" rel="noopener">Apple</a>';

  var input = document.getElementById("file-input");
  var btn = document.getElementById("attach-btn");
  var tray = document.getElementById("attach-tray");
  var box = document.querySelector(".composer .box");
  if (!input || !btn || !tray) return;

  var file = null; // { name, size, sheets: [{ name, rows, cols, header, data, stats }] }
  var listeners = [];
  var libPromise = null;

  function loadLib() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (libPromise) return libPromise;
    libPromise = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = LIB; s.async = true;
      s.onload = function () { window.XLSX ? resolve(window.XLSX) : reject(new Error("lib")); };
      s.onerror = function () { libPromise = null; reject(new Error("lib")); };
      document.head.appendChild(s);
    });
    return libPromise;
  }

  btn.addEventListener("click", function () { input.click(); });
  input.addEventListener("change", function () { if (input.files && input.files[0]) pick(input.files[0]); input.value = ""; });
  if (box) {
    ["dragenter", "dragover"].forEach(function (t) { box.addEventListener(t, function (e) { if (hasFiles(e)) { e.preventDefault(); box.classList.add("drop"); } }); });
    ["dragleave", "drop"].forEach(function (t) { box.addEventListener(t, function () { box.classList.remove("drop"); }); });
    box.addEventListener("drop", function (e) { if (!hasFiles(e)) return; e.preventDefault(); pick(e.dataTransfer.files[0]); });
  }
  function hasFiles(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") > -1; }

  function pick(f) {
    if (!f) return;
    if (!OK.test(f.name)) return fail("BLACK can read Excel (.xlsx, .xls), .csv and calendar (.ics) files.", true);
    if (f.size > MAX_BYTES) return fail(f.name + " is " + mb(f.size) + ". The limit is 5 MB.");
    file = null; emit();
    tray.hidden = false;
    tray.innerHTML = '<div class="att reading"><span class="rpulse"></span>Reading ' + esc(f.name) + "…</div>";
    if (ICS.test(f.name)) {
      f.text().then(function (txt) {
        var cal = parseIcs(txt);
        if (!cal.rows) return fail(f.name + " has no events BLACK can read.", true);
        file = { name: f.name, size: f.size, sheetCount: 1, kind: "calendar", total: cal.total, sheets: [cal] };
        render(); emit();
      }).catch(function () { fail("Couldn't read " + f.name + ". Is it a valid calendar (.ics) file?", true); });
      return;
    }
    Promise.all([loadLib(), f.arrayBuffer()]).then(function (r) {
      var XLSX = r[0], wb = XLSX.read(r[1], { type: "array", cellDates: true });
      var sheets = wb.SheetNames.slice(0, MAX_SHEETS).map(function (n) { return parseSheet(XLSX, n, wb.Sheets[n]); })
        .filter(function (s) { return s.rows > 0 || s.header.length; });
      if (!sheets.length) return fail(f.name + " has no readable data.");
      file = { name: f.name, size: f.size, sheetCount: wb.SheetNames.length, sheets: sheets };
      render(); emit();
    }).catch(function (e) {
      fail(e && e.message === "lib" ? "Couldn't load the spreadsheet reader. Check your connection and try again." : "Couldn't read " + f.name + ". Is it a valid Excel or CSV file?");
    });
  }

  function parseSheet(XLSX, name, ws) {
    var aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "", blankrows: false });
    while (aoa.length && aoa[0].every(function (c) { return c === ""; })) aoa.shift();
    var header = (aoa[0] || []).slice(0, MAX_COLS).map(function (h, i) { return String(h === "" ? "Column " + (i + 1) : h).trim(); });
    var body = aoa.slice(1).map(function (r) { return r.slice(0, MAX_COLS); });
    var stats = header.map(function (h, i) {
      var nums = [];
      body.forEach(function (r) { var v = r[i]; if (typeof v === "number" && isFinite(v)) nums.push(v); });
      if (nums.length < Math.max(2, body.length * 0.6)) return null;
      var sum = nums.reduce(function (a, b) { return a + b; }, 0);
      return { col: h, sum: sum, avg: sum / nums.length, min: Math.min.apply(null, nums), max: Math.max.apply(null, nums), n: nums.length };
    }).filter(Boolean);
    return { name: name, rows: body.length, cols: header.length, header: header, data: body, stats: stats };
  }

  // ---------- calendar (.ics) ----------
  function icsDate(v, params) {
    var m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/.exec(v || "");
    if (!m) return null;
    if (!m[4]) return { d: new Date(+m[1], +m[2] - 1, +m[3]), allDay: true };
    var a = [+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)];
    // UTC times convert to local; TZID / floating times are shown as written.
    return { d: m[7] ? new Date(Date.UTC.apply(null, a)) : new Date(a[0], a[1], a[2], a[3], a[4], a[5]), allDay: false, tz: (params.match(/TZID=([^;:]+)/) || [])[1] };
  }
  function unesc(v) { return v.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim(); }
  function parseIcs(txt) {
    var lines = txt.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n"), evs = [], ev = null;
    lines.forEach(function (l) {
      if (l === "BEGIN:VEVENT") { ev = { att: [] }; return; }
      if (l === "END:VEVENT") { if (ev && ev.start) evs.push(ev); ev = null; return; }
      if (!ev) return;
      var i = l.indexOf(":"); if (i < 0) return;
      var key = l.slice(0, i), val = l.slice(i + 1), name = key.split(";")[0].toUpperCase(), params = key.slice(name.length);
      if (name === "SUMMARY") ev.title = unesc(val);
      else if (name === "LOCATION") ev.loc = unesc(val);
      else if (name === "DTSTART") ev.start = icsDate(val, params);
      else if (name === "DTEND") ev.end = icsDate(val, params);
      else if (name === "RRULE") ev.rep = (val.match(/FREQ=(\w+)/) || [])[1];
      else if (name === "STATUS" && /CANCELLED/i.test(val)) ev.cancelled = true;
      else if (name === "ATTENDEE") { var cn = (params.match(/CN=("?)([^";:]+)\1/) || [])[2]; if (cn) ev.att.push(cn); }
    });
    evs = evs.filter(function (e) { return !e.cancelled; }).sort(function (a, b) { return a.start.d - b.start.d; });
    // Lead with today onward (older events only if room is left).
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var upcoming = evs.filter(function (e) { return e.start.d >= today || e.rep; }), past = evs.filter(function (e) { return e.start.d < today && !e.rep; });
    var pick = upcoming.slice(0, MAX_EVENTS).concat(past.slice(-Math.max(0, MAX_EVENTS - upcoming.length)));
    pick.sort(function (a, b) { return a.start.d - b.start.d; });
    var two = function (n) { return (n < 10 ? "0" : "") + n; };
    var day = function (d) { return d.toLocaleDateString([], { weekday: "short", year: "numeric", month: "short", day: "numeric" }); };
    var hm = function (x) { return x ? two(x.d.getHours()) + ":" + two(x.d.getMinutes()) : ""; };
    var data = pick.map(function (e) {
      return [day(e.start.d), e.start.allDay ? "All day" : hm(e.start), e.start.allDay ? "" : hm(e.end), e.title || "(no title)", e.loc || "",
        e.att.slice(0, 6).join(", "), e.rep ? "Repeats " + e.rep.toLowerCase() : ""];
    });
    return { name: "Calendar", rows: data.length, cols: 7, header: ["Date", "Start", "End", "Title", "Location", "Attendees", "Repeats"], data: data, stats: [], total: evs.length };
  }

  function cell(v) {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === "number") return String(+v.toFixed(4));
    return String(v).replace(/[\r\n|]+/g, " ").trim().slice(0, 60);
  }
  function num(v) { return Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(2) + "M" : Math.abs(v) >= 1e3 ? (v / 1e3).toFixed(1) + "K" : String(+v.toFixed(2)); }

  // Compact, model-friendly description of the file (markdown tables), capped at MAX_CHARS.
  function promptBlock() {
    if (!file) return "";
    if (file.kind === "calendar") {
      var s0 = file.sheets[0], o = ["[Attached calendar: " + file.name + " · " + file.total + " events" + (file.total > s0.rows ? " (" + s0.rows + " included, upcoming first)" : "") +
        " · times in the user's local time zone unless a TZID applies]", "| " + s0.header.join(" | ") + " |", "|" + s0.header.map(function () { return "---"; }).join("|") + "|"];
      s0.data.forEach(function (r) { o.push("| " + r.map(cell).join(" | ") + " |"); });
      var t = o.join("\n");
      return t.length > MAX_CHARS ? t.slice(0, MAX_CHARS) + "\n(calendar truncated to fit)" : t;
    }
    var out = ["[Attached spreadsheet: " + file.name + " · " + file.sheetCount + " sheet" + (file.sheetCount > 1 ? "s" : "") +
      (file.sheetCount > MAX_SHEETS ? " (first " + MAX_SHEETS + " included)" : "") + "]"];
    file.sheets.forEach(function (s) {
      out.push("", "Sheet \"" + s.name + "\": " + s.rows + " rows × " + s.cols + " columns");
      if (s.stats.length) out.push("Numeric columns: " + s.stats.map(function (t) {
        return t.col + " (sum " + num(t.sum) + ", avg " + num(t.avg) + ", min " + num(t.min) + ", max " + num(t.max) + ")";
      }).join("; "));
      var rows = s.data.slice(0, MAX_ROWS);
      out.push("First " + rows.length + " rows:");
      out.push("| " + s.header.map(cell).join(" | ") + " |", "|" + s.header.map(function () { return "---"; }).join("|") + "|");
      rows.forEach(function (r) { out.push("| " + s.header.map(function (_, i) { return cell(r[i] === undefined ? "" : r[i]); }).join(" | ") + " |"); });
      if (s.rows > rows.length) out.push("(" + (s.rows - rows.length) + " more rows not shown; use the column totals above)");
    });
    var txt = out.join("\n");
    return txt.length > MAX_CHARS ? txt.slice(0, MAX_CHARS) + "\n(data truncated to fit)" : txt;
  }

  function render() {
    var s = file.sheets[0], rows = s.data.slice(0, 5), cols = s.header.slice(0, file.kind === "calendar" ? 4 : 6);
    var total = file.sheets.reduce(function (n, x) { return n + x.rows; }, 0);
    tray.hidden = false;
    tray.innerHTML =
      '<div class="att"><span class="att-ic" aria-hidden="true">' + (file.kind === "calendar" ? "\ud83d\uddd3" : "▦") + "</span>" +
      '<span class="att-name"><b></b><small></small></span>' +
      '<button type="button" class="att-x" aria-label="Remove file">✕</button></div>' +
      '<div class="att-prev"><table><thead><tr>' + cols.map(function (h) { return "<th>" + esc(cell(h)) + "</th>"; }).join("") + "</tr></thead><tbody>" +
      rows.map(function (r) { return "<tr>" + cols.map(function (_, i) { return "<td>" + esc(cell(r[i] === undefined ? "" : r[i])) + "</td>"; }).join("") + "</tr>"; }).join("") +
      "</tbody></table></div>";
    tray.querySelector(".att-name b").textContent = file.name;
    tray.querySelector(".att-name small").textContent = file.kind === "calendar" ? file.total.toLocaleString() + " events · " + mb(file.size)
      : file.sheetCount + " sheet" + (file.sheetCount > 1 ? "s" : "") + " · " + total.toLocaleString() + " rows · " + mb(file.size);
    tray.querySelector(".att-x").addEventListener("click", clear);
  }
  function fail(msg, help) {
    file = null; emit();
    tray.hidden = false;
    tray.innerHTML = '<div class="att err"><span></span><button type="button" class="att-x" aria-label="Dismiss">✕</button></div>' + (help ? '<p class="att-help">' + HELP + "</p>" : "");
    tray.querySelector(".err span").textContent = msg;
    tray.querySelector(".att-x").addEventListener("click", clear);
  }
  function clear() { file = null; tray.innerHTML = ""; tray.hidden = true; emit(); }
  function emit() { listeners.forEach(function (fn) { fn(file); }); }
  function mb(b) { return b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB"; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  window.BLACK_ATTACH = {
    current: function () { return file ? { name: file.name, kind: file.kind || "sheet", sheets: file.sheetCount, rows: file.sheets.reduce(function (n, x) { return n + x.rows; }, 0) } : null; },
    helpHtml: HELP,
    promptBlock: promptBlock,
    clear: clear,
    onChange: function (fn) { listeners.push(fn); }
  };
})();
