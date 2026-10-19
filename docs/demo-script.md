# Demo script

A ten-minute run that shows the whole idea: you talk to Claude, Claude calls the VoiceOps tools, the server decides what is allowed, and a screen shows the result. Everything here uses the three fictional demo workspaces. Status: **written from the implemented behaviour and tried piece by piece; three clean consecutive rehearsals by a person are still to do** (checklist at the end).

## Before you start (about two minutes)

1. PostgreSQL is running, then reset the data so every run starts the same:

   ```bash
   npm run db:reset
   ```

2. The server is built (`npm --prefix server-ts run build`) and registered with Claude as in the README. Include all three workspaces: `VOICEOPS_WORKSPACES=northside-warehouse,harbor-cafe,eastside-repairs`. Restart the client after a rebuild.
3. Start the board on a second screen or window and leave it running:

   ```bash
   VOICEOPS_WORKSPACES=northside-warehouse,harbor-cafe,eastside-repairs npm run board
   ```

   The board serves only the workspaces on that list, like the MCP server, so name all three. Open <http://127.0.0.1:8787/> (the warehouse). The cafe is `/board/harbor-cafe`, the repair shop `/board/eastside-repairs`. A board that is open when the data is reset updates itself within a few seconds.
4. Optional: for the spreadsheet part, connect a workspace to a Google Sheet ([`google-sheets-setup.md`](google-sheets-setup.md)) and run `npm run worker`. Skip the lines marked *(sheet)* if you have not.

## The script

Say it however you like; the wording does not have to be exact. "Board" means the browser window from step 3.

### Act 1: the warehouse

| # | You say | What should happen | Point to make |
| --- | --- | --- | --- |
| 1 | "Use voiceops check-health." | Database ok, your workspaces listed. | The server is real and connected. |
| 2 | "What do we have in stock?" then "How many air filters are there?" | Air Filter 35, Oil Filter 20, Brake Pads 12, Compressor 2. | Names are matched the way people say them. |
| 3 | "Add twenty air filters." | Applied at once: Air Filter is now 55. Board shows 55. *(sheet)* The answer says the spreadsheet update is pending; the row appears in the sheet in seconds. | Safe changes do not nag. |
| 4 | "Remove ten from the filter." | Claude asks: Air Filter or Oil Filter? Nothing changes. | Ambiguity is a question, never a guess. |
| 5 | "Remove ten brake pads." | Stock goes to 2, below the reorder level of 5. The answer includes a low-stock alert. **The board shows a red alert banner and highlights the row.** | One command, an audited event and an alert. |
| 6 | "Mark compressor two under maintenance." | Claude reads it back and waits. Board still shows it available. Say "yes": applied, the board shows a maintenance chip. Say "no" instead and nothing changes. | The server enforces the yes; the model cannot skip it. |
| 7 | "Undo my last change." | Claude asks first, then puts the compressor back. | Every change is reversible and recorded. |
| 8 | "Add two hundred oil filters." | Large changes ask for approval too. Say "no". | Thresholds are configuration, not code. |
| 9 | "Show me the recent changes." | Who, when, before and after, and the sheet state. | Full audit trail. |

### Act 2: the same engine, a different business

| # | You say | What should happen |
| --- | --- | --- |
| 10 | "In the cafe, mark biryani sold out." | Claude asks which biryani (Chicken or Veg). Answer "Chicken Biryani", confirm. The cafe board shows it struck through. |
| 11 | "In the repair shop, assign job one oh eight to Rahul." | Read-back, then confirm. The repair board shows Rahul on Job 108. |
| 12 | "Assign job 110 to Vikram." | Refused: Vikram is off duty. Nothing changes. |

### Act 3: when things go wrong *(optional)*

- **The screen loses the server.** Stop `npm run board` (Ctrl-C). The page keeps the last board and shows an amber "Offline: showing the last update from …" banner; start it again and the banner clears by itself.
- **The spreadsheet fails.** *(sheet)* Unshare the sheet from the service account and make a change: the change still succeeds, the answer and `list-events` show the update as retrying or failed with a readable reason. Re-share, then say "retry the sync": it turns synced.
- **A repeated request.** Say a change with a key ("add five air filters using key demo-1"), then say it again: the second time Claude reports it was already applied and stock does not move.

## After the run

Reset for the next one:

```bash
npm run db:reset
```

Or, in a session that has demo tools on (`VOICEOPS_DEMO_TOOLS=true`, local database only): "Reset the demo workspace" (it needs your explicit confirmation).

## Rehearsal checklist

Tick each only after a person has run the whole script, from a reset, without touching the database by hand.

- [ ] Run 1 clean
- [ ] Run 2 clean
- [ ] Run 3 clean

If a run fails, write down which step and what you saw in the newest `CHANGELOG.md` entry; do not fix the data by hand.
