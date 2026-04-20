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

  // ── Smart download button ────────────────────────────────────────
  // Detects OS + preferred asset for any [data-download] link.
  // Progressive enhancement: no-JS or offline users still get the
  // Releases page via the button's default href.
  var REPO = "gabrielvuksani/wotann";

  function detectPlatform() {
    var ua = navigator.userAgent;
    var p = (navigator.userAgentData && navigator.userAgentData.platform) || "";

    // Prefer the modern UA-CH hint when present.
    var os = (p || "").toLowerCase();
    if (!os) {
      if (/Mac/.test(ua)) os = "macos";
      else if (/Win/.test(ua)) os = "windows";
      else if (/Linux/.test(ua) && !/Android/.test(ua)) os = "linux";
      else os = "unknown";
    } else if (os.indexOf("mac") >= 0) os = "macos";
    else if (os.indexOf("win") >= 0) os = "windows";
    else if (os.indexOf("linux") >= 0) os = "linux";
    else os = "unknown";

    // Matchers in priority order. DMG > tar.gz > raw for a given OS.
    var matchers = {
      macos: [/macos-arm64\.dmg$/i, /macos-arm64\.tar\.gz$/i, /macos-arm64$/i],
      linux: [/linux-x64\.tar\.gz$/i, /linux-x64$/i],
      windows: [/windows-x64\.exe$/i, /windows-x64\.exe\.tar\.gz$/i],
      unknown: [],
    };

    var labels = {
      macos: "Download for macOS (Apple Silicon)",
      linux: "Download for Linux (x64)",
      windows: "Download for Windows (x64)",
      unknown: "Download",
    };

    return { os: os, matchers: matchers[os] || [], label: labels[os] || "Download" };
  }

  function pickAsset(assets, plat) {
    if (!assets || !plat.matchers.length) return null;
    for (var i = 0; i < plat.matchers.length; i++) {
      for (var j = 0; j < assets.length; j++) {
        if (plat.matchers[i].test(assets[j].name)) return assets[j];
      }
    }
    return null;
  }

  function updateDownloadButtons() {
    var buttons = document.querySelectorAll("[data-download]");
    if (!buttons.length) return;

    fetch("https://api.github.com/repos/" + REPO + "/releases/latest", {
      headers: { Accept: "application/vnd.github+json" },
    })
      .then(function (r) {
        if (!r.ok) throw new Error("github api " + r.status);
        return r.json();
      })
      .then(function (release) {
        var plat = detectPlatform();
        var asset = pickAsset(release.assets, plat);
        buttons.forEach(function (btn) {
          if (asset) {
            btn.href = asset.browser_download_url;
            btn.textContent = plat.label + " · " + release.tag_name;
            btn.setAttribute(
              "aria-label",
              "Download " +
                asset.name +
                " (" +
                Math.round(asset.size / 1048576) +
                " MB), " +
                release.tag_name,
            );
          } else {
            // Platform detected but no matching asset — keep Releases page
            // fallback, update the label to show the release tag.
            btn.textContent = "View " + release.tag_name + " releases";
          }
        });
      })
      .catch(function () {
        /* Network error — keep the default Releases-page href + v0.4.0 text */
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", updateDownloadButtons);
  } else {
    updateDownloadButtons();
  }
})();
