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
 * Wrap text into lines
 */
function wrapText(text, maxChars = 40) {
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

  return lines;
}

/**
 * ASS-safe sanitization
 */
function sanitizeForAss(s) {
  return String(s)
    .replace(/[{}]/g, "")
    .replace(/\\/g, "/");
}

/**
 * Rounded rectangle ASS path
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

    // ===== BOX =====
    const BOX_W = 900;
    const BOX_H = 360;
    const BOX_X = Math.round((VIDEO_W - BOX_W) / 2);
    const BOX_Y = 1280;
    const RADIUS = 60;

    // ===== TEXT =====
    const FONT_SIZE = 44;
    const LINE_SPACING = 56;
    const LINE_DELAY = 0.6; // seconds per line

    const TEXT_CENTER_X = Math.round(VIDEO_W / 2);
    const TEXT_START_Y = BOX_Y + 40;

    const safeText = sanitizeForAss(text);
    const lines = wrapText(safeText, 40);

    const boxShape = roundedRectPath(
      BOX_X,
      BOX_Y,
      BOX_W,
      BOX_H,
      RADIUS
    );

    // ---- BUILD LINE-BY-LINE EVENTS (VALID ASS TIMING) ----
    let textEvents = "";

    lines.forEach((line, i) => {
      const startCs = Math.floor(i * LINE_DELAY * 100);
      const sec = Math.floor(startCs / 100);
      const cs = startCs % 100;

      const startTime = `0:00:${String(sec).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
      const y = TEXT_START_Y + i * LINE_SPACING;

      textEvents += `
Dialogue: 1,${startTime},0:01:00.00,Text,{\\an8\\pos(${TEXT_CENTER_X},${y})\\fs${FONT_SIZE}\\bord0\\shad0\\alpha&HFF&\\t(0,300,\\alpha&H00&)}${line}
`;
    });

    const ass = `
[Script Info]
ScriptType: v4.00+
PlayResX: ${VIDEO_W}
PlayResY: ${VIDEO_H}
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding

Style: Box,Arial,1,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: Text,DejaVu Sans Bold,${FONT_SIZE},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,8,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Text
Dialogue: 0,0:00:00.00,0:01:00.00,Box,{\\p1\\bord0\\shad0\\1c&H000000&\\alpha&H80&}${boxShape}{\\p0}
${textEvents}
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
