# @buzzni/shorts-director

Toolkit a coding agent uses to make a vertical (9:16) short from one request: it checks the plan, records narration,
renders an animatic, generates video takes, assembles the cut and builds a contact sheet for review. The project
folder is the state store, so a new conversation can pick up where the last one stopped.

In Saycode the agent's procedure comes from the organization skill `shorts-director`; this package is only the
toolkit, so nothing has to be copied into a project.

```bash
npx -y @buzzni/shorts-director init       # .gitignore rules, .env.example, materials/ (+ --ltx-url/--tts-url once per PC)
npx -y @buzzni/shorts-director doctor     # ffmpeg, caption renderer, video and voice servers
npx -y @buzzni/shorts-director check      # plan.json rules
npx -y @buzzni/shorts-director voice      # narration, measured lengths
npx -y @buzzni/shorts-director animatic   # storyboard draft out/draft.mp4
npx -y @buzzni/shorts-director takes submit && npx -y @buzzni/shorts-director takes wait
npx -y @buzzni/shorts-director render     # out/final.mp4
npx -y @buzzni/shorts-director sheet      # out/contact.png
npx -y @buzzni/shorts-director status     # status.md
```

## Requirements

- macOS (captions are drawn with JXA/AppKit, so no libass or drawtext build of ffmpeg is needed), Node.js 20+, ffmpeg.
- An LTX-2.5 video server and a Qwen3-TTS server. Save their addresses once per machine:

  ```bash
  npx -y @buzzni/shorts-director init --ltx-url http://<video server>:8010 --tts-url http://<voice server>:8765
  ```

  This writes `~/.config/shorts-director/.env` (mode 600, missing keys only). The TTS bearer token goes in
  `~/.config/shorts-director/tts-token` (one line). A project `.env` overrides the machine file key by key, and
  shell environment variables override both.
- `"fake": true` in `config/settings.json` rehearses the whole flow without either server.

## What it enforces

- Plan rules: 3–4 hook candidates, a cut every ~3 seconds, no title-card opening, takes of 1–5 seconds, no
  subtitle or caption words in video prompts (they make LTX draw fake lettering).
- Takes are recorded before they are submitted and reused when the same request was already downloaded, so a lost
  connection never generates the same take twice.
- `moments[].from` chains a take from the previous take's last frame — the reliable way to keep the same person.
- Narration is trimmed of leading, trailing and long inner silences and measured before it is laid out.

## Private knowledge

`import-knowledge --from <shorts_maker>` copies internal viskit planning prompts from a local checkout into the
project's git-ignored `knowledge/` folder. Nothing private ships in this package.
