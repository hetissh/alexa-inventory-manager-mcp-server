# Connecting a workspace to Google Sheets

VoiceOps copies every committed change to a Google Sheet: a **Resources** tab that always shows the current state, and an append-only **Activity** tab with one row per change. The database stays the source of truth; the sheet is a synchronised view (edits made by hand in the Resources tab are overwritten on the next sync).

This takes about 15 minutes and is done once. **Use demo data and a Google account that belongs to Mako, never a client's account or client data.**

## What you need to do

1. **Pick a Google Cloud project** you may use (or create one) and note its name.
2. **Enable the Google Sheets API** in that project: Google Cloud console → *APIs & Services* → *Library* → search "Google Sheets API" → *Enable*.
3. **Create a service account**: *IAM & Admin* → *Service Accounts* → *Create service account* (for example `voiceops-sheets`). It needs **no project roles**: skip the "grant access" steps. Copy its email address (it ends in `.iam.gserviceaccount.com`).
4. **Create a key for it**: open the service account → *Keys* → *Add key* → *Create new key* → *JSON*. A file downloads.
   - Move it somewhere **outside this repository**, for example `~/.config/voiceops/google-service-account.json`, and restrict it: `chmod 600 ~/.config/voiceops/google-service-account.json`.
   - **The file is a secret.** Do not commit it, paste it into a chat or ticket, or email it. Delete the key in the console (*Keys* → delete) when the demo is over.
   - If your organisation blocks key creation (an organisation policy named "Disable service account key creation"), tell me. The code uses *Application Default Credentials*, so `gcloud auth application-default login` (your own Google sign-in) works instead, with no code change: skip steps 3 and 4 and share the sheet with your own account.
5. **Create a blank Google Sheet** for each workspace you want synced (start with `northside-warehouse`; `harbor-cafe` and `eastside-repairs` work the same way). Name it something obvious such as "VoiceOps – Northside (demo)". Click *Share*, add the service account's email as **Editor**, and do **not** enable "anyone with the link". You do not need to create any tabs: VoiceOps creates "Resources" and "Activity" itself.
6. **Copy each sheet's URL** (or just the id: the long string between `/d/` and `/edit`).

## What to give me (none of it is secret)

- the **URL or id of each sheet**, and which workspace each one is for;
- the **service account email** (so I can check the sharing is right);
- the **absolute path** of the key file. **Not its contents.**

## Then, to connect and run it

Tell the server where the key is, once, in `server-ts/.env` (which is gitignored; create it by hand):

```text
GOOGLE_APPLICATION_CREDENTIALS=/Users/you/.config/voiceops/google-service-account.json
```

Connect a workspace: this proves the sheet can be reached, creates the two tabs, writes the current state into the Resources tab, and from then on queues every change for syncing:

```bash
npm run sheets -- connect northside-warehouse "https://docs.google.com/spreadsheets/d/<id>/edit"
```

Start the background worker in its own terminal and leave it running (it is a separate process from the MCP server, because Claude starts and stops the MCP server whenever it likes):

```bash
npm --prefix server-ts run build
npm run worker
```

Then change something through Claude ("add twenty air filters") and watch the sheet: the Resources row and a new Activity row appear within a few seconds. Claude first says the spreadsheet update is *pending*; ask it to show the recent changes a moment later and it reports *synced*.

Other commands: `npm run sheets -- check <workspace>` (is the sheet still reachable?) and `npm run sheets -- disconnect <workspace>`.

## If something is wrong

The activity log shows each update's state and, when it failed, why; `get-workspace` shows how many updates are waiting, retrying or failed.

| You see | Likely cause | Fix |
| --- | --- | --- |
| "Google credentials are not set up…" | `GOOGLE_APPLICATION_CREDENTIALS` is unset or wrong | Set it in `server-ts/.env` to the key file's absolute path |
| "Google denied access to the spreadsheet…" | The sheet is not shared with the service account | Share it as **Editor** with the service account's email |
| "The spreadsheet was not found…" | Wrong id, or the sheet was deleted | Reconnect with the right id |
| "Google is limiting requests…" | Sheets API quota | Nothing: it retries with backoff. Check the quota in the console (*APIs & Services* → *Google Sheets API* → *Quotas*) |
| Updates stay *pending* and never clear | The worker is not running | `npm run worker` |
| An update says *failed* | It gave up after 8 attempts, or hit a problem a retry cannot fix | Fix the cause, then ask Claude to "retry the spreadsheet update" (`retry-sync`) |

## How it behaves, and its limits

- A burst of changes is written together (one write of the Resources tab and one append to Activity per workspace per cycle), which keeps API usage low. The current Sheets API quotas could not be verified when this was built (Google's documentation site was not reachable from the build environment): check the console before a demo.
- The Resources tab is rewritten from the database each time, so it is always complete and self-healing (deleting its contents or a tab is repaired on the next sync). Hand edits to it are lost.
- Cells are written exactly as given (never parsed), so a name that looks like a formula stays text.
- The default tab size is 1,000 rows, so a workspace can show about 900 resources. Larger workspaces need a bigger grid.
- Activity rows are only added once, even if a retry follows a lost acknowledgement (the worker checks for the event id first). Changes made *before* a workspace is connected are not back-filled into Activity.
- Several workers may run at once: they take turns per workspace, so two never write the same sheet together.
- The key file is read by Google's client library only. It is never logged, and error messages never include credentials.
