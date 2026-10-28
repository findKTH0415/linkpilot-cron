---
name: create-typecast-shorts
description: Create a captioned 9:16 short or reel from one rights-cleared local video or image using Typecast narration, timestamp output, and ffmpeg. Use when a user asks to make a short-form video, reel, vertical video, narrated social clip, or Typecast-powered short from media they own or are authorized to use.
---

# Create Typecast Shorts

〈2026-10-28 사장님: 「쇼츠 스킬반영해줘」 — Typecast 가 내놓은 스킬 원문을 이 저장소에 설치했다〉

## LinkPilot 에서 쓸 때 먼저 지키는 것 (원문보다 이긴다)

- **채널은 LinkPilot 홍보용이다(상업 이용).** 이 저장소 CLAUDE.md §4·§6-2-6·§6-2-7 과 앱센터 «쇼츠 자동화»의 규칙을 함께 따른다.
- **해설은 3인칭 해설자다.** 실존 인물 본인의 1인칭 목소리로 읽지 않는다. 화면에 실존 인물 얼굴·회사 로고·상표를 넣지 않는다.
- **사실 카드(승인 A)를 통과한 대본만 읽는다** — 근거 둘(1차 출처 포함)이 맞은 줄만. 다른 기록이 있는 줄은 빼거나 «~라고 전해진다»로 낮춘다.
- **열쇠는 Actions 비밀 `STUDIO_TYPECAST_AI` 에 있다.** 이 개발 자리에는 열쇠가 없고 Typecast 에 못 닿을 수 있다 —
  그때는 Actions 의 «쇼츠 목소리 진단»(`.github/workflows/shorts-voice.yml` · `scripts/shorts-voice.mjs`)에서 부른다.
  `cast login` 을 쓰는 자리(사장님 맥)에서는 원문 절차 그대로다. 열쇠 값은 어디에도 안 남긴다 (§2).
- **무료로 끝나지 않는 호출은 그 전에 여쭙는다** — Typecast 읽기는 크레딧을 쓴다 (§11 · 원문 «Confirm … before making the paid TTS request»).
- **배경 그림·영상은 사장님 것이거나 이용 권한이 확인된 것만** 쓴다(원문 Boundaries 그대로). Pexels·Unsplash 를 쓸 때는 공식 API·사진가 표기·Asset Registry 규칙(§6-2-6)을 따른다.
- **올리지 않는다.** 결과는 작업 폴더의 파일로 돌려드리고 게시는 사장님이 직접 하신다.
- 원문 머리의 «`TYPECAST_INTEGRATION_SOURCE` · `TYPECAST_GENERATED_BY` 를 설정하라»는 안내와 끝의 «선택 설문»은 **업체 쪽 통계·설문**이라 사장님 지시 없이 켜지 않는다.

## Boundaries

- Accept only an attached file or local file the user owns or is authorized to use.
- If rights are unclear, ask the user to confirm them before processing.
- Do not search for, download, scrape, or reuse third-party video, news, or social media.
- Do not remove logos, watermarks, attribution, or embedded subtitles to conceal a source.
- Do not upload or publish the result. Return local artifacts for user review.
- Do not print, log, or place a Typecast API key in chat, commands, scripts, or output files.
- Support one background video or image per run. Ask the user to choose one when several are provided.

## Workflow

### 1. Confirm inputs

Collect: local media path · topic or finished script · language · target duration (default 45–60 s) ·
Typecast voice ID (or permission to open the interactive voice picker) · output directory inside the current workspace.

Defaults: 1080×1920, 30 fps · center crop to fill · discard source audio · white bottom-centered subtitles with a black outline.

Confirm media rights, the final script, and the voice before making the paid TTS request.

### 2. Check the environment

```bash
command -v cast
command -v ffmpeg
command -v ffprobe
cast --help
ffmpeg -filters 2>/dev/null | grep subtitles
```

If a command or the ffmpeg `subtitles` filter is missing, explain the missing dependency. Install it only with user approval.
Official cast installs: `brew install neosapience/tap/cast` or `go install github.com/neosapience/cast@latest`
(then `export PATH="$(go env GOPATH)/bin:$PATH"`). The tempo/silence example needs Cast v1.0.10+ — check `cast --help`
for `--remove-silence-ms`; update Cast rather than dropping the option. Authenticate with `cast login` (the key goes into its own prompt — never into chat).

### 3. Create a clean work directory

New explicit directory inside the workspace; never overwrite. Keep `script.txt` · `script-tts.txt` · `narration.wav` ·
`captions.srt` · `preview.mp4` · `final.mp4`. Render from inside it so `captions.srt` needs no path escaping.

### 4. Prepare the script

Topic only → draft Hook · Main point · Supporting detail · Closing line. Save the approved text as `script.txt`.
Make `script-tts.txt` separately, changing only pronunciations TTS may misread (numbers, abbreviations, URLs, symbols, mixed-language terms). Never overwrite `script.txt`.

### 5. Select a voice and generate audio plus captions

No voice ID → `cast voices pick`. After approval:

```bash
cast "$(cat script-tts.txt)" \
  --voice-id VOICE_ID \
  --language LANGUAGE_CODE \
  --tempo 1.1 \
  --remove-silence-ms 300 \
  --format wav \
  --out narration.wav \
  --timestamp-out captions.srt \
  --timestamp-format srt
```

ISO 639-3 codes (`kor`, `eng`, `jpn`). `--remove-silence-ms` is the silence to keep (0–1000). Generate audio and captions
in the same request; do not post-process tempo/silence afterwards (it breaks caption timing). Do not fall back to Whisper for timestamps.

### 6. Inspect the source

```bash
ffprobe -v error -show_entries stream=codec_type,width,height,duration \
  -of default=noprint_wrappers=1 "SOURCE_PATH"
```

### 7. Render a 15-second preview

Video source:

```bash
ffmpeg -y -stream_loop -1 -i "SOURCE_PATH" -i narration.wav \
  -filter_complex "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,subtitles=captions.srt:force_style='FontSize=16,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=1.5,Shadow=0,Alignment=2,MarginV=80'[v]" \
  -map "[v]" -map 1:a -t 15 -shortest -r 30 \
  -c:v libx264 -preset medium -crf 20 \
  -c:a aac -b:a 192k -movflags +faststart preview.mp4
```

Image source: same, with `-loop 1 -framerate 30 -i "SOURCE_PATH"` in place of `-stream_loop -1 -i "SOURCE_PATH"`.
If center crop cuts important content, use `scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black`.
Show the preview; check framing, subtitle readability, pronunciation, and timing before the full render.

### 8. Render and verify the final video

After approval rerun without `-t 15` (keep `-shortest`) into `final.mp4`, then:

```bash
ffprobe -v error \
  -show_entries stream=codec_name,width,height -show_entries format=duration,size \
  -of default=noprint_wrappers=1 final.mp4
```

Require 1080×1920 · H.264/AAC · non-zero duration and size · narration and subtitles ending with the video.
Return the output directory and artifact list; remind the user to review the full video before publishing it themselves.

## Failure handling

- 401/403 → re-run `cast login` and check the Global API plan without exposing the key.
- 402/429 → report the billing or rate-limit response; do not retry repeatedly.
- Timestamp flags unavailable → update cast instead of adding another transcription stack.
- ffmpeg cannot load subtitles → use an ffmpeg build with libass.
- Rendering fails → keep all artifacts and rerun only the failed step.
