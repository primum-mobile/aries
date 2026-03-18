#!/bin/bash
# wip_backup.sh — auto-snapshot uncommitted changes every 30 min.
# Creates a stash entry (visible with `git stash list`) then immediately
# re-applies it so your working directory is never disturbed.
# Keeps the 20 most recent auto-wip stashes; older ones are pruned.

WORKSPACE="/Users/Max/Documents/morinus-workspace"
LOG="$WORKSPACE/tools/wip_backup.log"

cd "$WORKSPACE" || exit 1

# Detect any changes (staged, unstaged, or untracked)
CHANGED=0
git diff --quiet          || CHANGED=1
git diff --cached --quiet || CHANGED=1
[ -n "$(git ls-files --others --exclude-standard)" ] && CHANGED=1

if [ "$CHANGED" -eq 0 ]; then
    exit 0
fi

TIMESTAMP=$(date "+%Y%m%d-%H%M%S")
BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "detached")

# Save snapshot (stash keeps it safe in .git even if working dir is wiped)
git stash push --include-untracked -m "auto-wip $TIMESTAMP (branch: $BRANCH)" > /dev/null 2>&1
STASH_STATUS=$?

if [ "$STASH_STATUS" -ne 0 ]; then
    echo "[$TIMESTAMP] ERROR: stash failed" >> "$LOG"
    exit 1
fi

# Restore working directory without dropping the stash entry
git stash apply stash@{0} > /dev/null 2>&1

echo "[$TIMESTAMP] Snapshot saved on branch $BRANCH" >> "$LOG"

# Prune: keep only the 20 most recent auto-wip stashes
# (manual stashes and named stashes are untouched)
COUNT=0
git stash list | grep "auto-wip" | while IFS= read -r line; do
    COUNT=$((COUNT + 1))
    if [ "$COUNT" -gt 20 ]; then
        INDEX=$(echo "$line" | grep -oE 'stash@\{[0-9]+\}')
        [ -n "$INDEX" ] && git stash drop "$INDEX" > /dev/null 2>&1
    fi
done

# Keep log trim (last 200 lines)
if [ -f "$LOG" ]; then
    tail -200 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi
