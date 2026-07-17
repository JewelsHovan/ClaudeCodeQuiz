// ============================================================
// DATAMON Contextual Colleague Dialogue — deterministic
// domain-aware dialogue pools. Ticket #047.
// Classic script (no ESM). Exposes window.DatamonDialogue.
// Load AFTER questions.js and progress.js. Pure helper;
// never mutates saves/battles/telemetry.
// ============================================================

"use strict";

(function () {
  var API = {};

  // ---- Dialogue phases ----
  // intro: battle challenge greeting
  // opponent-lose: NPC lost the battle
  // opponent-win: NPC won the battle
  // training-rematch: Battle Room rematch greeting
  // campaign-follow-up: post-defeat office conversation
  var PHASES = ["intro", "opponent-lose", "opponent-win", "training-rematch", "campaign-follow-up"];

  // ---- Domain-aware dialogue pools ----
  // Each phase × domain combination has a small deterministic pool.
  // Selections are keyed by slug + phase so replays are stable.

  var POOLS = {
    AGENT: {
      intro: [
        "Time to stress-test your agent architecture!",
        "Let's see if your subagents can handle this!",
        "I hope your hooks are deterministic today!",
        "Your coordinator loop won't save you now!",
      ],
      "opponent-lose": [
        "Your orchestration is solid. I yield.",
        "Fine — your agent topology checks out.",
        "I'll refactor my subagents before our next match.",
        "Your PreToolUse hooks were too sharp for me!",
      ],
      "opponent-win": [
        "Your agent loop had a stop_reason: end_turn moment.",
        "Maybe fewer subagents next time?",
        "Task delegation needs work. Study up!",
        "Your coordinator got confused. Come back stronger.",
      ],
      "training-rematch": [
        "Back for more agent architecture drills?",
        "Round two — this time I studied the SDK docs!",
        "I've been practicing my hub-and-spoke patterns!",
        "Let's run another agent simulation!",
      ],
      "campaign-follow-up": [
        "You really know your agentic patterns. Respect.",
        "I've been telling everyone about your decomposition skills.",
        "My subagents have never been so well-coordinated. Thanks!",
      ],
    },
    MCP: {
      intro: [
        "Let's test your tool integration knowledge!",
        "I've got some MCP edge cases for you!",
        "Hope you know your transports from your resources!",
        "Let's see if your tool descriptions are precise enough!",
      ],
      "opponent-lose": [
        "Your tool selection was flawless. Well played.",
        "I should have used better error categories!",
        "Your MCP architecture is clearly production-ready.",
        "You really know your enums from your free strings.",
      ],
      "opponent-win": [
        "Your tool descriptions were too vague this time!",
        "That was a JSON-RPC protocol error on your side!",
        "Try annotating your tools more carefully next time.",
        "Your MCP server had a timeout mid-battle!",
      ],
      "training-rematch": [
        "Ready to drill more MCP integration scenarios?",
        "I've added better error handling since last time!",
        "Let's practice tool partitioning strategies!",
        "Another round of MCP transport trivia?",
      ],
      "campaign-follow-up": [
        "You've mastered the MCP spec. I'm impressed.",
        "Our tools have never integrated so smoothly.",
        "Thanks for showing me those OAuth patterns!",
      ],
    },
    CONFIG: {
      intro: [
        "Let's review your Claude Code configuration!",
        "I hope your settings.json is in order!",
        "Time for a CLAUDE.md compliance check!",
        "Permission denied — unless you answer correctly!",
      ],
      "opponent-lose": [
        "Your project configuration is impeccable.",
        "I concede — your .mcp.json is perfectly scoped.",
        "Clearly you've read the settings precedence docs!",
        "Your deny rules were stronger than my allow rules.",
      ],
      "opponent-win": [
        "Your settings.local.json conflicted with the project!",
        "You forgot about enterprise managed policy precedence!",
        "Your permissions model needs a security review.",
        "That was a configuration drift incident waiting to happen!",
      ],
      "training-rematch": [
        "Another settings.json showdown?",
        "I've been practicing my hook exit codes!",
        "Let's run through some permission edge cases!",
        "Rematch — this time I know my @import paths!",
      ],
      "campaign-follow-up": [
        "Your team's CLAUDE.md is now legendary.",
        "Our CI pipeline thanks you for the headless config tips.",
        "You turned our config chaos into clean conventions.",
      ],
    },
    PROMPT: {
      intro: [
        "Let's engineer some prompts — battle style!",
        "I hope your few-shot examples are ready!",
        "Chain-of-thought won't save you from my questions!",
        "Your XML tags better be well-formed!",
      ],
      "opponent-lose": [
        "Your prompt structure was bulletproof. I'm out.",
        "Those few-shot examples were perfectly chosen.",
        "You really know when to use extended thinking.",
        "Your system prompt game is too strong!",
      ],
      "opponent-win": [
        "Your prompt was too vague — be more specific!",
        "That was a classic prompt injection fail.",
        "Your chain-of-thought got tangled mid-reasoning!",
        "Try pre-filling your assistant turn next time!",
      ],
      "training-rematch": [
        "Ready for another prompt engineering drill?",
        "I've been practicing my XML tag hygiene!",
        "Let's workshop some structured output prompts!",
        "Round two — I brought better examples this time!",
      ],
      "campaign-follow-up": [
        "Your prompts are the stuff of Claude legend now.",
        "I've started using your role-prompting technique — game changer.",
        "Our output quality doubled after your prompt tips!",
      ],
    },
    CONTEXT: {
      intro: [
        "Let's see how well you manage context windows!",
        "I hope your context compaction strategy is ready!",
        "Time for a context reliability stress test!",
        "Your knowledge cutoff won't help you here!",
      ],
      "opponent-lose": [
        "Your context management is clearly battle-tested.",
        "I concede — your compaction never lost the key details.",
        "You really understand context window economics!",
        "My stale summaries were no match for your fresh context.",
      ],
      "opponent-win": [
        "Your context window overflowed — classic mistake!",
        "The key details got lost in your compression!",
        "You forgot about the lost-middle phenomenon!",
        "Your context rotation strategy needs work!",
      ],
      "training-rematch": [
        "Another context management sparring session?",
        "I've been optimizing my compaction ratios!",
        "Let's test some long-context retention scenarios!",
        "Rematch — this time I'm bringing 200k tokens!",
      ],
      "campaign-follow-up": [
        "You taught me to never lose the middle. Thanks!",
        "Our context windows have never been so efficient.",
        "The team adopted your compaction strategy. Game changer!",
      ],
    },
    MIX: {
      intro: [
        "Let's mix it up — a little bit of everything!",
        "Ready for a cross-domain challenge?",
        "I've got questions from across the exam blueprint!",
        "Jack of all domains, master of... let's find out!",
      ],
      "opponent-lose": [
        "You really do know a bit of everything. Impressive!",
        "Cross-domain champion! I yield.",
        "Your breadth of knowledge is formidable.",
        "I can't find a weak spot — you're well-rounded!",
      ],
      "opponent-win": [
        "Jack of all trades, master of none — today at least!",
        "Your cross-domain knowledge needs more depth!",
        "A mile wide and an inch deep. Study deeper!",
        "You need focused study, not just broad exposure!",
      ],
      "training-rematch": [
        "Another mixed-domain showdown?",
        "I've been studying ALL the exam domains!",
        "Let's do another cross-domain round!",
        "Rematch — I'm bringing questions from everywhere!",
      ],
      "campaign-follow-up": [
        "You're the most well-rounded consultant on the floor.",
        "From agents to context — you've got it all covered.",
        "The team comes to you for every domain now!",
      ],
    },
  };

  // ---- Fallback pools (used when domain is missing/malformed) ----
  var FALLBACKS = {
    intro: "wants to quiz you before the Foundations exam!",
    "opponent-lose": "Well played! I'll study harder.",
    "opponent-win": "Better luck next time — study up!",
    "training-rematch": "Ready for another training round?",
    "campaign-follow-up": "Thanks for the great battle earlier!",
  };

  // ---- Simple deterministic hash for stable selection ----
  function _hash(slug, phase) {
    var h = 0;
    var str = slug + "|" + phase;
    for (var i = 0; i < str.length; i++) {
      h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
  }

  // ---- Public API ----

  API.PHASES = PHASES;

  // Get the dialogue line for a given slug, phase, and optional
  // override domain. Returns a deterministic string.
  API.getLine = function (slug, phase, domainOverride) {
    if (PHASES.indexOf(phase) < 0) phase = "intro";
    var domain = (domainOverride && POOLS[domainOverride]) ? domainOverride : "MIX";
    var pool = (POOLS[domain] && POOLS[domain][phase])
      ? POOLS[domain][phase]
      : null;
    if (!pool || !pool.length) {
      return FALLBACKS[phase] || FALLBACKS.intro;
    }
    var idx = _hash(slug, phase) % pool.length;
    return pool[idx];
  };

  // Get the full intro message for a battle (NPC challenges you).
  API.battleIntro = function (npcSlug, npcType, displayNameFn) {
    var name = (typeof displayNameFn === "function")
      ? displayNameFn(npcSlug)
      : npcSlug;
    var line = API.getLine(npcSlug, "intro", npcType);
    return name + " " + line;
  };

  // Get the opponent-loss message (NPC was defeated).
  API.opponentLoss = function (npcSlug, npcType, displayNameFn) {
    var name = (typeof displayNameFn === "function")
      ? displayNameFn(npcSlug)
      : npcSlug;
    var line = API.getLine(npcSlug, "opponent-lose", npcType);
    return line;
  };

  // Get the opponent-win message (player lost).
  API.opponentWin = function (npcSlug, npcType, displayNameFn) {
    var name = (typeof displayNameFn === "function")
      ? displayNameFn(npcSlug)
      : npcSlug;
    var line = API.getLine(npcSlug, "opponent-win", npcType);
    return line;
  };

  // Get the training rematch intro.
  API.trainingRematch = function (npcSlug, npcType, displayNameFn) {
    var name = (typeof displayNameFn === "function")
      ? displayNameFn(npcSlug)
      : npcSlug;
    var line = API.getLine(npcSlug, "training-rematch", npcType);
    return name + " " + line;
  };

  // Get the campaign follow-up (post-defeat office chat).
  API.campaignFollowUp = function (npcSlug, npcType, displayNameFn, domainProgress) {
    var name = (typeof displayNameFn === "function")
      ? displayNameFn(npcSlug)
      : npcSlug;
    var line = API.getLine(npcSlug, "campaign-follow-up", npcType);
    // Optional read-only evidence lets a mentor point toward real study needs without
    // coupling this pure dialogue module to saves or question telemetry.
    if (domainProgress && typeof domainProgress === "object") {
      if (domainProgress.due > 0) {
        line += " You still have " + domainProgress.due + " concept" +
          (domainProgress.due === 1 ? "" : "s") + " due here—review those next.";
      } else if (domainProgress.unseen > 0) {
        line += " There are " + domainProgress.unseen + " unseen question" +
          (domainProgress.unseen === 1 ? "" : "s") + " left in this domain.";
      } else if (domainProgress.attempted > 0) {
        line += " Your evidence covers this whole domain; keep it fresh.";
      }
    }
    return name + ': "' + line + '"';
  };

  // ---------- Declarative portrait scenes (#052) ----------
  // These factories contain authored copy only. DatamonDialogueRuntime validates/freezes
  // every returned script and owns all mutable progression.
  function sceneSpeaker(name, slug, side, domain, expression) {
    return { name: name, slug: slug, side: side, domain: domain || "MIX", expression: expression || "neutral" };
  }
  function sceneEffect(type) { return { type: type }; }

  API.prologueScript = function (playerSlug, displayNameFn) {
    var playerName = displayNameFn(playerSlug);
    var command = sceneSpeaker("Certification Command", null, "system", "MIX", "signal");
    var candidate = sceneSpeaker(playerName, playerSlug, "right", "MIX", "ready");
    return {
      id: "certification-prologue-v1",
      startBeat: "link",
      skipEffects: [sceneEffect("ACTIVATE_QUEST")],
      beats: {
        link: {
          id: "link", speaker: command,
          text: "Candidate link established. Welcome to DATAMON, the Claude Code certification campus.",
          next: "purpose",
        },
        purpose: {
          id: "purpose", speaker: candidate,
          text: "I am here to become a consultant—and prove I can use Claude Code with judgment, not just speed.",
          next: "commit",
        },
        commit: {
          id: "commit", speaker: command,
          text: "Your field run tests five operating domains: Agents, MCP, Config, Prompt, and Context. How will you enter the program?",
          choices: [
            { label: "Begin the certification run.", next: "objective" },
            { label: "Brief me on the standard first.", next: "standard" },
          ],
        },
        standard: {
          id: "standard", speaker: command,
          text: "Certification means answering with evidence, learning from misses, and defeating every consultant without changing what is true.",
          next: "objective",
        },
        objective: {
          id: "objective", speaker: command,
          text: "First objective: report to the Certification Console in the center spine. Review your evidence, then challenge colleagues when ready.",
          effects: [sceneEffect("ACTIVATE_QUEST")], next: null,
        },
      },
    };
  };

  API.consoleArrivalScript = function (playerSlug, displayNameFn) {
    var command = sceneSpeaker("Certification Command", null, "system", "MIX", "objective");
    return {
      id: "certification-console-arrival-v1",
      startBeat: "arrival",
      skipEffects: [sceneEffect("OPEN_CERT_CONSOLE")],
      beats: {
        arrival: {
          id: "arrival", speaker: command,
          text: "Console handshake accepted, " + displayNameFn(playerSlug) + ". Your five evidence channels are online. Field objective updated: challenge colleagues across every domain.",
          effects: [sceneEffect("OPEN_CERT_CONSOLE")], next: null,
        },
      },
    };
  };

  API.challengeScript = function (npcSlug, type, playerSlug, displayNameFn, training) {
    var opponent = sceneSpeaker(displayNameFn(npcSlug), npcSlug, "left", type, training ? "focused" : "challenge");
    var candidate = sceneSpeaker(displayNameFn(playerSlug), playerSlug, "right", "MIX", "ready");
    return {
      id: (training ? "training-challenge:" : "campaign-challenge:") + npcSlug,
      startBeat: "challenge",
      skipEffects: [sceneEffect("CLOSE_DIALOGUE")],
      beats: {
        challenge: {
          id: "challenge", speaker: opponent,
          text: API.getLine(npcSlug, training ? "training-rematch" : "intro", type), next: "response",
        },
        response: {
          id: "response", speaker: candidate,
          text: training ? "Run this as an isolated training simulation?" : "Accept this certification challenge?",
          choices: [
            { label: training ? "Start simulation" : "Challenge accepted", next: "lock" },
            { label: "Not yet", effects: [sceneEffect("CLOSE_DIALOGUE")] },
          ],
        },
        lock: {
          id: "lock", speaker: opponent,
          text: API.getLine(npcSlug, "intro", type).replace(/[!.?]?$/, ".") + " Load your active Battlemon.",
          effects: [sceneEffect("START_BATTLE")], next: null,
        },
      },
    };
  };

  API.outcomeScript = function (npcSlug, type, displayNameFn, playerWon, training) {
    var opponent = sceneSpeaker(displayNameFn(npcSlug), npcSlug, "left", type, playerWon ? "respect" : "victory");
    var line = API.getLine(npcSlug, playerWon ? "opponent-lose" : "opponent-win", type);
    line += training
      ? " Simulation logged; campaign progress remains isolated."
      : (playerWon ? " Challenge recorded in your certification ledger." : " Recover, review the evidence, and return when ready.");
    return {
      id: (training ? "training-outcome:" : "campaign-outcome:") + npcSlug + ":" + (playerWon ? "win" : "loss"),
      startBeat: "reaction",
      skipEffects: [sceneEffect("CLOSE_DIALOGUE")],
      beats: {
        reaction: {
          id: "reaction", speaker: opponent, text: line,
          effects: [sceneEffect("CLOSE_DIALOGUE")], next: null,
        },
      },
    };
  };

  API.mentorScript = function (npcSlug, type, playerSlug, progress, displayNameFn) {
    var opponent = sceneSpeaker(displayNameFn(npcSlug), npcSlug, "left", type, "mentor");
    var total = progress && progress.total || 0;
    var defeatedCount = progress && progress.defeated || 0;
    var domainTotal = progress && progress.domainTotal || 0;
    var domainDefeated = progress && progress.domainDefeated || 0;
    var remaining = Math.max(0, total - defeatedCount);
    var domainRemaining = Math.max(0, domainTotal - domainDefeated);
    var evidence = remaining === 0
      ? "Every consultant is cleared. Your final certification review is ready."
      : (domainRemaining === 0
        ? "This domain is cleared; " + remaining + " consultant" + (remaining === 1 ? " remains." : "s remain.")
        : domainRemaining + " in this domain and " + remaining + " overall remain.");
    return {
      id: "mentor-handoff:" + npcSlug,
      startBeat: "handoff",
      skipEffects: [sceneEffect("CLOSE_DIALOGUE")],
      beats: {
        handoff: {
          id: "handoff", speaker: opponent,
          text: API.getLine(npcSlug, "campaign-follow-up", type) + " " + evidence + " I can run one focused review now.",
          effects: [sceneEffect("OPEN_MENTOR_REVIEW")], next: null,
        },
      },
    };
  };

  window.DatamonDialogue = API;
})();
