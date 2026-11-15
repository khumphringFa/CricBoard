# 🏏 CricBoard

**Local cricket tournament management, ball-by-ball scoring, and a temporary live spectator display.**

CricBoard is a lightweight, mobile-first web app for village tournaments, school competitions, and short-format community cricket matches. No app installation is required. Google sign-in and administrator approval are required to score; spectators can use temporary read-only links without registering.

## Open CricBoard — live app

**[Launch CricBoard / Google account backup sign-in](https://cricboard.manas-tripura.workers.dev/)**

The primary hosted app runs on Cloudflare Workers. Use this URL on your computer or phone. To connect your Google account, open the app and use the Google Drive backup controls. Approved Google sign-in is required for scoring.

## Account registration and administrator approval

Production deployment uses the Git-connected Cloudflare Worker (`main` branch), with `npx wrangler deploy` and the D1 binding from `wrangler.jsonc`. Do not use the static-file uploader for this version.

- Sign in with Google. The configured initial administrator is automatically approved; all other new users remain pending until approved by an administrator.
- Open User approval to approve or suspend organizers. Organizers manage independent tournament collections. Public temporary spectator links remain read-only and do not require sign-in.
- On the administrator's first sign-in, the app offers to copy existing browser records into the administrator's account; the original browser copy is retained. Google Drive backup and restore must use the same Google account as CricBoard sign-in.
- Account records can also be saved or restored explicitly in Cloudflare D1. A revision check prevents a stale device from silently overwriting a newer account copy. Save to the account or Google Drive before switching devices. Do not use a shared untrusted browser profile for sensitive local records.
- Cloudflare D1 binding `DB` is defined in `wrangler.jsonc`; tables are initialized on the first successful Google login, or manually with `schema.sql`. The Google OAuth Web client must allow the production origin; if the consent screen remains in testing, users may need to be added as test users in Google Cloud. For local authenticated development use Wrangler, not a plain static HTTP server. This application now needs a Worker API; GitHub Pages alone cannot host authenticated scoring.

## What works

- Multiple tournaments, team registration, fixtures, and match selection.
- Configure 1–50 overs and batting order for each match.
- Start match, score 0/1/2/3/4/6, wickets, wides, no-balls, byes and leg-byes.
- Undo the last ball, manually end an innings, or automatically finish when overs run out, 10 wickets fall, or the chase is successful.
- Overs, target, runs required, run rates, recent balls, result, extras, and simple points table (win = 2, tie = 1).
- Scores are saved automatically in this device's browser storage, so an accidental reload does not erase the match.
- Optional Google account connection for private Drive backups, version history, restore and conflict-aware device sync.
- Automatic sync while the scorer page is open and Google authorization remains active; offline edits wait on the device.
- Download/upload JSON backups without Google setup, plus a local recovery copy before replacing device data.
- Full-screen spectator scoreboard on projector, TV, laptop, or mobile.
- Temporary real-time display link, with spectators connected by WebRTC through PeerJS Cloud. Spectators cannot change scores.
- A local second-screen link for another tab on the same browser profile, without peer-to-peer service.

## Using the app

1. Open [CricBoard on Cloudflare](https://cricboard.manas-tripura.workers.dev/) and sign in with Google.
2. Add a tournament, at least two teams, and Create fixture. Select Start match.
3. As each ball is delivered, tap the runs, wicket, or the relevant extra. Press Undo if a mistake was made.
4. Tap Start second innings after the innings break. The match completes automatically after a successful chase, all 10 wickets, or the legal balls limit.
5. To share the scoreboard, select the match, tap Start temporary live link, then Copy display link. Open the link in a different browser/device or TV/projector.
6. Keep the scorer page open, connected to the internet, and active during the broadcast. To revoke the link, select Stop sharing. Starting again generates a new random link.
7. For two tabs on the same browser profile, choose Open a display on this device. This uses shared browser storage rather than WebRTC.

### Important limitations

- This is a local-first app, not a central multi-user scoring service. Records remain in the scorer's browser unless you back them up to Google Drive or download a JSON file. Clearing browser data before backup can erase records.
- A live link is temporary, not a permanent hosted feed: the scorer is the host. When the scorer closes the tab, goes offline, or stops sharing, spectators disconnect. Remote detection after abrupt close may depend on timeout.
- WebRTC between different networks sometimes fails because of NAT, firewalls, or mobile-data conditions. PeerJS offers free signaling but not guaranteed TURN relay. For large events or unstable networks, add a hosted database/relay (e.g. Supabase/Firebase) before relying on it for mission-critical scoring.
- New player-tracked fixtures record batter and bowler scorecards, common dismissals and run outs. Existing team-only matches retain their original totals without invented player attribution. DLS, net run rate, super overs, retired/injured batters, fielding credits and audited scorecards remain outside this version.
- Anyone with the temporary public link can watch the score until it is revoked. Use only public team/tournament information.

## Optional: publish with GitHub Pages

Cloudflare is the primary host. GitHub Pages is optional and its workflow at `.github/workflows/pages.yml` runs only when manually requested. Normal pushes run the separate test workflow without attempting a Pages deployment.

1. Go to Settings → Pages → Build and deployment.
2. Select GitHub Actions as the source.
3. In Actions, select **Deploy CricBoard (optional GitHub Pages)** and click **Run workflow** after Pages is enabled.
4. Once deployment succeeds, open the site URL shown in the Pages settings or the workflow deployment output.

The expected site address under the default GitHub Pages project domain is:

`https://khumphringfa.github.io/CricBoard/` (not currently deployed; use the Cloudflare link above).

That address is only valid after Pages is successfully enabled and deployed. The repository Pages address is a hosting location, not the temporary match link. The actual temporary spectator link is generated inside the running app and includes a random ?display= parameter.

**Private repository note:** This repository was private when CricBoard was first created. According to GitHub plan restrictions, Pages on private repositories requires an eligible plan (such as GitHub Pro, Team, or Enterprise). A GitHub Free account normally needs a public repository to use Pages. Do not change repository visibility or expose anything confidential solely to activate the site without reviewing it first.

## Development and tests

No application build step, database, or npm dependencies are required. Browser app files: index.html, styles.css, app.js, engine.mjs, cloud.mjs and favicon.svg. PeerJS loads from a pinned CDN version. Google Identity Services loads on the scorer page when cloud controls initialize.

Run scoring tests with Node.js 20 or later:

    node --test engine.test.mjs cloud.test.mjs

engine.mjs is framework-independent and can later power a server-backed scoring API.

## Future improvements

Schedule brackets, printable scorecards, bilingual English/Bangla UI, and a durable hosted real-time spectator relay for large groups.

## Google Drive backup and restore

Live app: https://cricboard.manas-tripura.workers.dev/

### One-time Google Cloud setup

1. Create/select a Google Cloud project for CricBoard. Enable **Google Drive API**.
2. Configure **Google Auth Platform** branding and audience. If the audience remains in Testing, add each scorer's Google account as a test user. Publish/configure the audience appropriately before inviting other users.
3. Add scopes `openid`, `email`, `profile` and `https://www.googleapis.com/auth/drive.appdata`. CricBoard only requests its own application storage, not access to your ordinary Drive documents.
4. Create an OAuth client with application type **Web application**. Add Authorized JavaScript origin `https://cricboard.manas-tripura.workers.dev` (origin only: no path). For local development add `http://localhost:8000`. Add other hosting origins separately if used. This popup token flow does not require a client secret or a redirect URL in the application.
5. Copy the **public client ID**, ending in `.apps.googleusercontent.com`. In CricBoard expand **Google connection setup**, paste it and select **Save connection setup**. This setting is specific to that browser. For all users/devices, set the same public ID in `index.html`'s `google-client-id` meta tag and deploy. Never commit a client secret, access token or refresh token.
6. Select **Connect Google**, approve app storage access, and verify the displayed Google email. **Sync now** compares records before transferring them. Enable **Automatic sync** only after verifying the account. Automatic sync is paused whenever Google is reconnected to avoid silently uploading to a different account.

Google setup is required before cloud transfers work. File download and restore work without it. The implementation and mocked API tests do not substitute for an end-to-end OAuth test with your actual client ID.

### Everyday use

- **Sync now**: download newer cloud data if this device has no unsynced changes, or upload this device's changes if the cloud has not changed since its last sync. A fresh, empty installation can restore cloud data through Sync now.
- **Backup this device**: make device records the current cloud version. If the cloud differs, a confirmation explains the choice; previous cloud snapshots remain recoverable.
- **Automatic sync**: debounces changes for 15 seconds and checks once a minute while the scorer page stays open. Offline edits remain in browser storage and are retried after reconnecting. Google access tokens expire; reconnect when prompted. There is no background upload after closing the page, and reloading offline is not supported by an offline application cache.
- **Restore selected backup**: select a timestamp in cloud history and confirm the record counts. The existing local data is saved as a recovery copy before replacing it. Restore also stops any live broadcast and pauses automatic sync so you can check scores first. Use Backup this device to publish the restored version as the current cloud data.
- **File backup & recovery**: download a full JSON backup, restore it on another device, or download the last pre-restore recovery copy. Restoring aborts if the recovery copy cannot be saved (for example, browser storage is full).
- **Disconnect**: forget the in-memory Google session on this device, retaining local data and cloud backups. To revoke Google access entirely use your Google Account's third-party connections settings.

Use the **same OAuth client ID and Google account on every device**, and one scoring device at a time. This is snapshot sync rather than simultaneous collaborative scoring. If two devices write concurrently, both immutable snapshots are preserved and sync pauses for a choice; clocks do not decide which scores to discard. Restore the desired version or use Backup this device to resolve. Existing cloud files are never overwritten or automatically deleted.

### Storage and privacy

Backups contain tournaments, teams, player rosters, fixture squad snapshots, innings, deliveries with player attribution, current players, extras, results and active selections. Individual statistics and points tables are reconstructed from these records. Older team-only matches do not have individual statistics.

## Player scorecards and multiple tournaments

1. Create/select the tournament in **Active tournament**. Teams, rosters, fixtures, points and player leaderboards are scoped to that tournament. **All tournaments** shows each tournament's team/match counts and lets you switch without deleting another event's data.
2. Add teams, choose each under **Team squad**, then add player names one per line. A playing squad contains 2–11 players. A player has a stable ID; identical names in different teams or tournaments remain separate.
3. Create a fixture with **Record batter & bowler statistics** selected (default). Both teams must already have squads. The fixture snapshots those squads so adding players later does not change an existing match. Uncheck the option only for simple team-total scoring.
4. Start the match, choose striker, non-striker and bowler, then select **Set players**. Odd completed runs and the end of each six-legal-ball over rotate strike automatically. Select a new bowler each over; consecutive overs by the same bowler are rejected. Select the replacement batter after a wicket. **Swap strike** is available for umpire-confirmed corrections.
5. Score bat runs, wides, no-balls, byes and leg-byes. For a no-ball, choose whether additional runs came off the bat, as byes or leg-byes. The one-run no-ball/wide penalty is automatic and does not itself rotate strike. No-balls count as a ball faced by the batter, wides do not; neither counts as a legal ball for the bowler.
6. **Wicket** opens a form for bowled, caught, LBW, stumped, hit wicket or run out. Run outs can dismiss either batter and include completed runs (excluding the automatic penalty). Choose which end the survivor occupies before the automatic over-end swap. Only run out is supported on a no-ball/free hit; wides permit run out, stumped or hit wicket. No runs are accepted with other dismissal types.
7. Expand each innings scorecard for batter runs, balls, fours, sixes, strike rate and dismissal, plus bowler overs, maidens, runs, wickets, wides, no-balls and economy. Byes/leg-byes are not charged to the bowler; run outs never give a bowler wicket. Six completed legal deliveries with zero runs charged to that bowler form a maiden. Fours/sixes are counted from the boundary scoring buttons or corresponding no-ball bat runs; unusual all-run fours/overthrows need future scoring controls.
8. **Player leaderboards** aggregates batting and bowling within the selected tournament, including current live innings. Batting average uses runs divided by dismissals (shown as — with no dismissals). Strike rate uses runs per 100 balls and bowling economy uses conceded runs per six legal balls. Players who have not entered an innings are shown as did not bat. The live spectator screen includes current batters and bowler figures.

Player-tracked matches end after squad-size-minus-one wickets, or the overs limit; this supports small local teams. No-ball free hits follow the limited-overs convention in every player-tracked fixture. Overthrows, short runs, non-delivery run outs, penalties, unusual dismissals and local free-hit variations are not modeled. Confirm special cases with the umpire before using this scorer. For a completed chase, Undo restores the previous batters, bowler and innings state. Undo also removes the dismissed player's out status and restores a wicket's prior strike.

Refresh all CricBoard tabs after updating so every scoring device uses the same engine. Existing scores and Google client configuration remain intact. Old backups without rosters can still be restored; new player backups are validated against squad membership and replayed player history. Do not try to assign historical team-only balls to players: start a new tracked fixture for that feature.

Scoring references used for this implementation:

- MCC scoring runs: https://www.lords.org/mcc/the-laws-of-cricket/scoring-runs
- MCC changes for caught batters: https://www.lords.org/lords/news-stories/mcc-announces-new-code-of-laws-from-1-october-2022
- New South Wales Cricket Umpires' and Scorers' Association manual (balls faced and scoring): https://nswcusa.cricketnsw.com.au/app/uploads/2020/05/Scorers-Manual-130922-w-sheets.pdf

Snapshots are stored in Google Drive's hidden `appDataFolder`, accessible to this application and account rather than appearing as normal Drive files. Access tokens remain in memory; local preferences retain the public client ID and account-scoped sync revision/hash, never tokens. The Google email is displayed only for the current session. Backups are not encrypted by CricBoard with a separate user-held key. They use HTTPS and Google account access controls. Downloaded files are ordinary JSON.

Previous snapshot versions consume Google Drive storage; there is no automatic retention/deletion policy in this version. The pre-restore recovery copy is local and only the latest one is retained. Cloud payloads are validated for format, references, deliveries, totals and content hash before replacing local records. Maximum backup payload is 10 MiB.

Google Drive backup does not replace the temporary WebRTC spectator feed: the scorer must remain online with its page open for spectators to receive updates.

### Cloudflare deployment

`wrangler.jsonc` supplies the Worker name, compatibility date, static directory and a build command that copies **all six runtime files**, including `cloud.mjs`, to `dist`. This also runs when the existing Cloudflare dashboard command invokes `npx wrangler deploy --assets ./dist` after its original copy step. New changes to main should trigger Cloudflare's connected Git build; check its deployment status after pushing.

If configuring from scratch, leave the dashboard build command empty (Wrangler performs it), use `npx wrangler deploy` as the deploy command, and `npx wrangler versions upload` for preview versions. The separate GitHub Actions test workflow runs scoring and cloud tests even when GitHub Pages is not enabled. The Pages workflow now uploads only the runtime files from `dist`.

Google reference documentation:

- https://developers.google.com/identity/oauth2/web/guides/use-token-model
- https://developers.google.com/workspace/drive/api/guides/appdata
- https://developers.google.com/workspace/drive/api/guides/manage-uploads

### Release verification

Automated checks cover score round-trips, invalid backup rejection, paginated history, concurrent cloud writes, conflict resolution, content integrity, API failures, account connection, offline queue, cloud pull, restore recovery and disconnect. Before a tournament, also test a real Google connection on two devices: backup on A, restore on B, change a score offline, reconnect and sync, then make independent edits on both devices and verify a conflict is shown. Test denied permissions, token expiry and popup blocking. Real Google OAuth and Drive transfers require the configured client ID and interactive account consent.

