const express = require("express");
const { exec, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

app.use("/renders", express.static(path.join(__dirname, "renders")));

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Minimal ASS-safe sanitization
 */
function sanitizeForAssUserText(s) {
  return String(s)
    .replace(/[{}]/g, "")
    .replace(/\\/g, "/")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Hard-break long "words" so they can't overflow horizontally.
 */
function breakLongWords(text, maxChars) {
  const parts = text.split(" ");
  const out = [];
  for (const p of parts) {
    if (p.length <= maxChars) {
      out.push(p);
      continue;
    }
    let i = 0;
    while (i < p.length) {
      out.push(p.slice(i, i + maxChars));
      i += maxChars;
    }
  }
  return out.join(" ");
}

/**
 * Wrap by words to target maxChars per line.
 * Returns ASS newline token \N joined lines.
 */
function wrapText(text, maxChars) {
  const words = text.split(" ");
  const lines = [];
  let line = "";

  for (const word of words) {
    const test = (line ? line + " " : "") + word;
    if (test.length > maxChars) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);

  return lines.join("\\N");
}

/**
 * Rounded rectangle ASS vector path
 */
function roundedRectPath(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  const x2 = x + w;
  const y2 = y + h;

  return [
    `m ${x + r} ${y}`,
    `l ${x2 - r} ${y}`,
    `b ${x2} ${y} ${x2} ${y} ${x2} ${y + r}`,
    `l ${x2} ${y2 - r}`,
    `b ${x2} ${y2} ${x2} ${y2} ${x2 - r} ${y2}`,
    `l ${x + r} ${y2}`,
    `b ${x} ${y2} ${x} ${y2} ${x} ${y2 - r}`,
    `l ${x} ${y + r}`,
    `b ${x} ${y} ${x} ${y} ${x + r} ${y}`,
  ].join(" ");
}

/**
 * Estimate libass line height (safe-ish)
 */
function estimateLineH(fontSize) {
  return Math.round(fontSize * 1.25);
}

function computeMaxLines(boxH, padT, padB, fontSize) {
  const usable = boxH - padT - padB;
  const lineH = estimateLineH(fontSize);
  return Math.max(1, Math.floor(usable / lineH));
}

/**
 * IMPORTANT:
 * Make wrapping conservative so lines NEVER exceed inner width.
 * Using 0.70 (not 0.55) reduces chars/line (safer for bold fonts).
 */
function estimateCharsPerLine(usableW, fontSize) {
  return Math.max(10, Math.floor(usableW / (fontSize * 0.50)));
}

/**
 * Fit text so it stays inside the box (wrap + font shrink if needed).
 */
function fitTextToBox(text, boxW, boxH, opts) {
  const {
    padL = 70,
    padR = 70,
    padT = 40,
    padB = 40,
    startFont = 50,
    minFont = 30,
    safetyChars = 2,
    range = 12,
  } = opts;

  const usableW0 = boxW - padL - padR;

  let fontSize = startFont;
  while (fontSize >= minFont) {
    const maxLines = computeMaxLines(boxH, padT, padB, fontSize);

    const est = estimateCharsPerLine(usableW0, fontSize);
    const minChars = Math.max(10, est - range);
    const maxChars = Math.max(minChars, est + range);

    for (let chars = minChars; chars <= maxChars; chars += 2) {
      const safeChars = Math.max(10, chars - safetyChars);
      const safe = breakLongWords(text, safeChars);
      const wrapped = wrapText(safe, safeChars);
      const lineCount = wrapped.split("\\N").length;

      if (lineCount <= maxLines) {
        return { wrapped, fontSize, lineCount };
      }
    }

    fontSize -= 2;
  }

  // fallback (truncate)
  const fallbackFont = minFont;
  const est = estimateCharsPerLine(usableW0, fallbackFont);
  const safeChars = Math.max(10, est - safetyChars);

  const safe = breakLongWords(text, safeChars);
  let wrapped = wrapText(safe, safeChars);

  const maxLines = computeMaxLines(boxH, padT, padB, fallbackFont);
  const lines = wrapped.split("\\N");
  if (lines.length > maxLines) {
    const truncated = lines.slice(0, maxLines);
    truncated[maxLines - 1] =
      truncated[maxLines - 1].replace(/\s+$/, "") + "…";
    wrapped = truncated.join("\\N");
  }

  return {
    wrapped,
    fontSize: fallbackFont,
    lineCount: wrapped.split("\\N").length,
  };
}

/**
 * Karaoke reveal: \kf reveals by filling.
 * totalMs controls reveal length.
 */
function buildKaraokeText(wrappedAssText, totalMs) {
  const tokens = wrappedAssText.split(/(\s|\\N)/).filter(Boolean);
  const words = tokens.filter((t) => t !== " " && t !== "\\N");
  if (!words.length) return wrappedAssText;

  const perWord = Math.max(6, Math.floor(totalMs / words.length / 10)); // 10ms units

  let out = "";
  for (const t of tokens) {
    if (t === " " || t === "\\N") out += t;
    else out += `{\\kf${perWord}}${t}`;
  }
  return out;
}

function getDurationMs(filePath) {
  try {
    const out = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      { stdio: ["ignore", "pipe", "ignore"] }
    )
      .toString()
      .trim();

    const seconds = parseFloat(out);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return Math.round(seconds * 1000);
  } catch {
    return null;
  }
}

app.post("/render", (req, res) => {
  try {
    const { videoUrl, audioUrl, text } = req.body;
    if (!videoUrl || !audioUrl || !text) {
      return res.status(400).json({ error: "Missing inputs" });
    }

    ensureDir("renders");

    const id = Date.now();
    const outputFile = `reel-${id}.mp4`;
    const outputPath = path.join("renders", outputFile);

    // ===== VIDEO SIZE =====
    const VIDEO_W = 1080;
    const VIDEO_H = 1920;

    // ===== BOX GEOMETRY =====
    const BOX_W = 870;
    const BOX_H = 460;
    const BOX_X = Math.round((VIDEO_W - BOX_W) / 2);
    const BOX_Y = 1120; // moved up a bit
    const RADIUS = 60;

    // ===== PADDING INSIDE BOX =====
    const PAD_L = 40;
    const PAD_R = 40;
    const PAD_T = 40;
    const PAD_B = 40;

    const safeUserText = sanitizeForAssUserText(text);

    // Fit text so it stays inside
    const fit = fitTextToBox(safeUserText, BOX_W, BOX_H, {
      padL: PAD_L,
      padR: PAD_R,
      padT: PAD_T,
      padB: PAD_B,
      startFont: 50,
      minFont: 50,
      safetyChars: 4,
      range: 10,
    });

    const wrapped = fit.wrapped;
    const FONT_SIZE = fit.fontSize;

    // vertically center text block inside padded area
    const lineH = estimateLineH(FONT_SIZE);
    const textH = fit.lineCount * lineH;
    const usableH = BOX_H - PAD_T - PAD_B;
    const vOffset = Math.max(0, Math.floor((usableH - textH) / 2));

    // text anchor (top-center)
    const TEXT_CENTER_X = Math.round(VIDEO_W / 2);
    const TEXT_TOP_Y = BOX_Y + PAD_T + vOffset;

    // clip to padded box (prevents spill)
    const CLIP_X1 = BOX_X + PAD_L;
    const CLIP_Y1 = BOX_Y + PAD_T;
    const CLIP_X2 = BOX_X + BOX_W - PAD_R;
    const CLIP_Y2 = BOX_Y + BOX_H - PAD_B;

    const boxShape = roundedRectPath(BOX_X, BOX_Y, BOX_W, BOX_H, RADIUS);

    // --- ANIMATION SETTINGS ---
    const BOX_FADE_MS = 1200;
    const TEXT_FADE_MS = 600;

    // Make reveal duration dynamic (finish before video ends)
    // We will probe durations AFTER download (inside the ffmpeg command callback logic).
    // (placeholder; we overwrite after download)
    let KARAOKE_MS = 8000;

    const BOX_ALPHA_START = "FF";
    const BOX_ALPHA_END = "80";

    // Write ASS later (after we compute KARAOKE_MS), but we need a template builder:
    const buildAss = (karaokeText) => `
[Script Info]
ScriptType: v4.00+
PlayResX: ${VIDEO_W}
PlayResY: ${VIDEO_H}
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding

Style: Box,Arial,1,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: Text,DejaVu Sans Bold,${FONT_SIZE},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,8,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Text
Dialogue: 0,0:00:00.00,0:01:00.00,Box,{\\p1\\bord0\\shad0\\1c&H000000&\\alpha&H${BOX_ALPHA_START}&\\t(0,${BOX_FADE_MS},\\alpha&H${BOX_ALPHA_END}&)}${boxShape}{\\p0}

; Text:
; - \\2a&HFF& makes unrevealed portion invisible (karaoke secondary)
; - \\1a fades the whole block in
Dialogue: 1,0:00:00.00,0:01:00.00,Text,{\\an8\\pos(${TEXT_CENTER_X},${TEXT_TOP_Y})\\q2\\fs${FONT_SIZE}\\bord0\\shad0\\clip(${CLIP_X1},${CLIP_Y1},${CLIP_X2},${CLIP_Y2})\\2a&HFF&\\1a&HFF&\\t(0,${TEXT_FADE_MS},\\1a&H00&)}${karaokeText}
`.trim();

    // Download first, then probe durations, then build ASS, then render.
    const command = `
curl -L "${videoUrl}" -o base.mp4 &&
curl -L "${audioUrl}" -o voice.mp3
`;

    exec(command, { maxBuffer: 1024 * 1024 * 200 }, (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Download failed" });
      }

      const videoMs = getDurationMs("base.mp4");
      const audioMs = getDurationMs("voice.mp3");

      // output is limited by -shortest (usually video), so use min if both are known
      let outMs = null;
      if (videoMs && audioMs) outMs = Math.min(videoMs, audioMs);
      else outMs = videoMs || audioMs || 10000;

      // Leave room for fade-in and a tiny tail so it finishes
      const SAFETY_TAIL_MS = 700;
      const START_PAD_MS = 200; // tiny delay at beginning
      const usableReveal = Math.max(2000, outMs - BOX_FADE_MS - SAFETY_TAIL_MS);

      // slower reveal but guaranteed to finish
      KARAOKE_MS = usableReveal;

      const karaokeText = buildKaraokeText(wrapped, KARAOKE_MS);

      const ass = buildAss(karaokeText);
      fs.writeFileSync("captions.ass", ass);

      const vf = `scale=${VIDEO_W}:${VIDEO_H},subtitles=captions.ass`;

      const renderCmd = `
ffmpeg -y -i base.mp4 -i voice.mp3 -vf "${vf}" -map 0:v:0 -map 1:a:0 -shortest -c:v libx264 -preset ultrafast -crf 23 -c:a aac -b:a 192k -pix_fmt yuv420p "${outputPath}"
`;

      exec(renderCmd, { maxBuffer: 1024 * 1024 * 300 }, (err2) => {
        if (err2) {
          console.error(err2);
          return res.status(500).json({ error: "Render failed" });
        }
        res.json({ success: true, url: `/renders/${outputFile}` });
      });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Renderer running on port ${PORT}`));
