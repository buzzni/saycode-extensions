# @buzzni/shorts-director

Toolkit a coding agent uses to make a vertical (9:16) short from one request: it checks the plan, records narration,
renders an animatic, generates video takes, assembles the cut and builds a contact sheet for review. The project
folder is the state store, so a new conversation can pick up where the last one stopped.

In Saycode the agent's procedure comes from the organization skill `shorts-director`; this package is only the
toolkit, so nothing has to be copied into a project.

```bash
npx -y @buzzni/shorts-director init       # .gitignore rules, .env.example, materials/, fonts (+ --ltx-url/--tts-url once per PC)
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

- Plan rules: 3–4 hook candidates from at least three different mechanisms (loss, gap, hot_take, situation,
  proof), each with the single question it plants; a cut every ~3 seconds; no title-card opening; takes of 1–5
  seconds; no subtitle or caption words in video prompts (they make LTX draw fake lettering).
- Structure warnings: the first scene carries the hook in picture, sound and a short (≤16 character) caption; a
  `beat: "rehook"` scene lands 25–45% of the way in; the ending is a peak, a loop or exactly one CTA; the length
  suits the `platform` (shorts / reels / tiktok).
- Script warnings: AI-script filler (greetings, "today we'll…", list connectives) and numbers (%, prices,
  multiples, head counts) that have no `facts` entry with a source.
- Warning for signage-heavy places (convenience stores, stations, shops, billboards…) without a blurred background:
  LTX draws garbled Korean on in-scene signs, and a very shallow depth of field removes it.
- Takes are recorded before they are submitted and reused when the same request was already downloaded, so a lost
  connection never generates the same take twice.
- `moments[].from` chains a take from the previous take's last frame — the reliable way to keep the same person.
- Narration is trimmed of leading, trailing and long inner silences, sped up toward 6.5 syllables a second (at most
  1.25x) and measured before it is laid out 0.1 seconds apart. `voice` reports scenes that run well past their
  narration, so they can be shortened before any take is generated.
- Captions follow a genre look (`plan.look`, listed by `shorts-director looks`): clean, vlog, news, recipe, review,
  ad, drama and calm each set the font, colours, box shape, outline, shadow, emphasis and entrance for every role
  (hook, title, info chip, subtitles, asides, label pill). The hook shows for its first three seconds with one
  `caption.emphasis` word and an optional `caption.label`; `moments[].asides` adds short inner-voice or status lines;
  narration subtitles change in one-line pieces of about fifteen characters timed to the speech. Fonts are Korean
  SIL OFL fonts (Pretendard and Google Fonts `ofl/`, pinned by checksum) downloaded to `~/.config/shorts-director/fonts/`;
  without them the system font is used. Every look keeps text-on-box contrast at 4.5:1 or more.
- One caption can differ from its look: `caption.look` overrides font, colours, box, outline, size or entrance, and
  `caption.position` moves it (`y` from the top, `x` left/center/right); `check` refuses unknown fonts and unreadable
  colours. After `render`, each on-screen caption's drawn box is compared with the faces and the main subject that
  macOS Vision finds in caption-free frames sampled about every 0.8 seconds while it shows (a face cut off by the top
  of the frame is estimated from the person outline, ignoring raised hands; a face cut off by a side, even under a hat
  or hood, is found again in a copy with the showing half mirrored onto that side, and when only an ear or a cheek
  shows, the sliver of person at that edge is followed down to where it ends); covering more than 15% of a face or 25% of the subject's middle, or
  touching the side edges, is reported (also in `out/text-check.json`) so the caption can be moved and re-rendered.
- Background music: `shorts-director music` lists public-domain (CC0) tracks from FreePD.com; `plan.music: { track }`
  downloads one to `~/.config/shorts-director/music/` on first render (checked by sha256) and levels it. A file of
  your own works too: `plan.music: { file: "materials/…" }`.
- The mix ducks the scene sound and the music only while narration plays, adds short
  sound effects synthesized by ffmpeg on the hook, cuts, the re-hook and titles (no audio files ship with the package),
  fades out the last half second and limits peaks.
- The final frame rate follows the generated video, so no frame is shown twice. Takes chained with `from` alternate
  between 1.0x and 1.15x framing at every planned shot (punch-in), and `render` reports the real cut count and the
  longest unbroken stretch.

## Private knowledge

`import-knowledge --from <shorts_maker>` copies internal viskit planning prompts from a local checkout into the
project's git-ignored `knowledge/` folder. Nothing private ships in this package.
