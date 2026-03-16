# Domain 3: Claude Code Configuration & Workflows (20%)

## Task 3.1: CLAUDE.md Configuration Hierarchy

### The Hierarchy (know this cold)
1. **User-level**: `~/.claude/CLAUDE.md` — personal only, NOT shared via version control
2. **Project-level**: `.claude/CLAUDE.md` or root `CLAUDE.md` — shared with team
3. **Directory-level**: Subdirectory `CLAUDE.md` files — scoped to that directory

### Modular Organization
- **`@import`**: Reference external files to keep CLAUDE.md modular
  - Example: `@import ./standards/api-conventions.md`
  - Each package can import only the standards relevant to its domain
- **`.claude/rules/`**: Topic-specific rule files as alternative to monolithic CLAUDE.md
  - e.g., `testing.md`, `api-conventions.md`, `deployment.md`

### Common Exam Scenario
A new team member isn't getting instructions → check if instructions are in `~/.claude/CLAUDE.md` (user-level, not shared) instead of project-level `.claude/CLAUDE.md`.

### Diagnostics
- Use `/memory` command to verify which memory files are loaded
- Diagnose inconsistent behavior across sessions

---

## Task 3.2: Custom Slash Commands and Skills

### Commands
| Scope | Location | Shared? |
|-------|----------|---------|
| Project | `.claude/commands/` | Yes, via version control |
| User | `~/.claude/commands/` | No, personal only |

### Skills (`.claude/skills/` with `SKILL.md`)

**Frontmatter options:**
```yaml
---
context: fork          # Run in isolated sub-agent context
allowed-tools:         # Restrict tool access during execution
  - Read
  - Write
argument-hint: "path"  # Prompt for required parameters
---
```

**Key frontmatter:**
- **`context: fork`**: Prevents skill output from polluting main conversation. Use for:
  - Verbose output (codebase analysis)
  - Exploratory context (brainstorming alternatives)
- **`allowed-tools`**: Restrict tool access (e.g., limit to read-only to prevent destructive actions)
- **`argument-hint`**: Prompts developers for required parameters when invoked without arguments

### Skills vs CLAUDE.md
- **Skills**: On-demand invocation for task-specific workflows
- **CLAUDE.md**: Always-loaded universal standards

### Personal Skill Customization
Create personal variants in `~/.claude/skills/` with different names to avoid affecting teammates.

---

## Task 3.3: Path-Specific Rules

### `.claude/rules/` with YAML Frontmatter
```yaml
---
paths:
  - "terraform/**/*"
---
# Terraform Conventions
- Always use variables for repeated values
- Include description for every variable
```

### Key Advantage
Glob patterns apply to files by TYPE regardless of directory location.

```yaml
---
paths:
  - "**/*.test.tsx"
---
# Test Conventions
- Use React Testing Library, not Enzyme
- Test behavior, not implementation
```

### When to Use Path-Specific Rules vs Directory CLAUDE.md
- **Path-specific rules**: When conventions must apply to files SPREAD across the codebase (e.g., test files next to source files)
- **Directory CLAUDE.md**: When conventions are contained within a single directory tree

### Benefits
- Rules load ONLY when editing matching files → reduces irrelevant context and token usage
- More targeted than putting everything in root CLAUDE.md

---

## Task 3.4: Plan Mode vs Direct Execution

### Plan Mode — Use When:
- Complex tasks with large-scale changes
- Multiple valid approaches to evaluate
- Architectural decisions (microservice restructuring, library migrations)
- Multi-file modifications (45+ files)
- You need safe exploration before committing to changes

### Direct Execution — Use When:
- Simple, well-scoped changes
- Single-file bug fix with clear stack trace
- Adding a single validation check to one function
- Well-understood changes with clear scope

### Explore Subagent
- Isolates verbose discovery output
- Returns summaries to preserve main conversation context
- Prevents context window exhaustion during multi-phase tasks

### Combined Pattern
Plan mode for investigation → direct execution for implementation
Example: Plan a library migration approach, then execute the planned approach.

---

## Task 3.5: Iterative Refinement Techniques

### Input/Output Examples
- Most effective way to communicate expected transformations
- Use when prose descriptions are interpreted inconsistently
- Provide 2-3 concrete examples

### Test-Driven Iteration
1. Write test suites first (expected behavior, edge cases, performance)
2. Iterate by sharing test failures to guide progressive improvement

### Interview Pattern
- Have Claude ask questions to surface considerations you may not have anticipated
- Useful in unfamiliar domains (cache invalidation, failure modes)

### When to Batch vs Sequential
- **Single message**: When fixes interact with each other (interacting problems)
- **Sequential iteration**: When problems are independent

---

## Task 3.6: CI/CD Integration

### Non-Interactive Mode
```bash
claude -p "Analyze this pull request for security issues"
```
The `-p` (or `--print`) flag: processes prompt, outputs to stdout, exits. No interactive input.

### Structured CI Output
```bash
claude -p "Review this PR" --output-format json --json-schema schema.json
```
Produces machine-parseable findings for automated inline PR comments.

### Key Patterns
- **Context isolation**: Same session that generated code is LESS effective at reviewing its own changes. Use independent review instance.
- **Incremental reviews**: Include prior review findings when re-running after new commits. Instruct Claude to report only NEW or still-unaddressed issues.
- **Test generation**: Provide existing test files in context so generation avoids duplicate scenarios.
- **CLAUDE.md for CI**: Document testing standards, valuable test criteria, and available fixtures to improve test generation quality.
