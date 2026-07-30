<!-- Part of the `project-room` skill. Load this file when running **Index** (folding new material into the inventory).
     The Non-negotiable principles, Room anatomy and Safety rules in SKILL.md
     still apply in full; they are not repeated here. -->

## Step 3 — Index (inventory + build the retrieval layer)

Fold `01_inbox/` (and any un-indexed `00_originals/`) into the inventory **and**
produce the summary tier.
1. Determine the room's `id_prefix` (from `room.yaml`, else none) and the highest
   existing S-number.
2. For each new source: assign the next `S###`, fill all columns, mark **Change =
   new** (never renumber — principle 2). The **Key claims or content** cell is
   mandatory and must be a tight, specific one-liner — it is the abstract the
   seek protocol scans. Sensitive sources are metadata-only (principle 7).
3. **Build the summary tier:** for every high/medium-relevance **non-sensitive**
   source, write `03_source_summaries/<SourceID>-<slug>.md` (**150–300 words**)
   answering: (1) what is this source? (2) what does it contain that matters? (3)
   what claims/numbers/decisions does it support? (4) limitations? (5) how should
   it be used in the deliverable? Cite the Source ID; flag uncertainty.
4. **Heavy inbox (many/large files)?** Run the scan in a subagent that returns
   draft rows + summaries, so the main session never loads the raw bytes.
5. Move indexed items from `01_inbox/` into `00_originals/` only if the user wants
   the inbox drained; else record the inbox path. State which you did.
6. Regenerate `source_inventory.csv` (identical columns/order). **If any new
   source is a chat/meeting capture, register it in `chat-index.md` under its
   `chat_id`** with its coverage window and completeness — an unregistered
   capture makes a covered thread look stale. If the room has no chat index yet,
   create it using the canonical shape in `SKILL.md` ("Conversation index");
   inventing a different layout makes the index unreadable to everything else.
7. **Duplicate/version pass (mandatory):** scan for exact duplicates, likely
   duplicates, and version families. Propose which is current and why. Delete
   nothing; record in `duplicate_log.md`.
8. **Conflict + missing-context pass (mandatory):** compare claims/numbers/
   decisions across sources. Log to `conflict_log.md` (who disagrees, which is
   more authoritative, does it need human judgment) and `missing_context.md`
   (referenced-but-absent sources, unsupported claims, numbers without stated
   assumptions, decisions with no owner). Never resolve silently.
9. Update `00_originals/README.md` index if you added originals.
10. **STOP — the review gate.** Set `review_status: needs_review` in `room.yaml` and in
    the README, then present a summary (files scanned, high/med/low counts,
    duplicates/version families, conflicts/missing items, top 3–5 items needing
    review), **state whether anything just indexed contradicts the README
    `## Status snapshot`** (if it does, say which line and propose the
    correction — do not edit it silently), and ask: "Review the inventory and
    working brief; tell me what to correct before I draft anything." Do not
    draft here. Only when the human approves do you set `review_status: clean`.

## Working brief

After indexing, write/update `04_working_brief/working_brief.md`: project + target
deliverable, the recommended source hierarchy (which sources are authoritative /
supporting / background / excluded, by ID), well-supported facts (with IDs),
unsupported/conflicting facts (with notes), the missing-context summary, and a
clear list of items needing human review before drafting.

**Which surface owns what:** the working brief owns the *evidence* view (what is
supported, by which IDs, what is missing). The README `## Status snapshot` owns
the *state* view (done / next / blocked) and stays the one surface that says
which dated document is live.
