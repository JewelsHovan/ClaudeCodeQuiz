Save my study progress from this session.

This command maintains the **spaced-repetition memory** in `profile/learner.md`. It can run in two modes:

- **Conversation mode** (default): analyze this session's quiz/study/flashcard activity.
- **Mock-exam mode**: if I paste a `cca-mock-result` JSON (or point you at a file in
  `mock-exams/attempts/` / a downloaded results file), ingest that instead.

---

## A. Analyze the session

From the conversation history (or the pasted mock-exam result JSON), extract:
1. **Questions asked and answers given** — which did I get right vs wrong?
2. **Concepts I struggled with** — where did I need extra explanation or got confused?
3. **Concepts I mastered** — answered confidently and correctly.
4. **Teaching moments / breakthroughs** — what clicked.
5. **Patterns** — am I consistently weak in a specific domain or question type?

If ingesting a mock-exam result JSON, use `perDomain` for the Domain Confidence update, `wrong[]`
(with `tags`) for the spaced-repetition + mistake-log updates, and the top-level score fields for
the Mock Exam History row.

## B. Update `profile/learner.md`

1. **Domain Confidence table** — new confidence (Low / Medium / Medium-High / High), today's date in
   "Last Tested", and update "Best Score" if this session beat it.

2. **Concept Mastery & Spaced Repetition table (Leitner)** — for every concept touched this session:
   - **Correct** → move the concept UP one box (max 5), set Last Reviewed = today, recompute Next Due
     (Box 1→+1 day, Box 2→+3, Box 3→+7, Box 4→+16, Box 5 = mastered), append `✓` to Streak.
   - **Wrong / confused** → drop to **Box 1**, Last Reviewed = today, Next Due = tomorrow, append `✗`.
   - **New concept** not in the table → add it at the appropriate box (1 if missed, 2 if nailed first try).
   - Then refresh the **🔁 Due / overdue** list: concepts whose Next Due ≤ today, weakest/oldest first.

3. **Mistake Log** — prepend a row for each wrong answer: date, question/concept, domain,
   "you picked → correct", and a real **root cause** (the most important column — why I missed it, not
   just that I did). Mark older entries "Resolved? Yes" if I got that concept right this session.

4. **Concepts Mastered** — add concepts that reached Box 5 (don't duplicate).

5. **Concepts Struggling With** — keep this in sync with Box 1–2 concepts (remove ones promoted out).

6. **Weak Areas** — adjust if my profile materially changed.

7. **Mock Exam History** (mock-exam mode only) — append a row: date, type, raw score, scaled estimate,
   pass?, weakest domain.

## C. Append to `profile/session-log.md`

```
## Session YYYY-MM-DD (N)
- **Mode**: [quiz/study/flashcards/weak-spots/mock-exam/mixed]
- **Topics covered**: [list]
- **Score**: X/Y (Z%) or scaled estimate [if applicable]
- **Wrong answers**: [specific concepts missed]
- **Breakthroughs**: [concepts that clicked]
- **Box movements**: [e.g., "tool_choice 1→2, escalation 1→1 (missed again)"]
- **Still struggling**: [concepts to revisit next time]
- **Coach notes**: [learning patterns, recommended next steps]
```

## D. Show me a summary
- What was updated (confidence changes, box movements, new mistakes logged).
- My current **top 3 overdue/weak concepts** to focus on next session.
- Suggested next command (e.g., `/study escalation`, `/quiz domain 1`, or `/mock-exam` if I'm ready to calibrate).
