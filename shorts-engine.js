
/* BEST FEED — SHORTS PLAYER + LOCAL LEARNING */
(() => {
  "use strict";

  const $ = s => document.querySelector(s);
  const STORAGE = "bf_shorts_v1_stats";
  const read = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  };
  const save = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch {}
  };

  function getId(url) {
    try {
      const u = new URL(url);
      const id = u.hostname.includes("youtu.be")
        ? u.pathname.slice(1)
        : u.searchParams.get("v") ||
          u.pathname.match(/\/(?:embed|shorts|live)\/([^/?]+)/)?.[1];
      return /^[\w-]{11}$/.test(id || "") ? id : null;
    } catch { return null; }
  }

  const shorts = (Array.isArray(window.BEST_FEED_SHORTS)
    ? window.BEST_FEED_SHORTS : [])
    .map((v, i) => ({
      ...v,
      id: getId(v.url),
      title: String(v.title || "Untitled Short"),
      creator: String(v.creator || "YouTube"),
      category: String(v.category || "Other"),
      description: String(v.description || ""),
      index: i
    }))
    .filter(v => v.id);

  let stats = read(STORAGE, {});
  let ordered = [];
  let activeId = null;
  let activePlayer = null;
  let activeStarted = 0;
  let watchTimer = null;
  let observer = null;
  let apiWait = null;

  function getStat(id) {
    if (!stats[id]) {
      stats[id] = {
        watchedSeconds: 0,
        plays: 0,
        completed: 0,
        replays: 0,
        swipes: 0,
        likes: 0,
        dislikes: 0,
        notInterested: 0,
        duration: 0,
        lastSeen: 0
      };
    }
    return stats[id];
  }

  function persist() {
    save(STORAGE, stats);
  }

  function notify(message) {
    const el = $("#shortsMessage");
    if (!el) return;
    el.textContent = message;
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => el.textContent = "", 1800);
  }

  function rankedShorts() {
    const ignored = new Set(
      Object.entries(stats)
        .filter(([, s]) => (s.notInterested || 0) > 0)
        .map(([id]) => id)
    );

    const available = shorts.filter(v => !ignored.has(v.id));

    return window.BFAlgorithm
      ? window.BFAlgorithm.rankShorts(available, stats, read("bf_v2_saved", []))
      : available;
  }

  function render() {
    ordered = rankedShorts();

    $("#shortsFeed").innerHTML = ordered.map((v, i) => `
      <article class="short-card" data-short-id="${v.id}">
        <div class="short-player" id="short-player-${i}"></div>

        <button class="short-play-hint" data-start="${v.id}" hidden>
          ▶ Tap to play
        </button>

        <div class="short-overlay">
          <h3>${escapeText(v.title)}</h3>
          <p>${escapeText(v.creator)} · ${escapeText(v.category)}</p>
          <p>${escapeText(v.description)}</p>
        </div>

        <div class="short-actions">
          <button data-like="${v.id}" aria-label="Like">♡</button>
          <button data-dislike="${v.id}" aria-label="Dislike">👎</button>
          <button data-save="${v.id}" aria-label="Save">＋</button>
          <button data-ignore="${v.id}" aria-label="Not interested">×</button>
          <button data-sound="${v.id}" aria-label="Turn sound on">♫</button>
        </div>
      </article>
    `).join("");

    if (!ordered.length) {
      $("#shortsFeed").innerHTML =
        '<div style="padding:90px 20px;text-align:center;color:white">No Shorts available. Add videos in shorts.js.</div>';
      return;
    }

    observeCards();
  }

  function escapeText(value) {
    return String(value).replace(/[&<>"']/g, c => ({
      "&":"&amp;", "<":"&lt;", ">":"&gt;",
      '"':"&quot;", "'":"&#39;"
    })[c]);
  }

  function waitForAPI(callback) {
    if (window.YT && window.YT.Player) {
      callback();
      return;
    }

    clearInterval(apiWait);
    let attempts = 0;

    apiWait = setInterval(() => {
      attempts++;

      if (window.YT && window.YT.Player) {
        clearInterval(apiWait);
        callback();
      } else if (attempts > 80) {
        clearInterval(apiWait);
        notify("YouTube player could not load. Check your connection.");
      }
    }, 250);
  }

  function flushWatch() {
    if (!activeId || !activeStarted) return;

    const elapsed = Math.max(0, (Date.now() - activeStarted) / 1000);
    const s = getStat(activeId);

    s.watchedSeconds += elapsed;
    s.lastSeen = Date.now();
    activeStarted = 0;
    persist();
  }

  function stopActive(countSwipe = true) {
    if (!activeId) return;

    const oldId = activeId;
    flushWatch();

    if (countSwipe) {
      const s = getStat(oldId);
      if (s.watchedSeconds < 3 && s.completed === 0) {
        s.swipes++;
      }
    }

    clearInterval(watchTimer);
    watchTimer = null;

    if (activePlayer) {
      try {
        activePlayer.pauseVideo();
        activePlayer.destroy();
      } catch {}
    }

    activePlayer = null;
    activeId = null;
    persist();
  }

  function startShort(v, index) {
    if (activeId === v.id) return;

    stopActive(true);
    activeId = v.id;

    const target = document.getElementById("short-player-" + index);
    if (!target) return;

    target.innerHTML = "";

    waitForAPI(() => {
      if (activeId !== v.id || !target.isConnected) return;

      activePlayer = new YT.Player(target, {
        width: "100%",
        height: "100%",
        videoId: v.id,
        playerVars: {
          autoplay: 1,
          controls: 1,
          playsinline: 1,
          rel: 0,
          fs: 1,
          enablejsapi: 1
        },
        events: {
          onReady: event => {
            if (activeId !== v.id) return;
            event.target.mute();
            event.target.playVideo();
          },

          onStateChange: event => {
            if (activeId !== v.id) return;

            const s = getStat(v.id);

            if (event.data === YT.PlayerState.PLAYING) {
              if (!activeStarted) {
                activeStarted = Date.now();
                s.plays++;
                s.lastSeen = Date.now();

                clearInterval(watchTimer);
                watchTimer = setInterval(() => {
                  if (activeId === v.id && activeStarted) {
                    flushWatch();
                    activeStarted = Date.now();
                  }
                }, 3000);
              }
              persist();
            }

            if (event.data === YT.PlayerState.PAUSED) {
              flushWatch();
            }

            if (event.data === YT.PlayerState.ENDED) {
              flushWatch();
              s.completed++;
              s.lastSeen = Date.now();
              persist();
              notify("Short completed!");
            }
          },

          onError: () => {
            notify("This Short cannot play in the embedded player.");
          },

          onAutoplayBlocked: () => {
            const hint = target.parentElement.querySelector(".short-play-hint");
            if (hint) hint.hidden = false;
          }
        }
      });
    });
  }

  function observeCards() {
    if (observer) observer.disconnect();

    observer = new IntersectionObserver(entries => {
      const visible = entries
        .filter(e => e.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

      if (!visible || visible.intersectionRatio < 0.65) return;

      const id = visible.target.dataset.shortId;
      const index = ordered.findIndex(v => v.id === id);
      const video = ordered[index];

      if (video) startShort(video, index);
    }, {
      root: $("#shortsFeed"),
      threshold: [0.2, 0.65, 0.9]
    });

    document.querySelectorAll(".short-card").forEach(card => {
      observer.observe(card);
    });
  }

  function show() {
    $("#shortsView").classList.add("show");
    document.body.classList.add("shorts-mode");
    $("#shortsFeed").scrollTop = 0;

    if (!shorts.length) {
      $("#shortsFeed").innerHTML =
        '<div style="padding:90px 20px;text-align:center;color:white">Add Shorts links in shorts.js first.</div>';
      return;
    }

    render();
  }

  function hide() {
    stopActive(false);
    $("#shortsView").classList.remove("show");
    document.body.classList.remove("shorts-mode");
  }

  $("#shortsTab").addEventListener("click", show);
  $("#shortsClose").addEventListener("click", hide);

  $("#shortsFeed").addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button) return;

    const id = button.dataset.like ||
      button.dataset.dislike ||
      button.dataset.save ||
      button.dataset.ignore ||
      button.dataset.sound ||
      button.dataset.start;

    if (!id) return;

    const s = getStat(id);

    if (button.dataset.like) {
      s.likes++;
      notify("Added to your likes");
    } else if (button.dataset.dislike) {
      s.dislikes++;
      notify("Recommendation updated");
    } else if (button.dataset.save) {
      const saved = new Set(read("bf_v2_saved", []));
      saved.add(id);
      save("bf_v2_saved", [...saved]);
      notify("Saved");
    } else if (button.dataset.ignore) {
      s.notInterested++;
      persist();
      stopActive(false);
      render();
      notify("You will see fewer similar Shorts");
    } else if (button.dataset.sound) {
      if (activePlayer && activeId === id) {
        try {
          activePlayer.unMute();
          activePlayer.setVolume(80);
          button.textContent = "🔊";
        } catch {}
      }
    } else if (button.dataset.start) {
      button.hidden = true;
      if (activePlayer && activeId === id) {
        activePlayer.unMute();
        activePlayer.playVideo();
      }
    }

    persist();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      flushWatch();
      if (activePlayer) {
        try { activePlayer.pauseVideo(); } catch {}
      }
    }
  });

  window.addEventListener("pagehide", () => {
    flushWatch();
    persist();
  });

  render();
})();
