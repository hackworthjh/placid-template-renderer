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
 * Wrap text for a 900px wide box at fontsize ~42.
 * Increase maxChars to make lines longer (more horizontal).
 */
function wrapText(text, maxChars = 36) {
  const cleaned = String(text)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\s+/g, " ")
    .trim();

  const words = cleaned.split(" ");
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

  // ASS newline token is \N (MUST remain a single backslash in the .ass file)
  return lines.join("\\N");
}

/**
 * Minimal ASS-safe sanitization:
 * - Remove braces (they can break ASS override tags)
 * - Replace backslashes in ORIGINAL text (so user can't inject ASS tags)
 *   Note: We do NOT touch the \N we generate in wrapText.
 */
function sanitizeForAssUserText(s) {
  return String(s)
    .replace(/[{}]/g, "")
    .replace(/\\/g, "/"); // replace user-provided backslashes only
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

    // ===== BOX GEOMETRY (good position you said) =====
    const BOX_W = 900;
    const BOX_H = 360;
    const BOX_X = Math.round((VIDEO_W - BOX_W) / 2); // 90
    const BOX_Y = 1280; // smaller = higher

    // ===== TEXT GEOMETRY =====
    const FONT_SIZE = 40;
    const LINE_SPACING = 10;

    // Center of video
    const TEXT_CENTER_X = Math.round(VIDEO_W / 2); // 540
    const TEXT_TOP_Y = BOX_Y + 40; // smaller = higher inside the box

    // Prepare wrapped text (NO extra escaping after this)
    const safeUserText = sanitizeForAssUserText(text);
    const wrapped = wrapText(safeUserText, 40); // try 34–40 if needed

    // ASS vector rectangle shape for the box (separate layer behind text)
    const x1 = BOX_X;
    const y1 = BOX_Y;
    const x2 = BOX_X + BOX_W;
    const y2 = BOX_Y + BOX_H;
    const boxShape = `m ${x1} ${y1} l ${x2} ${y1} l ${x2} ${y2} l ${x1} ${y2}`;

    const ass = `
[Script Info]
ScriptType: v4.00+
PlayResX: ${VIDEO_W}
PlayResY: ${VIDEO_H}
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding

; Box style (font size irrelevant, we draw a shape)
Style: Box,Arial,1,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1

; Text style:
; Alignment 8 = top-center
; MarginL/MarginR are informational; we control wrapping by maxChars
Style: Text,DejaVu Sans Bold,${FONT_SIZE},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,8,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Text
Dialogue: 0,0:00:00.00,0:01:00.00,Box,{\\p1\\1c&H000000&\\alpha&H80&}${boxShape}{\\p0}
Dialogue: 1,0:00:00.00,0:01:00.00,Text,{\\an8\\pos(${TEXT_CENTER_X},${TEXT_TOP_Y})\\q2\\fs${FONT_SIZE}\\bord0\\shad0}${wrapped}
`.trim();

    fs.writeFileSync("captions.ass", ass);

    // Keep filter on ONE line (avoid shell quoting problems)
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
        url: `/renders/${outputFile}`,
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
