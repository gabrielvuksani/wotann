/*
 * wotann.com client-side script
 *
 * Only two behaviors:
 *   1. Theme toggle (dark ↔ light) with localStorage persistence and a
 *      prefers-color-scheme fallback for first-time visitors.
 *   2. Copy-to-clipboard for the install command + command fallback to
 *      a manual selection when the Clipboard API is unavailable (old
 *      browsers or non-secure contexts).
 *
 * No analytics. No trackers. No framework. ~60 lines of plain ES2020.
 */
(function () {
  "use strict";

  // ── Theme ────────────────────────────────────────────────────────
  var KEY = "wotann-theme";
  var root = document.documentElement;
  var stored = null;
  try {
    stored = localStorage.getItem(KEY);
  } catch (_) {
    /* privacy mode */
  }

  var initial = stored;
  if (!initial) {
    var mql = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)");
    initial = mql && mql.matches ? "light" : "dark";
  }
  root.setAttribute("data-theme", initial);

  var toggle = document.getElementById("theme-toggle");
  if (toggle) {
    toggle.addEventListener("click", function () {
      var next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
      root.setAttribute("data-theme", next);
      try {
        localStorage.setItem(KEY, next);
      } catch (_) {
        /* noop */
      }
      toggle.setAttribute(
        "aria-label",
        next === "dark" ? "Switch to light theme" : "Switch to dark theme",
      );
    });
  }

  // ── Copy buttons ─────────────────────────────────────────────────
  document.querySelectorAll(".copy-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var id = btn.getAttribute("data-copy-target");
      var el = id ? document.getElementById(id) : null;
      if (!el) return;
      var text = el.textContent || "";

      var done = function () {
        btn.classList.add("copied");
        var label = btn.querySelector(".copy-label");
        if (label) {
          label.textContent = "Copied";
        }
        setTimeout(function () {
          btn.classList.remove("copied");
          if (label) {
            label.textContent = "Copy";
          }
        }, 1800);
      };

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard
          .writeText(text)
          .then(done)
          .catch(function () {
            fallbackCopy(text);
            done();
          });
      } else {
        fallbackCopy(text);
        done();
      }
    });
  });

  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "absolute";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch (_) {
      /* noop */
    }
    document.body.removeChild(ta);
  }
})();
