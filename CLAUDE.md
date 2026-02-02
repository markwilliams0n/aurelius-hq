# Claude Code Rules for Aurelius HQ

## Session Start

1. **Check `docs/worklog/now.md`** - Current context: what we just did, what's in progress, what's next
2. **Read `ARCHITECTURE.md`** - How the app works, key systems, patterns

## Worklog Maintenance

**Proactively suggest `/wrap-up`** to keep the worklog current:

- After completing a feature or significant chunk of work
- After multiple commits (3+) in a session
- Before the conversation gets very long (context compaction risk)
- When switching topics or wrapping up for the day
- After merging branches

Keep it lightweight - a quick "Want to run `/wrap-up` to capture this progress?" is enough.

## Process Management Safety

**NEVER use broad pattern matching to kill processes:**

- ❌ `pkill -f <pattern>` - Too broad, can match unrelated processes
- ❌ `killall <name>` - Can kill more than intended
- ✅ `kill <specific-pid>` - Target only the exact process
- ✅ `pkill -x <exact-name>` - Exact match only (no partial matching)

**Before killing any process:**

1. First identify the exact PID using `pgrep -x <name>` or `ps aux | grep <name>`
2. Verify the PID belongs to a process you started in this session
3. Use `kill <pid>` with the specific PID, not pattern matching

## System Software Installation

**Ask before installing system-level software:**

- Network tools (cloudflared, ngrok, etc.)
- System services
- Homebrew packages that affect system behavior

**Never install without explicit user approval.**

## Background Processes

- Don't spawn multiple tunnel/server processes rapidly
- Always track PIDs of processes you start
- Clean up processes you started when done
- If a process fails, don't retry more than 2-3 times without asking

## Tunneling for Local Development

Preferred approaches (in order):
1. Deploy to a real server (Railway, Vercel) for stable testing
2. Use ngrok with user's configured auth token
3. Use localtunnel (unstable but safe)
4. Only use cloudflared if user explicitly approves

## Safe Command Patterns

```bash
# Finding processes - be specific
pgrep -x "node"           # Exact match only
ps aux | grep "[n]ode"    # The bracket trick avoids matching grep itself

# Killing processes - use PIDs
pid=$(pgrep -x "myprocess")
if [ -n "$pid" ]; then
  kill "$pid"
fi

# Or kill specific known PID
kill 12345
```
