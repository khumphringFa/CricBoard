# 🏏 CricBoard

**Local cricket tournament management, ball-by-ball scoring, and a temporary live spectator display.**

CricBoard is a lightweight, mobile-first web app for village tournaments, school competitions, and short-format community cricket matches. No database, app store installation, or account is required for this first version.

## What works

- Multiple tournaments, team registration, fixtures, and match selection.
- Configure 1–50 overs and batting order for each match.
- Start match, score 0/1/2/3/4/6, wickets, wides, no-balls, byes and leg-byes.
- Undo the last ball, manually end an innings, or automatically finish when overs run out, 10 wickets fall, or the chase is successful.
- Overs, target, runs required, run rates, recent balls, result, extras, and simple points table (win = 2, tie = 1).
- Scores are saved automatically in this device's browser storage, so an accidental reload does not erase the match.
- Full-screen spectator scoreboard on projector, TV, laptop, or mobile.
- Temporary real-time display link, with spectators connected by WebRTC through PeerJS Cloud. Spectators cannot change scores.
- A local second-screen link for another tab on the same browser profile, without peer-to-peer service.

## Using the app

1. Open the published CricBoard site (or run a local HTTP server with: python3 -m http.server 8000, then visit http://localhost:8000).
2. Add a tournament, at least two teams, and Create fixture. Select Start match.
3. As each ball is delivered, tap the runs, wicket, or the relevant extra. Press Undo if a mistake was made.
4. Tap Start second innings after the innings break. The match completes automatically after a successful chase, all 10 wickets, or the legal balls limit.
5. To share the scoreboard, select the match, tap Start temporary live link, then Copy display link. Open the link in a different browser/device or TV/projector.
6. Keep the scorer page open, connected to the internet, and active during the broadcast. To revoke the link, select Stop sharing. Starting again generates a new random link.
7. For two tabs on the same browser profile, choose Open a display on this device. This uses shared browser storage rather than WebRTC.

### Important limitations

- This is a local-first MVP, not a central multi-user scoring service. Tournament and score records live only in the scorer's browser. Clearing site data can erase them.
- A live link is temporary, not a permanent hosted feed: the scorer is the host. When the scorer closes the tab, goes offline, or stops sharing, spectators disconnect. Remote detection after abrupt close may depend on timeout.
- WebRTC between different networks sometimes fails because of NAT, firewalls, or mobile-data conditions. PeerJS offers free signaling but not guaranteed TURN relay. For large events or unstable networks, add a hosted database/relay (e.g. Supabase/Firebase) before relying on it for mission-critical scoring.
- The current scorer tracks team totals, extras, wicket counts, and overs, not individual batter/bowler statistics, dismissal categories, DLS, net run rate, super overs, or audited scorecards. A wicket is a legal dot ball; run-outs on wides/no-balls are not yet supported.
- Anyone with the temporary public link can watch the score until it is revoked. Use only public team/tournament information.

## Publish with GitHub Pages

The repository contains an automatic deployment workflow at .github/workflows/pages.yml.

1. Go to Settings → Pages → Build and deployment.
2. Select GitHub Actions as the source.
3. Run the Deploy CricBoard workflow, or push new code to main.
4. Once deployment succeeds, open the site URL shown in the Pages settings or the workflow deployment output.

The expected site address under the default GitHub Pages project domain is:

**https://khumphringfa.github.io/CricBoard/**

That address is only valid after Pages is successfully enabled and deployed. The repository Pages address is a hosting location, not the temporary match link. The actual temporary spectator link is generated inside the running app and includes a random ?display= parameter.

**Private repository note:** This repository was private when CricBoard was first created. According to GitHub plan restrictions, Pages on private repositories requires an eligible plan (such as GitHub Pro, Team, or Enterprise). A GitHub Free account normally needs a public repository to use Pages. Do not change repository visibility or expose anything confidential solely to activate the site without reviewing it first.

## Development and tests

No build step, database, or npm dependencies are required. Browser app files: index.html, styles.css, app.js, engine.mjs. PeerJS loads from a pinned CDN version.

Run scoring tests with Node.js 20 or later:

    node --test engine.test.mjs

engine.mjs is framework-independent and can later power a server-backed scoring API.

## Future improvements

Individual batter/bowler cards, wickets and strike management, schedule brackets, printable scorecards, score export/backup, bilingual English/Bangla UI, and a durable hosted real-time sync service for large spectator groups.
