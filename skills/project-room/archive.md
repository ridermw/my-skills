<!-- Part of the `project-room` skill. Load this file when running **Archive superseded outputs**.
     The Non-negotiable principles, Room anatomy and Safety rules in SKILL.md
     still apply in full; they are not repeated here. -->

## Step 7 — Archive superseded outputs (optional)

Every other operation adds files, so superseded drafts pile up beside current
ones with no way to tell which is live. This is the only operation that relocates
an **output** — never a source, `00_originals/`, or a `99_review/history/`
snapshot.

1. **The human names the superseded set.** Propose it; never decide it, and never
   infer supersession from dates alone.
2. **Snapshot first** (principle 4) and confirm the room is sync-clean.
3. **Write the move plan to `change_log.md` before moving anything** — old path →
   new path per file.
4. **Move, never delete**, into `05_outputs/_superseded/`: skip an entry whose
   source is already gone and suffix any destination collision (principle 10), so
   re-running an interrupted pass is safe. The logged plan *is* the resolution
   index — a reference naming a moved file resolves through `change_log.md`.
   Re-verify sync-clean.
5. Report the moves. A superseded **source** is never archived this way — it
   keeps its row and its bytes and is marked in the inventory (principle 2).
