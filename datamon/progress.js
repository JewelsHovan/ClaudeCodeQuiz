// ============================================================
// DATAMON Certification Progress — pure canonical-only
// exam evidence model. Ticket #047.
// Classic script (no ESM). Exposes window.DatamonProgress.
// Load AFTER questions.js. Never mutates telemetry or save.
// ============================================================

"use strict";

(function () {
  var API = {};

  // Exam domain weights (real Claude Architect Foundations exam).
  var WEIGHTS = Object.freeze({
    AGENT: 27, MCP: 18, CONFIG: 20, PROMPT: 20, CONTEXT: 15,
  });
  var DOMAIN_KEYS = Object.freeze(Object.keys(WEIGHTS));
  var DOMAIN_NAMES = Object.freeze({
    AGENT: "Agent Wing", MCP: "MCP Lab", CONFIG: "Config Bay",
    PROMPT: "Prompt Studio", CONTEXT: "Context Corner",
  });
  var DEFAULT_SEEN_GAP = 18; // question draws since last seen to label "due"

  function safeNonNegativeInt(value) {
    var number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
  }

  // ---- Public helpers ----

  API.WEIGHTS = WEIGHTS;
  API.DOMAIN_KEYS = DOMAIN_KEYS;
  API.DOMAIN_NAMES = DOMAIN_NAMES;

  // Summarise a single domain from canonical question bank IDs only.
  // Legacy CAT:index aliases in questionStats are intentionally ignored;
  // only question bank canonical IDs count.
  function domainSummary(questionStats, seenCounter, domainKey, questions) {
    if (!questions || !Array.isArray(questions)) {
      return emptyDomainSummary(domainKey);
    }
    var attempted = 0, correct = 0, wrong = 0, due = 0;
    var total = questions.length;
    for (var i = 0; i < total; i++) {
      var q = questions[i];
      var st = (questionStats && questionStats[q.id]) || {};
      var c = safeNonNegativeInt(st.correct);
      var w = safeNonNegativeInt(st.wrong);
      var s = safeNonNegativeInt(st.seen);
      var ls = safeNonNegativeInt(st.lastSeen);
      if (c + w > 0) attempted++;
      correct += c; wrong += w;
      if (s > 0 && (w >= c || (seenCounter || 0) - ls >= DEFAULT_SEEN_GAP)) due++;
    }
    var coverage = total ? attempted / total : 0;
    var attempts = correct + wrong;
    var accuracy = attempts ? correct / attempts : 0;
    var evidence = coverage * accuracy;
    var weight = WEIGHTS[domainKey] || 0;
    return {
      key: domainKey,
      weight: weight,
      total: total,
      attempted: attempted,
      correct: correct,
      wrong: wrong,
      due: due,
      unseen: Math.max(0, total - attempted),
      coverage: coverage,
      accuracy: accuracy,
      evidence: evidence,
    };
  }

  function emptyDomainSummary(key) {
    var weight = WEIGHTS[key] || 0;
    return {
      key: key,
      weight: weight,
      total: 0,
      attempted: 0,
      correct: 0,
      wrong: 0,
      due: 0,
      unseen: 0,
      coverage: 0,
      accuracy: 0,
      evidence: 0,
    };
  }

  // Full multi-domain summary from the question bank.
  // questionBank: the QUESTION_BANK object from questions.js (keys = DOMAIN_KEYS).
  // questionStats: telemetry object mapping canonical IDs to {seen,correct,wrong,lastSeen}.
  // seenCounter: global draw counter (how many total questions have been shown).
  API.summarise = function (questionBank, questionStats, seenCounter) {
    var stats = questionStats && typeof questionStats === "object" ? questionStats : {};
    var sc = safeNonNegativeInt(seenCounter);
    var domains = [];
    for (var i = 0; i < DOMAIN_KEYS.length; i++) {
      var key = DOMAIN_KEYS[i];
      var questions = (questionBank && questionBank[key]) || [];
      domains.push(domainSummary(stats, sc, key, questions));
    }

    // Overall weighted readiness evidence (0–1).
    var totalWeight = 0;
    var weightedSum = 0;
    for (var d = 0; d < domains.length; d++) {
      var w = domains[d].weight;
      totalWeight += w;
      weightedSum += domains[d].evidence * w;
    }
    var overallEvidence = totalWeight ? weightedSum / totalWeight : 0;

    // Recommendation: largest weighted evidence deficit, with due items
    // as a tie-break/urgency boost. Never recommends MIX (pseudo-domain).
    var sorted = domains.slice().sort(function (a, b) {
      var deficitA = a.weight * (1 - a.evidence) + a.due;
      var deficitB = b.weight * (1 - b.evidence) + b.due;
      return deficitB - deficitA;
    });
    var recommendation = sorted[0] || null;

    return {
      domains: domains,
      overallEvidence: overallEvidence,
      recommendation: recommendation,
      evidencePct: Math.round(overallEvidence * 100),
      recommendationKey: recommendation ? recommendation.key : null,
      evidenceLabel: overallEvidence === 0 ? "No study data yet"
        : (overallEvidence >= 0.9 ? "Strong study evidence"
        : (overallEvidence >= 0.6 ? "Developing study evidence"
        : "Early progress")),
    };
  };

  // Convenience: summary for a single domain only.
  API.domainSummary = function (questionBank, questionStats, seenCounter, domainKey) {
    var questions = (questionBank && questionBank[domainKey]) || [];
    var stats = questionStats && typeof questionStats === "object" ? questionStats : {};
    var sc = safeNonNegativeInt(seenCounter);
    return domainSummary(stats, sc, domainKey, questions);
  };

  // Compact HUD string: "EVIDENCE 42% · MCP Lab"
  API.evidenceHUD = function (questionBank, questionStats, seenCounter) {
    var s = API.summarise(questionBank, questionStats, seenCounter);
    var domainName = s.recommendation
      ? (DOMAIN_NAMES[s.recommendation.key] || s.recommendation.key)
      : "Study room";
    return "EVIDENCE " + s.evidencePct + "% · " + domainName;
  };

  // Next study recommendation as a brief string.
  API.recommendationText = function (questionBank, questionStats, seenCounter) {
    var s = API.summarise(questionBank, questionStats, seenCounter);
    if (!s.recommendation) return "Explore the office and battle colleagues to collect study evidence.";
    var d = s.recommendation;
    var domainName = DOMAIN_NAMES[d.key] || d.key;
    var parts = [];
    if (d.unseen > 0) parts.push(d.unseen + " unseen question" + (d.unseen === 1 ? "" : "s"));
    if (d.due > 0) parts.push(d.due + " due for review");
    if (d.attempted > 0) parts.push(Math.round(d.accuracy * 100) + "% accuracy so far");
    var detail = parts.length ? " (" + parts.join(", ") + ")" : "";
    return "Study " + domainName + detail + ".";
  };

  // ---- Mentor-review selection (ticket #049) ----
  // Pure canonical selector: due → unseen → oldest refresh for a real domain.
  // MIX resolves through current DatamonProgress recommendation.
  // Never mutates input telemetry. Deterministic for a given snapshot.
  API.selectReviewQuestion = function (questionBank, questionStats, seenCounter, requestedDomain) {
    var domain = requestedDomain;
    if (domain === "MIX") {
      var summary = API.summarise(questionBank, questionStats, seenCounter);
      domain = summary.recommendationKey;
    }
    if (!DOMAIN_KEYS.includes(domain)) domain = "AGENT";

    var bank = (questionBank && questionBank[domain]) || [];
    var sc = safeNonNegativeInt(seenCounter);
    var stats = questionStats && typeof questionStats === "object" ? questionStats : {};

    var ranked = bank.map(function (q, index) {
      if (!q || typeof q.id !== "string" || !Array.isArray(q.c) || q.c.length !== 4) return null;
      var st = stats[q.id] || {};
      var seen = safeNonNegativeInt(st.seen);
      var correct = safeNonNegativeInt(st.correct);
      var wrong = safeNonNegativeInt(st.wrong);
      var lastSeen = safeNonNegativeInt(st.lastSeen);
      var due = seen > 0 && (wrong >= correct || sc - lastSeen >= DEFAULT_SEEN_GAP);
      var unseen = (correct + wrong) === 0;
      return {
        question: q, index: index, seen: seen, correct: correct,
        wrong: wrong, lastSeen: lastSeen, due: due, unseen: unseen,
        delta: wrong - correct,
      };
    });

    ranked = ranked.filter(function (item) { return !!item; });
    // due: greatest wrong-minus-correct deficit, then oldest lastSeen, then canonical index
    var due = ranked.filter(function (r) { return r.due; })
      .sort(function (a, b) {
        return (b.delta - a.delta) || (a.lastSeen - b.lastSeen) || (a.index - b.index);
      });
    // unseen: canonical bank index
    var unseen = ranked.filter(function (r) { return !r.due && r.unseen; })
      .sort(function (a, b) { return a.index - b.index; });
    // refresh: oldest lastSeen, then canonical index
    var refresh = ranked.filter(function (r) { return !r.due && !r.unseen; })
      .sort(function (a, b) { return (a.lastSeen - b.lastSeen) || (a.index - b.index); });

    var pick = due[0] || unseen[0] || refresh[0] || null;
    if (!pick) return null;

    return {
      domain: domain,
      index: pick.index,
      question: pick.question,
      reason: pick.due ? "due" : (pick.unseen ? "unseen" : "refresh"),
    };
  };

  // Pure telemetry application. Returns new questionStats + seenCounter + a consumed
  // event token; callers retain that token so retries/repeated UI dispatch are no-ops.
  // Inputs are never mutated.
  API.applyReviewTelemetry = function (questionStats, seenCounter, review, event) {
    var stats = questionStats && typeof questionStats === "object" ? questionStats : {};
    var sc = safeNonNegativeInt(seenCounter);
    var returnedEvent = event && typeof event === "object" ? Object.assign({}, event) : null;
    var out = {};
    var keys = Object.keys(stats);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var v = stats[k];
      if (v && typeof v === "object") {
        out[k] = {
          seen: safeNonNegativeInt(v.seen),
          correct: safeNonNegativeInt(v.correct),
          wrong: safeNonNegativeInt(v.wrong),
          lastSeen: safeNonNegativeInt(v.lastSeen),
        };
      }
    }

    if (!review || !review.question || !DOMAIN_KEYS.includes(review.domain) ||
        !Number.isInteger(review.index) || review.index < 0 ||
        typeof review.question.id !== "string" || !event || event.consumed === true) {
      return { questionStats: out, seenCounter: sc, changed: false, event: returnedEvent };
    }

    var canonical = review.question.id;
    var alias = review.domain + ":" + review.index;
    var base = out[canonical] || out[alias] || {};
    var next = {
      seen: safeNonNegativeInt(base.seen),
      correct: safeNonNegativeInt(base.correct),
      wrong: safeNonNegativeInt(base.wrong),
      lastSeen: safeNonNegativeInt(base.lastSeen),
    };

    if (event.type === "reveal") {
      next.seen++;
      next.lastSeen = ++sc;
    } else if (event.type === "answer" &&
               (event.correct === true || event.correct === false)) {
      if (event.correct) next.correct++;
      else next.wrong++;
    } else {
      return { questionStats: out, seenCounter: sc, changed: false, event: returnedEvent };
    }

    returnedEvent = Object.assign({}, returnedEvent, { consumed: true });
    out[canonical] = { seen: next.seen, correct: next.correct, wrong: next.wrong, lastSeen: next.lastSeen };
    out[alias] = { seen: next.seen, correct: next.correct, wrong: next.wrong, lastSeen: next.lastSeen };
    return { questionStats: out, seenCounter: sc, changed: true, event: returnedEvent };
  };

  window.DatamonProgress = API;
})();
