<!-- Part of the `project-room` skill. Load this file when running **Refresh**.
     The Non-negotiable principles, Room anatomy and Safety rules in SKILL.md
     still apply in full; they are not repeated here. -->

## Step 5 — Refresh (update the whole room)

Use when sources changed materially or before a new drafting pass.
1. **Snapshot first** (principle 4), and confirm the room is fully synced with no
   conflict-copy files before writing (see Safety & scope).
2. **Identify changes** vs the existing inventory: new / updated / no-longer-
   present sources, and any whose authority/relevance changed. Do not assume the
   old analysis still holds.
3. Run **Index** for new material. A materially changed source is a new version
   (principle 2); only metadata-only edits mark an existing row `Change = updated`.
   Mark a vanished source `[REMOVED — no longer present]`; never delete its row.
4. Re-run the **duplicate/version** and **conflict** passes — call out any new
   file that contradicts something the working brief treated as settled.
   **Reconcile `chat-index.md`:** every chat/meeting source in the inventory must
   be registered, and each conversation's last-capture date must be the newest
   capture the inventory holds for it.
5. Update `missing_context.md` in three buckets: **now resolved**, **still
   missing**, **newly identified**.
6. Refresh changed summaries; reconcile the working brief, noting superseded
   guidance rather than deleting it.
7. Write a dated `change_log.md` section and regenerate `prep_summary.json`.
8. Bump `last_refreshed` and reset `review_status: needs_review` (principle 5 —
   a refresh invalidates prior approval). Re-check the README `## Status snapshot`
   against what changed and propose corrections rather than only moving the date —
   a fresh date over stale content is worse than an obviously old file.
9. **A second deliverable means a second room.** If the room is asked for a
   deliverable other than its `room.yaml: deliverable`, or scope has shifted
   materially, STOP and recommend a NEW room — do not patch. Report a diff-style
   summary and STOP for review before any new drafting.
