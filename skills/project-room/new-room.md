<!-- Part of the `project-room` skill. Load this file when running **New room** (the once-per-room build).
     The Non-negotiable principles, Room anatomy and Safety rules in SKILL.md
     still apply in full; they are not repeated here. -->

## Step 6 — New room (build)

Building follows: **ask, then build in phases, then stop at the review gate.**

**Intake (ask first, one at a time, wait for answers):**
1. What is this project, and what is the final **deliverable**?
2. Which folders/paths hold the sources? (Search only those + subfolders.)
3. Any **sensitive/confidential** files that must not be copied or summarized?
4. Anything already known about which sources are current vs outdated, or most
   authoritative?

**Then build:**
1. Pick a kebab-case `<room>` name; optionally an `id_prefix` (e.g. `MEMO`).
2. Create the skeleton — **abort if the room already exists** (never clobber):

```bash
room="$BASE/<room>"
[ -e "$room" ] && echo "ROOM EXISTS: pick another name" || \
  mkdir -p "$room"/{00_originals,01_inbox,02_inventory,03_source_summaries,04_working_brief,05_outputs,06_evidence,07_assets,08_tools,99_review/history}
```

3. Write `room.yaml`:

```yaml
project: <room>
status: active project room
review_status: needs_review    # becomes clean once the human approves the inventory
note: <one-line purpose>
deliverable: <the target deliverable>
last_refreshed: <YYYY-MM-DD>
id_prefix: <PREFIX>          # optional, for stable IDs
source_paths:               # the folders you were told to scan
  - <path>
maintenance_links:
  inventory: 02_inventory/source_inventory.md
  working_brief: 04_working_brief/working_brief.md
  change_log: 99_review/change_log.md
  duplicate_log: 99_review/duplicate_log.md
  conflict_log: 99_review/conflict_log.md
  missing_context: 99_review/missing_context.md
  chat_index: 02_inventory/chat-index.md   # only if the room holds conversations
```

4. Write a `README.md` (title, `Status`, `Review status` — mirroring
   `room.yaml: review_status`, `Last refreshed`, purpose, `## Contents`
   stub, `## Status snapshot` stub, `## Maintenance links`) and seed empty
   `02_inventory/source_inventory.md` (with the 13-col header) + `.csv`, and empty
   `99_review/*` logs.
5. **Populate by phases:** **copy** (never move) the named sources into
   `00_originals/` (unclear relevance → `01_inbox/`), then run **Index** (`index.md`)
   through to its review gate. Do not draft.
