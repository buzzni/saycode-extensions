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
npx -y @buzzni/shorts-director cover      # out/cover-candidates.png: three moments worth a cover
npx -y @buzzni/shorts-director post       # out/post.md (per-platform copy) and out/cover.jpg
npx -y @buzzni/shorts-director voice --variant b && npx -y @buzzni/shorts-director render --variant b   # out/final-b.mp4
npx -y @buzzni/shorts-director status     # status.md
npx -y @buzzni/shorts-director formats    # screen formats (full / band) and the band frames
npx -y @buzzni/shorts-director choices steps-clean/clean full/vlog   # out/choices.png|html: design candidates with this video's headline
```

## Requirements

- macOS (captions are drawn with JXA/AppKit, so no libass or drawtext build of ffmpeg is needed), Node.js 20+, ffmpeg.
- An LTX-2.5 video server and a Qwen3-TTS server. Save their addresses once per machine:

  ```bash
  npx -y @buzzni/shorts-director init --ltx-url http://<video server>:8010 --tts-url http://<voice server>:8765
  ```

  This writes `~/.config/shorts-director/.env` (mode 600, missing keys only). The TTS bearer token goes in
  `~/.config/shorts-director/tts-token` (one line). A `.env` at the repository root (the nearest parent folder with `.git`) overrides the machine files key by
  key, the work folder's `.env` overrides that, and shell environment variables override all of them. A voice
  server address set in either project `.env` only gets a token from that same file, never from the other `.env`, the machine files or the shell.
- `"fake": true` in `config/settings.json` rehearses the whole flow without either server.

## What it enforces

- Plan rules: 3–8 hook candidates from at least three different mechanisms (loss, gap, hot_take, situation,
  proof, conflict, reaction), each with the single question it plants and optionally its opening frame and a score
  from a judge who does not know the plan (a warning when a lower scored hook is chosen); a cut every ~3 seconds; no title-card opening; takes of 1–5
  seconds; no subtitle or caption words in video prompts (they make LTX draw fake lettering).
- Pace warnings: photos and cards running more than six seconds in a row (a slideshow); `voice` warns when the first
  spoken line ends after three seconds (the hook is not fully heard).
- Structure warnings: the first scene carries the hook in picture, sound and a short (≤16 character) caption; a
  `beat: "rehook"` scene lands 25–45% of the way in; the ending is a peak, a loop or exactly one CTA; the length
  suits the `platform` (shorts / reels / tiktok).
- Brand warning: with `plan.brand` (a name, or `{ name, spoken: [...] }` for how it is read aloud), `check` warns when the
  brand is heard fewer than twice in narration and dialogue — on-screen text alone is not remembered.
- Script warnings: AI-script filler (greetings, "today we'll…", list connectives) and numbers (%, prices,
  multiples, head counts) that have no `facts` entry with a source.
- Warning for signage-heavy places (convenience stores, stations, shops, billboards…) without a blurred background:
  LTX draws garbled Korean on in-scene signs, and a very shallow depth of field removes it.
- Takes are recorded before they are submitted and reused when the same request was already downloaded, so a lost
  connection never generates the same take twice.
- `moments[].from` chains a take from the previous take's last frame — the reliable way to keep the same person.
- Narration is trimmed of leading, trailing and long inner silences, sped up toward 6.5 syllables a second (at most
  1.25x) and measured before it is laid out 0.1 seconds apart. A line whose text, voice and tempo settings did not
  change keeps its recording (TTS length varies a lot between takes of the same sentence), so editing one line does
  not move the others; `voice --fresh` records every line again and `voice --fresh 0,3` only those lines. `voice` reports scenes that run well past their
  narration, so they can be shortened before any take is generated, and lines that run on into the next scene's own line
  (their subtitle would end over the next scene).
- Screen format (`plan.format`): `full` (default) fills the screen with the picture — for shorts whose picture carries
  the meaning. `band` puts each scene in a window in the middle of a genre frame, keeps `format.headline` (or the first
  hook caption) in the top band for the whole video and the subtitles in the bottom band — for steps, lists, rankings,
  data and app or product screens, where the words carry the meaning. Twenty-four frames ship as plain SVG (`frames/`,
  drawn by AppKit, no text inside; `formats` lists them with what each suits): news, data, steps, recipe, review, ranking,
  product and app screens, vlog, chat story, film, promo, quiz, versus, kids, pets, fitness, beauty, travel postcard,
  light finance, magazine, retro pixel, local map and minimal — some with a tall window for screens and products. Headline, subtitles
  and `moments[].badge` (a step or rank number on the window corner, up to four characters) take the frame's colours.
  `check` refuses a caption `position` outside the window (it would cover the headline or subtitles), and captions
  moved off a face stay inside the window.
- Design interview: `choices <frame or full>/<look> …` (two to six candidates, lettered A, B, C…) renders each candidate
  with this video's own headline, first real picture (or the first take) and first spoken line to `out/choices/<letter>.png`,
  side by side in `out/choices.png` and labelled in `out/choices.html`, so the user can pick a design before any take is made.
- Captions follow a genre look (`plan.look`, listed by `shorts-director looks`): clean, vlog, news, recipe, review,
  ad, drama and calm each set the font, colours, box shape, outline, shadow, emphasis and entrance for every role
  (hook, title, info chip, subtitles, asides, label pill). The hook shows for its first three seconds with one
  `caption.emphasis` word and an optional `caption.label`; `moments[].asides` adds short inner-voice or status lines;
  narration subtitles change in one-line pieces of about fifteen characters timed to the speech. Fonts are Korean
  SIL OFL fonts (Pretendard and Google Fonts `ofl/`, pinned by checksum) downloaded to `~/.config/shorts-director/fonts/`;
  without them the system font is used. Every look keeps text-on-box contrast at 4.5:1 or more.
- A photo can carry `highlights: [{ x, y, w, h }]` (fractions of the photo): a translucent yellow box with a bold border is
  drawn on the row that matters, and the slow push-in moves toward it instead of the centre.
- `plan.subtitle_look` overrides the look for narration and dialogue subtitles only (for example a translucent
  `fill` plate so subtitles stay readable over a full-screen screenshot); `check` validates it like a caption look.
- One caption can differ from its look: `caption.look` overrides font, colours, box, outline, size or entrance, and
  `caption.position` moves it (`y` from the top, `x` left/center/right); `check` refuses unknown fonts and unreadable
  colours. After `render`, each on-screen caption's drawn box is compared with the faces and the main subject that
  macOS Vision finds in caption-free frames sampled about every 0.8 seconds while it shows (a face cut off by the top
  of the frame is estimated from the person outline, ignoring raised hands; a face cut off by a side, even under a hat
  or hood, is found again in a copy with the showing half mirrored onto that side, and when only an ear or a cheek
  shows, the sliver of person at that edge is followed down to where it ends; estimated heads are narrowed to the
  largest patch of skin colour inside them, so hair and hats are not counted as face); covering more than 15% of a face or 25% of the subject's middle, or
  touching the side edges, is reported (also in `out/text-check.json`) so the caption can be moved and re-rendered.
  A caption without a `position` is moved first: when its default spot covers a face or the subject, `render` puts it at
  the nearest height that does not (shrinking the text only when every height would), between the platform UI and the
  subtitle band, and prints where it went. A caption with a `position` stays where it was put.
- Background music: `shorts-director music` lists public-domain (CC0) tracks from FreePD.com; `plan.music: { track }`
  downloads one to `~/.config/shorts-director/music/` on first render (checked by sha256) and levels it. A file of
  your own works too: `plan.music: { file: "materials/…" }`.
- The mix ducks the scene sound and the music only while narration plays, adds short
  sound effects synthesized by ffmpeg on the hook, cuts, the re-hook and titles (no audio files ship with the package),
  fades out the last half second and limits peaks.
- The final frame rate follows the generated video, so no frame is shown twice. Takes chained with `from` alternate
  between 1.0x and 1.15x framing at every planned shot (punch-in), and `render` reports the real cut count and the
  longest unbroken stretch.
- `sheet` labels every tile of the contact sheet with its time and prints the grid, so a reviewer never miscounts tiles.
- Every `render` also writes `out/viewer.md`: shot by shot, the planned picture, the words on screen and what is heard,
  with no intent or reasoning — what a fresh reviewer gets together with the contact sheet to judge the finished cut.
- Post copy: `plan.post` holds the title, description or caption and hashtags for `shorts`, `reels` and `tiktok`.
  `check` refuses what the upload forms refuse (Shorts title over 100 characters or more than 15 hashtags — YouTube
  ignores them all —, more than 5 Reels hashtags, captions over 2,200 / 4,000 characters) and warns about a Shorts
  title over about 40 characters or a Reels/TikTok first line over 40 (both cut off in the feed). Numbers in the copy
  need a `facts` source like the script. `post` writes `out/post.md`; nothing is posted.
- Cover: `plan.cover: { at, text, emphasis?, label?, position?, look? }` takes the caption-free frame at `at` seconds
  from the last render and draws the text in the hook style, by default inside the centre 3:4 that the Instagram
  profile grid shows, to `out/cover.jpg`. The cover text gets the same face and subject check as on-screen captions
  and, without a `position.y`, the same automatic move inside the grid. `cover` looks at the caption-free cut every half
  second and shows the three moments with the largest, sharpest detected face (else the main object), apart in time and
  away from cuts, in `out/cover-candidates.png`.
- Variants: `plan.variants: [{ id, hypothesis, moments: { <id>: { caption, asides, subtitles } }, narration: { <line>: text }, hook?, post?, cover? }]`
  change only words, so every take is reused. `voice --variant <id>` re-records only the changed lines,
  `render --variant <id>` writes `out/final-<id>.mp4`, `out/viewer-<id>.md` and `out/text-check-<id>.json`, and
  `sheet`/`post --variant <id>` follow. `check` refuses a variant that touches a take field and needs a hypothesis;
  it warns when a variant changes more than one scene (compare one thing at a time) and checks the merged plan,
  reporting only what the variant adds.
