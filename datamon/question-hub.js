// Question Hub: accessible, scrollable study UI. The host owns saves and world state;
// this controller owns only filters, a bounded practice session, and DOM focus.
"use strict";
(function () {
  var host, dialog, content, status, dock, view = "questions";
  var filters = { query: "", domain: "all", status: "missed" }, page = 0, session = null;
  var PAGE_SIZE = 12, SESSION_SIZE = 5, lastDockLabel = "";
  var names = DatamonProgress.DOMAIN_NAMES;
  var zoneOrder = ["AGENT", "MCP", "CONFIG", "CONTEXT", "PROMPT", "MIX"];
  var positions = { AGENT: "Northwest", MCP: "North", CONFIG: "Northeast", CONTEXT: "Southwest · through the glass doorway", PROMPT: "South", MIX: "Southeast" };

  function el(tag, text, className) {
    var node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function button(text, action, className) {
    var node = el("button", text, className);
    node.type = "button";
    node.addEventListener("click", action);
    return node;
  }
  function announce(text) { status.textContent = text; }
  function focusHeading() {
    var heading = content.querySelector("h2");
    if (heading) { heading.tabIndex = -1; heading.focus(); }
    content.scrollTop = 0;
  }
  function catalog(snapshot) {
    return DatamonProgress.questionCatalog(snapshot.bank, snapshot.stats, snapshot.seenCounter, snapshot.colleagues);
  }
  function matches(row) {
    var q = filters.query.trim().toLowerCase();
    var text = [row.question.id, row.question.q, row.domain, names[row.domain], row.question.d]
      .concat(row.colleagues.map(function (n) { return n.name; })).join(" ").toLowerCase();
    return (filters.domain === "all" || row.domain === filters.domain) &&
      (filters.status === "all" || row[filters.status]) && (!q || text.includes(q));
  }
  function select(label, options, value, change) {
    var wrap = el("label", label), input = el("select");
    input.setAttribute("aria-label", label);
    options.forEach(function (item) {
      var option = el("option", item[1]); option.value = item[0]; input.append(option);
    });
    input.value = value;
    input.addEventListener("change", function () { change(input.value); });
    wrap.append(input); return wrap;
  }
  function track(target) {
    if (host.track(target)) close();
    else announce("No walking route is available. Return to the office to find this colleague.");
  }
  function colleagueList(people, snapshot, parent) {
    var list = el("ul", null, "hub-colleagues");
    people.forEach(function (n) {
      var item = el("li");
      item.append(el("span", n.name + " · " + (n.defeated ? "Mentor review available" : "Battle available")));
      var find = button("Find " + n.name, function () {
        track({ map: "office", x: n.x, y: n.y, label: n.name });
      });
      find.disabled = snapshot.currentMap !== "office";
      if (find.disabled) find.title = "Return to the office first";
      item.append(find); list.append(item);
    });
    parent.append(list);
    if (!people.length) parent.append(el("p", "No colleagues assigned here in this save. You can still practice every question in the hub.", "hub-muted"));
  }
  function renderQuestions() {
    session = null; content.replaceChildren();
    var snapshot = host.snapshot(), rows = catalog(snapshot);
    content.append(el("h2", "Your question notebook"));
    if (snapshot.writeProtected) content.append(el("p", "This save belongs to a newer game version. You can practice, but changes cannot be saved in this version.", "hub-note"));
    content.append(el("p", "Revisit a miss here—no timer, HP loss, or battle required. Practice includes every difficulty.", "hub-muted"));
    var toolbar = el("div", null, "hub-filters");
    var searchLabel = el("label", "Search questions or colleagues"), search = el("input");
    search.type = "search"; search.placeholder = "Question, ID, topic or colleague"; search.value = filters.query;
    searchLabel.append(search); toolbar.append(searchLabel);
    toolbar.append(select("Topic", [["all", "All topics"]].concat(DatamonProgress.DOMAIN_KEYS.map(function (d) { return [d, names[d]]; })), filters.domain, function (v) { filters.domain = v; page = 0; renderRows(); }));
    toolbar.append(select("Show", [["missed", "Missed before"], ["due", "Due for review"], ["unattempted", "Not yet answered"], ["all", "All questions"]], filters.status, function (v) { filters.status = v; page = 0; renderRows(); }));
    content.append(toolbar);
    content.append(el("p", "Missed before is your full miss history, including questions later answered correctly. Due uses answer counts and the last 18 question draws—not calendar days.", "hub-note"));
    var results = el("section"); results.setAttribute("aria-label", "Question results"); content.append(results);
    search.addEventListener("input", function () { filters.query = search.value; page = 0; renderRows(); });

    function renderRows() {
      results.replaceChildren();
      var filtered = rows.filter(matches);
      // Weakest first within recovery filters; canonical order for the full directory.
      if (filters.status === "missed" || filters.status === "due") filtered.sort(function (a,b) {
        return (b.wrong - b.correct) - (a.wrong - a.correct) || a.lastSeen - b.lastSeen;
      });
      var totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
      page = Math.min(page, totalPages - 1);
      var summary = el("div", null, "hub-actions");
      summary.append(el("strong", filtered.length + " of " + rows.length + " questions"));
      var practiceCount = Math.min(SESSION_SIZE, filtered.length);
      var practice = button("Practice " + practiceCount + (practiceCount === 1 ? " question" : " questions"), function () { startSession(filtered.slice(0, SESSION_SIZE)); }, "hub-primary");
      practice.disabled = !filtered.length; summary.append(practice); results.append(summary);
      if (!filtered.length) {
        results.append(el("h3", filters.status === "missed" && !rows.some(function (r) { return r.missed; }) ? "No missed questions yet" : "No questions match these filters"));
        results.append(el("p", "Try all questions, choose another topic, or clear your search. Battles and hub practice both save your answers.", "hub-muted"));
        results.append(button("Show all questions", function () {
          filters = { query: "", domain: "all", status: "all" }; page = 0; renderQuestions(); focusHeading();
        }));
      }
      filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).forEach(function (row) {
        var card = el("details", null, "hub-question"); card.dataset.domain = row.domain;
        var title = el("summary");
        title.append(el("span", row.question.id + " · " + names[row.domain] + " · " + row.question.d, "hub-kicker"));
        title.append(el("span", row.question.q, "hub-question-text"));
        title.append(el("span", row.correct + " correct · " + row.wrong + " missed" + (row.due ? " · Due" : "") + (row.unattempted ? " · Not yet answered" : ""), "hub-muted"));
        card.append(title);
        var body = el("div", null, "hub-question-body");
        body.append(button("Practice this question", function () { startSession([row]); }, "hub-primary"));
        body.append(el("h3", "Who covers this question?"));
        body.append(el("p", "Shared " + names[row.domain] + " pool · " + positions[row.domain] + ". These colleagues draw from the same topic; no one exclusively owns this question.", "hub-muted"));
        colleagueList(row.colleagues, snapshot, body);
        body.append(el("p", "Mixed-topic colleagues in The Lounge can draw from any topic in battle. Their mentor reviews follow your recommended topic.", "hub-note"));
        if (snapshot.currentMap !== "office") body.append(el("p", "Return to the office to follow directions to a colleague. Practice is available right here.", "hub-note"));
        card.append(body); results.append(card);
      });
      var pager = el("nav", null, "hub-actions"); pager.setAttribute("aria-label", "Question pages");
      var prev = button("Previous page", function () { page--; renderRows(); results.querySelector("nav button").focus(); }); prev.disabled = page === 0;
      var next = button("Next page", function () { page++; renderRows(); results.querySelector("nav button:last-child").focus(); }); next.disabled = page + 1 >= totalPages;
      pager.append(prev, el("span", "Page " + (page + 1) + " of " + totalPages), next); results.append(pager);
      announce(filtered.length + " matching questions. Page " + (page + 1) + " of " + totalPages + ".");
    }
    renderRows();
  }
  function startSession(rows) {
    if (!rows.length) return;
    session = { rows: rows.slice(0, SESSION_SIZE), at: 0, correct: 0, answers: [], answered: false, revealEvent: null, answerEvent: null };
    reveal();
  }
  function reveal() {
    session.answered = false; session.answerEvent = null;
    session.revealEvent = host.record(session.rows[session.at], { type: "reveal", consumed: false });
    renderPractice(); focusHeading();
  }
  function renderPractice() {
    content.replaceChildren();
    var row = session.rows[session.at], q = row.question;
    content.append(el("h2", "Practice " + (session.at + 1) + " of " + session.rows.length));
    content.append(el("p", q.id + " · " + names[row.domain] + " · Untimed · No HP or campaign rewards", "hub-kicker"));
    var question = el("h3", q.q); question.id = "hub-practice-question"; content.append(question);
    var choices = el("div", null, "hub-choices"); choices.setAttribute("role", "group"); choices.setAttribute("aria-labelledby", question.id);
    q.c.forEach(function (choice, index) {
      var node = button((index + 1) + ". " + choice, function () { answer(index); });
      node.disabled = session.answered;
      if (session.answered) {
        if (index === q.a) { node.className = "hub-correct"; node.append(el("strong", " · Correct answer")); }
        else if (index === session.answers[session.at]) { node.className = "hub-wrong"; node.append(el("strong", " · Your answer")); }
      }
      choices.append(node);
    });
    content.append(choices);
    if (session.answered) {
      var feedback = el("section", null, "hub-feedback");
      feedback.append(el("h3", session.answers[session.at] === q.a ? "Correct" : "Not quite—here’s why"));
      feedback.append(el("p", q.x || "The correct answer is " + q.c[q.a] + "."));
      var next = button(session.at + 1 === session.rows.length ? "Finish practice" : "Next question", function () {
        if (++session.at === session.rows.length) renderSummary(); else reveal();
      }, "hub-primary");
      feedback.append(next); content.append(feedback); next.focus();
    }
    content.append(button("Back to questions", function () { renderQuestions(); focusHeading(); }, "hub-back"));
  }
  function answer(index) {
    if (!session || session.answered || !Number.isInteger(index) || index < 0 || index > 3) return;
    session.answered = true; session.answers.push(index);
    var row = session.rows[session.at], correct = index === row.question.a;
    if (correct) session.correct++;
    session.answerEvent = host.record(row, { type: "answer", correct: correct, consumed: false });
    renderPractice();
    announce((correct ? "Correct. " : "The correct answer is " + row.question.c[row.question.a] + ". ") + row.question.x);
  }
  function renderSummary() {
    content.replaceChildren();
    content.append(el("h2", "Practice complete"));
    content.append(el("p", session.correct + " of " + session.rows.length + " correct", "hub-score"));
    content.append(el("p", "Your answers count toward study evidence, not campaign victories. Miss history stays available for future practice.", "hub-muted"));
    var retry = session.rows.filter(function (r, i) { return session.answers[i] !== r.question.a; });
    if (retry.length) content.append(button("Retry " + retry.length + " missed in this session", function () { startSession(retry); }, "hub-primary"));
    content.append(button("Back to questions", function () { renderQuestions(); focusHeading(); }, "hub-back"));
    announce("Practice complete. " + session.correct + " of " + session.rows.length + " correct."); focusHeading();
  }
  function renderMap() {
    session = null; content.replaceChildren();
    var snapshot = host.snapshot(), rows = catalog(snapshot);
    content.append(el("h2", "Map & colleagues"));
    content.append(el("p", "You are in " + snapshot.location + ". Follow a route to an activity, or browse a topic below.", "hub-muted"));
    content.append(el("p", "Missed an answer? Use Questions → Missed before for the exact question. Bested office colleagues offer one topic review; the Battle Room offers unlimited rematches. Library station scores are separate; Timed Recall answers also appear here.", "hub-note"));
    var destinations = el("div", null, "hub-destinations");
    snapshot.destinations.forEach(function (d) {
      var card = el("section"); card.append(el("h3", d.label), el("p", d.purpose, "hub-muted"));
      card.append(button("Directions to " + d.label, function () { track(d); })); destinations.append(card);
    });
    content.append(destinations);
    if (snapshot.tracking) content.append(button("Clear walking directions", function () { host.clearRoute(); renderMap(); focusHeading(); }));
    content.append(el("h3", "Office topic directory · north at the top"));
    var grid = el("div", null, "hub-map-grid");
    zoneOrder.forEach(function (domain) {
      var card = el("section"); card.dataset.domain = domain;
      var topicRows = rows.filter(function (r) { return r.domain === domain; });
      var people = snapshot.colleagues.filter(function (n) { return n.type === domain; });
      card.append(el("h3", names[domain] || "The Lounge"), el("p", positions[domain], "hub-kicker"));
      card.append(el("p", domain === "MIX" ? "Mixed battles · recommended-topic mentor reviews" : topicRows.length + " shared questions · " + topicRows.filter(function (r) { return r.missed; }).length + " missed before", "hub-muted"));
      card.append(button(domain === "MIX" ? "Browse all topics" : "Browse " + names[domain], function () {
        filters.domain = domain === "MIX" ? "all" : domain; filters.status = "all"; filters.query = ""; page = 0; switchView("questions");
      }));
      var details = el("details"); details.append(el("summary", people.length + " colleagues · " + people.filter(function (n) { return n.defeated; }).length + " mentors"));
      colleagueList(people, snapshot, details); card.append(details); grid.append(card);
    });
    content.append(grid);
    if (snapshot.currentMap !== "office") content.append(el("p", "Office colleague directions become available when you return to the office.", "hub-note"));
  }
  function switchView(next) {
    view = next;
    dialog.querySelectorAll("[data-hub-view]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.hubView === view)); });
    if (view === "map") renderMap(); else renderQuestions(); focusHeading();
  }
  function close() {
    if (!dialog || !dialog.open) return;
    dialog.close(); session = null; host.resume();
  }
  function open(options) {
    if (!host.available() || dialog.open) return false;
    host.pause();
    if (options && options.domain) { filters.domain = options.domain; filters.status = "all"; filters.query = ""; }
    if (options && options.status) { filters.status = options.status; filters.query = ""; if (!options.domain) filters.domain = "all"; }
    page = 0; dialog.showModal(); switchView(options && options.view || "questions"); return true;
  }
  window.DatamonQuestionHub = {
    init: function (adapter) {
      host = adapter; dock = document.getElementById("question-hub-toggle");
      dock.addEventListener("click", function () { open(); });
      dialog = el("dialog", null, "question-hub"); dialog.setAttribute("aria-labelledby", "question-hub-title");
      var header = el("header", null, "hub-header"), title = el("h1", "Question Hub"); title.id = "question-hub-title";
      header.append(title, button("Close · Esc", close)); dialog.append(header);
      var nav = el("nav", null, "hub-tabs"); nav.setAttribute("aria-label", "Hub sections");
      [["questions", "Questions"], ["map", "Map & colleagues"]].forEach(function (item) {
        var b = button(item[1], function () { switchView(item[0]); }); b.dataset.hubView = item[0]; nav.append(b);
      });
      dialog.append(nav);
      content = el("div", null, "hub-content"); dialog.append(content);
      status = el("p", null, "hub-sr-only"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite"); dialog.append(status);
      dialog.addEventListener("cancel", function (e) { e.preventDefault(); close(); });
      // Keep Tab inside the notebook rather than cycling into browser chrome. Native
      // modality makes the canvas inert; explicit wrapping also handles rebuilt content.
      dialog.addEventListener("keydown", function (e) {
        if (e.key === "Escape") { e.preventDefault(); close(); return; }
        if (e.repeat && ["Enter", " "].includes(e.key)) e.preventDefault();
        if (e.key === "Tab") {
          var controls = Array.from(dialog.querySelectorAll("button:not(:disabled), input, select, summary"))
            .filter(function (node) { return node.getClientRects().length > 0; });
          var index = controls.indexOf(document.activeElement);
          if (index < 0 || (!e.shiftKey && index === controls.length - 1) || (e.shiftKey && index === 0)) {
            e.preventDefault(); controls[e.shiftKey ? controls.length - 1 : 0].focus();
          }
        }
      });
      document.body.append(dialog);
    },
    open: open,
    isOpen: function () { return !!(dialog && dialog.open); },
    sync: function (available, missed) {
      if (!dock) return;
      dock.hidden = !available || (dialog && dialog.open);
      var label = "Q · Question Hub" + (missed ? " · " + missed + " missed" : "");
      if (label !== lastDockLabel) { dock.textContent = label; lastDockLabel = label; }
    },
  };
})();
