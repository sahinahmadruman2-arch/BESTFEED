
/* BEST FEED — Local Recommendation Engine */
(() => {
  "use strict";

  const now = () => Date.now();
  const log = n => Math.log1p(Math.max(0, Number(n) || 0));

  function categoryAffinity(item, items, stats) {
    let total = 0;

    for (const v of items) {
      if (v.category !== item.category) continue;

      const s = stats[v.id] || {};
      total += log(s.seconds) * 2;
      total += (s.completed || 0) * 1.5;
      total += (s.likes || 0) * 3;
      total -= (s.dislikes || 0) * 4;
    }

    return Math.min(total, 24);
  }

  function creatorAffinity(item, items, stats) {
    let total = 0;

    for (const v of items) {
      if (v.creator !== item.creator) continue;

      const s = stats[v.id] || {};
      total += log(s.seconds);
      total += (s.likes || 0) * 2;
      total -= (s.dislikes || 0) * 3;
    }

    return Math.min(total, 12);
  }

  function searchMatch(item, searches = {}) {
    const text = [
      item.title, item.creator, item.category,
      item.description
    ].join(" ").toLowerCase();

    let score = 0;

    for (const [term, count] of Object.entries(searches)) {
      if (term.length < 2 || !text.includes(term)) continue;
      score += Math.min(Number(count) || 0, 5) * 1.5;
    }

    return Math.min(score, 12);
  }

  function recencyPenalty(s) {
    if (!s.lastSeen) return 0;

    const hours = (now() - s.lastSeen) / 3600000;

    if (hours < 1) return 12;
    if (hours < 6) return 7;
    if (hours < 24) return 3;
    return 0;
  }

  function diversitySort(items, scoreMap) {
    const remaining = [...items];
    const result = [];
    const recentCategories = [];

    while (remaining.length) {
      let bestIndex = 0;
      let bestScore = -Infinity;

      remaining.forEach((item, index) => {
        let score = scoreMap.get(item.id) || 0;

        if (
          recentCategories.length >= 2 &&
          recentCategories.slice(-2).every(c => c === item.category)
        ) {
          score -= 15;
        }

        if (score > bestScore) {
          bestScore = score;
          bestIndex = index;
        }
      });

      const chosen = remaining.splice(bestIndex, 1)[0];
      result.push(chosen);
      recentCategories.push(chosen.category);
    }

    return result;
  }

  function rankLong(items, stats = {}, savedIds = [], searches = {}) {
    const saved = new Set(savedIds);
    const scores = new Map();

    for (const v of items) {
      const s = stats[v.id] || {};

      let score = 0;
      score += categoryAffinity(v, items, stats);
      score += creatorAffinity(v, items, stats);
      score += log(s.seconds) * 2.4;
      score += (s.completed || 0) * 5;
      score += (s.likes || 0) * 7;
      score += saved.has(v.id) ? 4 : 0;
      score += searchMatch(v, searches);
      score += v.featured ? 2 : 0;

      score -= (s.skips || 0) * 5;
      score -= (s.dislikes || 0) * 12;
      score -= (s.notInterested || 0) * 30;
      score -= recencyPenalty(s);

      // Small exploration boost for videos with little history.
      if (!s.seconds && !s.plays) score += 5;

      scores.set(v.id, score);
    }

    return diversitySort(items, scores);
  }

  function rankShorts(items, stats = {}, savedIds = []) {
    const saved = new Set(savedIds);
    const scores = new Map();

    for (const v of items) {
      const s = stats[v.id] || {};

      const watched = Number(s.watchedSeconds) || 0;
      const duration = Number(s.duration) || Number(v.duration) || 0;
      const viewedPercent = duration > 0
        ? Math.min(1, watched / duration)
        : 0;

      let score = 0;

      score += categoryAffinity(v, items, stats) * 0.8;
      score += log(watched) * 3;
      score += viewedPercent * 14;
      score += (s.completed || 0) * 7;
      score += (s.replays || 0) * 4;
      score += (s.likes || 0) * 8;
      score += saved.has(v.id) ? 3 : 0;

      score -= (s.swipes || 0) * 6;
      score -= (s.dislikes || 0) * 12;
      score -= (s.notInterested || 0) * 35;
      score -= recencyPenalty(s);

      if (!watched && !s.plays) score += 6;

      scores.set(v.id, score);
    }

    return diversitySort(items, scores);
  }

  window.BFAlgorithm = { rankLong, rankShorts };
})();
