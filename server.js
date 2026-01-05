const express = require("express");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

app.use("/renders", express.static(path.join(__dirname, "renders")));

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
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

  return lines.join("\\N"); // ASS newline token
}

/**
 * Build a rounded rectangle ASS vector path
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
    `b ${x} ${y} ${x} ${y} ${x + r} ${y}`
  ].join(" ");
}

/**
 * Compute how many lines can fit in the box, given font & line spacing + padding.
 */
function computeMaxLines(boxH, padTop, padBottom, fontSize, lineSpacing) {
  const usable = boxH - padTop - padBottom;
  const lineH = fontSize + lineSpacing;
  return Math.max(1, Math.floor(usable / lineH));
}

/**
 * Auto-fit text inside the box:
 * - tries different maxChars to reduce line count
 * - if still too many lines, reduce font size
 */
function fitTextToBox(text, boxW, boxH, opts) {
  const {
    padL = 70,
    padR = 70,
    padT = 40,
    padB = 40,
    startFont = 44,
    minFont = 30,
    lineSpacing = 10,
    startMaxChars = 40,
    maxMaxChars = 70
  } = opts;

  let fontSize = startFont;

  while (fontSize >= minFont) {
    const maxLines = computeMaxLines(boxH, padT, padB, fontSize, lineSpacing);

    for (let maxChars = startMaxChars; maxChars <= maxMaxChars; maxChars += 2) {
      const safe = breakLongWords(text, maxChars);
      const wrapped = wrapText(safe, maxChars);
      const lineCount = wrapped.split("\\N").length;

      if (lineCount <= maxLines) {
        return { wrapped, fontSize, lineSpacing, padL, padR, padT, padB };
      }
    }

    fontSize -= 2;
  }

  // Fallback: aggressive wrap + truncate
  const fallbackFont = minFont;
  const maxLines = computeMaxLines(boxH, padT, padB, fallbackFont, lineSpacing);
  const maxChars = startMaxChars;
  const safe = breakLongWords(text, maxChars);
  let wrapped = wrapText(safe, maxChars);

  const lines = wrapped.split("\\N");
  if (lines.length > maxLines) {
    const truncated = lines.slice(0, maxLines);
    truncated[maxLines - 1] = truncated[maxLines - 1].replace(/\s+$/, "") + "…";
    wrapped = truncated.join("\\N");
  }

  return { wrapped, fontSize: fallbackFont, lineSpacing, padL, padR, padT, padB };
}

/**
 * Convert wrapped ASS text into karaoke-timed text (word-by-word reveal).
 * totalMs controls how long the reveal takes.
 */
function buildKaraokeText(wrappedAssText, totalMs = 2800) {
  // keep spaces + line breaks as tokens
  const tokens = wrappedAssText.split(/(\s|\\N)/).filter(Boolean);

  const visibleWords = tokens.filter(t => t !== " " && t !== "\\N");
  if (visibleWords.length === 0) return wrappedAssText;

  // ASS karaoke time unit = 10ms
  const perWord = Math.max(10, Math.floor(totalMs / visibleWords.length / 10));

  let out = "";
  for (const t of tokens) {
    if (t === " " || t === "\\N") {
      out += t;
    } else {
      out += `{\\kf${perWord}}${t}`;
    }
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

    // ✅ MOVED UP
    const BOX_Y = 1180;

    const RADIUS = 60;

    // ===== PADDING INSIDE BOX =====
    const PAD_L = 70;
    const PAD_R = 70;
    const PAD_T = 40;
    const PAD_B = 40;

    // Prepare safe text
    const safeUserText = sanitizeForAssUserText(text);

    // Fit text to box (keeps it inside)
    const fit = fitTextToBox(safeUserText, BOX_W, BOX_H, {
      padL: PAD_L,
      padR: PAD_R,
      padT: PAD_T,
      padB: PAD_B,
      startFont: 44,
      minFont: 30,
      lineSpacing: 10,
      startMaxChars: 38,
      maxMaxChars: 70
    });

    const wrapped = fit.wrapped;
    const FONT_SIZE = fit.fontSize;
    const LINE_SPACING = fit.lineSpacing;

    // Center of box for text alignment
    const TEXT_CENTER_X = Math.round(VIDEO_W / 2);
    const TEXT_TOP_Y = BOX_Y + PAD_T;

    // Rounded box shape
    const boxShape = roundedRectPath(BOX_X, BOX_Y, BOX_W, BOX_H, RADIUS);

    // --- ANIMATION SETTINGS (ms) ---
    const BOX_FADE_MS = 1200;   // slower fade
    const TEXT_POP_MS = 1400;   // slower pop (scale+fade)
    const KARAOKE_MS = 3000;    // word-by-word reveal duration (adjust)

    // Box alpha: FF = invisible, 80 = ~50% visible
    const BOX_ALPHA_START = "FF";
    const BOX_ALPHA_END = "80";

    // Karaoke text (word-by-word)
    const karaokeText = buildKaraokeText(wrapped, KARAOKE_MS);

    const ass = `
[Script Info]
ScriptType: v4.00+
PlayResX: ${VIDEO_W}
PlayResY: ${VIDEO_H}
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding

Style: Box,Arial,1,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1

; Alignment 8 = top-center
Style: Text,DejaVu Sans Bold,${FONT_SIZE},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,8,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Text
; Box fade-in
Dialogue: 0,0:00:00.00,0:01:00.00,Box,{\\p1\\bord0\\shad0\\1c&H000000&\\alpha&H${BOX_ALPHA_START}&\\t(0,${BOX_FADE_MS},\\alpha&H${BOX_ALPHA_END}&)}${boxShape}{\\p0}

; Text pop + fade-in + karaoke reveal
; Note: \q2 = smart wrapping, Alignment is top-center via style, \pos centers horizontally
Dialogue: 1,0:00:00.00,0:01:00.00,Text,{\\an8\\pos(${TEXT_CENTER_X},${TEXT_TOP_Y})\\q2\\fs${FONT_SIZE}\\fsp0\\bord0\\shad0\\fscx85\\fscy85\\alpha&HFF&\\t(0,${TEXT_POP_MS},\\fscx100\\fscy100\\alpha&H00&)\\fsp0}${karaokeText}
`.trim();

    fs.writeFileSync("captions.ass", ass);

    const vf = `scale=${VIDEO_W}:${VIDEO_H},subtitles=captions.ass`;

    const command = `
curl -L "${videoUrl}" -o base.mp4 &&
curl -L "${audioUrl}" -o voice.mp3 &&
ffmpeg -y -i base.mp4 -i voice.mp3 -vf "${vf}" -map 0:v:0 -map 1:a:0 -shortest -c:v libx264 -preset ultrafast -crf 23 -c:a aac -b:a 192k -pix_fmt yuv420p "${outputPath}"
`;

    exec(command, { maxBuffer: 1024 * 1024 * 100 }, (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Render failed" });
      }

      res.json({
        success: true,
        url: `/renders/${outputFile}`
      });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Renderer running on port ${PORT}`);
});
