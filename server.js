const express = require("express");
const { exec } = require("child_process");
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
 * - remove braces (ASS override tags)
 * - replace user backslashes (avoid injection)
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
 * Estimate libass line height. (No real per-line spacing tag in ASS)
 * 1.25x is a safe-ish approximation.
 */
function estimateLineH(fontSize) {
  return Math.round(fontSize * 1.25);
}

function computeMaxLines(boxH, padTop, padBottom, fontSize) {
  const usable = boxH - padTop - padBottom;
  const lineH = estimateLineH(fontSize);
  return Math.max(1, Math.floor(usable / lineH));
}

/**
 * Fit text to box:
 * - Wrap conservatively (shorter lines) to prevent side overflow
 * - Reduce font size if needed to fit vertically
 */
function fitTextToBox(text, boxH, opts) {
  const {
    padT = 40,
    padB = 40,
    startFont = 50,
    minFont = 30,
    // ✅ IMPORTANT: start smaller so lines don't run past the box
    startMaxChars = 30,
    maxMaxChars = 48,
    // ✅ Wrap earlier to avoid wide-letter overflow (W/M etc)
    safetySubtract = 10,
  } = opts;

  let fontSize = startFont;

  while (fontSize >= minFont) {
    const maxLines = computeMaxLines(boxH, padT, padB, fontSize);

    for (let maxChars = startMaxChars; maxChars <= maxMaxChars; maxChars += 2) {
      const safeChars = Math.max(10, maxChars - safetySubtract);
      const safe = breakLongWords(text, safeChars);
      const wrapped = wrapText(safe, safeChars);
      const lineCount = wrapped.split("\\N").length;

      if (lineCount <= maxLines) {
        return { wrapped, fontSize, lineCount };
      }
    }

    fontSize -= 2;
  }

  // Fallback: aggressive wrap + truncate
  const fallbackFont = minFont;
  const maxLines = computeMaxLines(boxH, padT, padB, fallbackFont);
  const safeChars = Math.max(10, startMaxChars - safetySubtract);

  const safe = breakLongWords(text, safeChars);
  let wrapped = wrapText(safe, safeChars);

  const lines = wrapped.split("\\N");
  if (lines.length > maxLines) {
    const truncated = lines.slice(0, maxLines);
    truncated[maxLines - 1] = truncated[maxLines - 1].replace(/\s+$/, "") + "…";
    wrapped = truncated.join("\\N");
  }

  return { wrapped, fontSize: fallbackFont, lineCount: wrapped.split("\\N").length };
}

/**
 * Karaoke (word-by-word reveal)
 * Make "not-yet-revealed" words invisible by setting SecondaryColour transparent.
 * per-word time unit = 10ms.
 */
function buildKaraokeText(wrappedAssText, totalMs = 11000) {
  const tokens = wrappedAssText.split(/(\s|\\N)/).filter(Boolean);
  const words = tokens.filter((t) => t !== " " && t !== "\\N");
  if (!words.length) return wrappedAssText;

  const perWord = Math.max(6, Math.floor(totalMs / words.length / 10));

  let out = "";
  for (const t of tokens) {
    if (t === " " || t === "\\N") out += t;
    else out += `{\\kf${perWord}}${t}`;
  }
  return out;
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
    const BOX_W = 857;
    const BOX_H = 556;
    const BOX_X = Math.round((VIDEO_W - BOX_W) / 2);

    // ✅ Move up a bit
    const BOX_Y = 1120;

    const RADIUS = 60;

    // ===== PADDING INSIDE BOX =====
    const PAD_L = 70;
    const PAD_R = 70;
    const PAD_T = 40;
    const PAD_B = 40;

    const safeUserText = sanitizeForAssUserText(text);

    // ✅ Fit text so it stays inside (vertical)
    const fit = fitTextToBox(safeUserText, BOX_H, {
      padT: PAD_T,
      padB: PAD_B,
      startFont: 50,
      minFont: 30,
      startMaxChars: 30,
      maxMaxChars: 48,
      safetySubtract: 10,
    });

    const wrapped = fit.wrapped;
    const FONT_SIZE = fit.fontSize;

    // ✅ Vertically center the text block within the usable area
    const lineH = estimateLineH(FONT_SIZE);
    const textH = fit.lineCount * lineH;
    const usableH = BOX_H - PAD_T - PAD_B;
    const vOffset = Math.max(0, Math.floor((usableH - textH) / 2));

    // ✅ Clip region (HARD guarantee) inside padded area
    const CLIP_X1 = BOX_X + PAD_L;
    const CLIP_Y1 = BOX_Y + PAD_T;
    const CLIP_X2 = BOX_X + BOX_W - PAD_R;
    const CLIP_Y2 = BOX_Y + BOX_H - PAD_B;

    // ✅ Margins define wrap width in libass
    const MARGIN_L = CLIP_X1;
    const MARGIN_R = VIDEO_W - CLIP_X2;

    // Alignment 8 (top-center): MarginV is distance from top
    const MARGIN_V = CLIP_Y1 + vOffset;

    // Rounded box shape
    const boxShape = roundedRectPath(BOX_X, BOX_Y, BOX_W, BOX_H, RADIUS);

    // --- ANIMATION SETTINGS (ms) ---
    const BOX_FADE_MS = 1200;
    const TEXT_POP_MS = 1400;
    const KARAOKE_MS = 12000; // slower reveal

    const BOX_ALPHA_START = "FF";
    const BOX_ALPHA_END = "80";

    const karaokeText = buildKaraokeText(wrapped, KARAOKE_MS);

    const ass = `
[Script Info]
ScriptType: v4.00+
PlayResX: ${VIDEO_W}
PlayResY: ${VIDEO_H}
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding

Style: Box,Arial,1,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1

; SecondaryColour is fully transparent so unrevealed karaoke text is invisible
; Alignment 8 = top-center, and margins enforce pixel wrap width
Style: Text,DejaVu Sans Bold,${FONT_SIZE},&H00FFFFFF,&HFFFFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,8,${MARGIN_L},${MARGIN_R},${MARGIN_V},1

[Events]
Format: Layer, Start, End, Style, Text

; Box fade-in
Dialogue: 0,0:00:00.00,0:01:00.00,Box,{\\p1\\bord0\\shad0\\1c&H000000&\\alpha&H${BOX_ALPHA_START}&\\t(0,${BOX_FADE_MS},\\alpha&H${BOX_ALPHA_END}&)}${boxShape}{\\p0}

; Text pop + karaoke reveal
; \\clip() ensures nothing can render outside the padded box area
Dialogue: 1,0:00:00.00,0:01:00.00,Text,{\\q2\\bord0\\shad0\\clip(${CLIP_X1},${CLIP_Y1},${CLIP_X2},${CLIP_Y2})\\fscx85\\fscy85\\t(0,${TEXT_POP_MS},\\fscx100\\fscy100)}${karaokeText}
`.trim();

    fs.writeFileSync("captions.ass", ass);

    const vf = `scale=${VIDEO_W}:${VIDEO_H},subtitles=captions.ass`;

    const command = `
curl -L "${videoUrl}" -o base.mp4 &&
curl -L "${audioUrl}" -o voice.mp3 &&
ffmpeg -y -i base.mp4 -i voice.mp3 -vf "${vf}" -map 0:v:0 -map 1:a:0 -shortest -c:v libx264 -preset ultrafast -crf 23 -c:a aac -b:a 192k -pix_fmt yuv420p "${outputPath}"
`;

    exec(command, { maxBuffer: 1024 * 1024 * 200 }, (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Render failed" });
      }
      res.json({ success: true, url: `/renders/${outputFile}` });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Renderer running on port ${PORT}`));
