const CLIENT_SCRIPT = `(function () {
  "use strict";
  var bootstrap = JSON.parse(document.getElementById("bootstrap").textContent);
  var buildName = bootstrap.buildName;
  var state = bootstrap.snapshot;
  var lastEventId = 0;
  var es = null;
  var pollTimer = null;
  var lastFavicon = null;
  var lastTitle = null;
  var disconnected = false;
  var knownPhases = new Set();

  function fmtCost(n) {
    if (typeof n !== "number") return "$0.00";
    return "$" + n.toFixed(2);
  }
  function fmtDuration(ms) {
    if (ms == null) return "";
    var s = Math.floor(ms / 1000);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var r = s % 60;
    if (h > 0) return h + "h" + m + "m";
    if (m > 0) return m + "m" + r + "s";
    return r + "s";
  }

  function elapsedFromStart(startedAt) {
    if (!startedAt) return "";
    var t = Date.parse(startedAt);
    if (isNaN(t)) return "";
    return fmtDuration(Date.now() - t);
  }

  function pillClass(status) {
    switch (status) {
      case "building":
      case "reviewing":
        return "pill pill-running";
      case "complete":
        return "pill pill-done";
      case "failed":
        return "pill pill-failed";
      case "skipped":
        return "pill pill-skipped";
      default:
        return "pill pill-pending";
    }
  }
  function pillText(status) {
    switch (status) {
      case "building": return "running";
      case "reviewing": return "running";
      case "complete": return "done";
      case "failed": return "failed";
      case "skipped": return "skipped";
      default: return "pending";
    }
  }

  function setTitle() {
    var status = state.status || "idle";
    var name = state.buildName || buildName || "";
    var title = "● ridgeline" + (name ? " · " + name + " · " + status : "");
    if (title === lastTitle) return;
    lastTitle = title;
    document.title = title;
  }

  function faviconColor(status) {
    if (status === "running") return "#06B6D4";
    if (status === "done") return "#10B981";
    if (status === "failed") return "#EF4444";
    return "#9CA3AF";
  }
  function setFavicon() {
    var color = faviconColor(state.status || "idle");
    if (color === lastFavicon) return;
    lastFavicon = color;
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="' + color + '"/></svg>';
    var href = "data:image/svg+xml;utf8," + encodeURIComponent(svg);
    var link = document.getElementById("favicon");
    if (link) link.setAttribute("href", href);
  }

  function renderHeader() {
    var buildEl = document.getElementById("build-name");
    if (buildEl) {
      var name = state.buildName || buildName;
      buildEl.textContent = name || "ridgeline";
    }
    var pill = document.getElementById("header-pill");
    if (pill) {
      pill.className = pillClass(state.status === "running" ? "building" : state.status === "done" ? "complete" : state.status === "failed" ? "failed" : "pending");
      pill.textContent = (state.status || "pending").toUpperCase();
    }
    var elapsed = document.getElementById("header-elapsed");
    if (elapsed) elapsed.textContent = elapsedFromStart(state.startedAt);
  }

  function renderCost() {
    var total = document.getElementById("cost-total");
    if (total) total.textContent = fmtCost(state.budget && state.budget.totalCostUsd);
    var breakdown = document.getElementById("cost-breakdown");
    if (!breakdown) return;
    var html = "";
    var roles = (state.budget && state.budget.perRole) || [];
    for (var i = 0; i < roles.length; i++) {
      var r = roles[i];
      html += '<div><div class="dim">' + escape(r.role) + '</div><div class="cost-stage-value mono">' + escape(fmtCost(r.costUsd)) + '</div></div>';
    }
    breakdown.innerHTML = html;
  }

  function escape(s) {
    if (s == null) return "";
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function renderPhases(changedIds) {
    var list = document.getElementById("phase-list");
    if (!list) return;
    var empty = document.getElementById("empty-state");
    var meter = document.getElementById("cost-meter");
    if (!state.buildName) {
      if (empty) empty.hidden = false;
      if (meter) meter.hidden = true;
      list.innerHTML = "";
      return;
    }
    if (empty) empty.hidden = true;
    if (meter) meter.hidden = false;

    var html = "";
    var lastErr = state.lastError;
    for (var i = 0; i < state.phases.length; i++) {
      var p = state.phases[i];
      var failed = p.status === "failed";
      var cls = "phase-row" + (failed ? " failed" : "");
      var elapsed = p.duration != null ? fmtDuration(p.duration) : "";
      html += '<div class="' + cls + '" data-phase-id="' + escape(p.id) + '">';
      html += '<span class="phase-id mono">' + escape(p.id) + '</span>';
      html += '<span class="phase-slug">' + escape(p.slug) + '</span>';
      html += '<span class="' + pillClass(p.status) + '">' + escape(pillText(p.status)) + '</span>';
      html += '<span class="phase-elapsed mono">' + escape(elapsed) + '</span>';
      if (failed && lastErr && lastErr.phaseId === p.id) {
        html += '<div class="phase-error mono">' + escape(lastErr.message) + '</div>';
      }
      html += '</div>';
    }
    list.innerHTML = html;

    if (changedIds && changedIds.size > 0) {
      changedIds.forEach(function (id) {
        var row = list.querySelector('[data-phase-id="' + id + '"]');
        if (!row) return;
        row.classList.remove("row-flash");
        void row.offsetWidth;
        row.classList.add("row-flash");
      });
    }
  }

  function renderAll(changedIds) {
    setTitle();
    setFavicon();
    renderHeader();
    renderCost();
    renderPhases(changedIds);
    for (var i = 0; i < state.phases.length; i++) knownPhases.add(state.phases[i].id);
  }

  function diffPhases(prev, next) {
    var prevMap = {};
    for (var i = 0; i < prev.length; i++) prevMap[prev[i].id] = prev[i];
    var changed = new Set();
    for (var j = 0; j < next.length; j++) {
      var p = next[j];
      var old = prevMap[p.id];
      if (!old || old.status !== p.status || old.duration !== p.duration || old.retries !== p.retries) {
        changed.add(p.id);
      }
    }
    return changed;
  }

  function onState(data) {
    var prevPhases = state.phases;
    state = Object.assign({}, state, data);
    var changed = diffPhases(prevPhases, state.phases);
    renderAll(changed);
  }
  function onBudget(data) {
    state = Object.assign({}, state, { budget: data });
    renderCost();
  }
  function onTrajectory(_entry) {
  }

  function hideBanner() {
    var b = document.getElementById("disconnect-banner");
    if (!b || b.classList.contains("hidden")) return;
    b.classList.add("fade-out");
    setTimeout(function () {
      b.classList.add("hidden");
      b.classList.remove("fade-out");
    }, 400);
  }
  function showBanner() {
    var b = document.getElementById("disconnect-banner");
    if (!b) return;
    b.classList.remove("hidden");
    b.classList.remove("fade-out");
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(function () {
      fetch("/state").then(function (r) {
        return r.ok ? r.json() : null;
      }).then(function (snap) {
        if (snap) onState(snap);
      }).catch(function () {});
    }, 2000);
  }
  function stopPolling() {
    if (!pollTimer) return;
    clearInterval(pollTimer);
    pollTimer = null;
  }

  function openStream() {
    try {
      es = new EventSource("/events");
    } catch (_e) {
      startPolling();
      return;
    }
    es.addEventListener("open", function () {
      if (disconnected) {
        disconnected = false;
        hideBanner();
      }
      stopPolling();
    });
    es.addEventListener("state", function (ev) {
      lastEventId = Number(ev.lastEventId) || lastEventId;
      try { onState(JSON.parse(ev.data)); } catch (_e) {}
    });
    es.addEventListener("budget", function (ev) {
      lastEventId = Number(ev.lastEventId) || lastEventId;
      try { onBudget(JSON.parse(ev.data)); } catch (_e) {}
    });
    es.addEventListener("trajectory", function (ev) {
      lastEventId = Number(ev.lastEventId) || lastEventId;
      try { onTrajectory(JSON.parse(ev.data)); } catch (_e) {}
    });
    es.addEventListener("error", function () {
      disconnected = true;
      showBanner();
      startPolling();
    });
  }

  renderAll();
  openStream();
  setInterval(function () {
    var el = document.getElementById("header-elapsed");
    if (el) el.textContent = elapsedFromStart(state.startedAt);
  }, 1000);
})();
`

export const renderClientScript = (): string => CLIENT_SCRIPT
