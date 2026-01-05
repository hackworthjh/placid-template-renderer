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
 * Wrap text into multiple lines.
 * For a 900px wide box at fontsize ~42, ~22-26 chars/line is usually safe.
 * (We keep it conservative to avoid overflow.)
 */
function wrapText(text, maxChars = 24) {
  const words = String(text).replace(/\s+/g, " ").trim().split(" ");
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

  // ASS uses \N for new lines
  return lines.join("\\N");
}

// Escape ASS control chars minimally
function escapeAss(text) {
  return String(text)
    .replace(/\\/g, "\\\\") // keep literal backslashes safe
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}");
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

    // ===== VIDEO SIZE (final output) =====
    const VIDEO_W = 1080;
    const VIDEO_H = 1920;

    // ===== BOX GEOMETRY =====
    // Centered fixed rectangle near bottom
    const BOX_W = 900;
    const BOX_H = 360;
    const BOX_X = Math.round((VIDEO_W - BOX_W) / 2); // 90
    const BOX_Y = 1280; // <-- MOVE THIS UP/DOWN (smaller = higher). Try 1220–1320.

    // ===== TEXT POSITION INSIDE BOX =====
    // We'll anchor text TOP-CENTER and center-align lines.
    const TEXT_CENTER_X = Math.round(VIDEO_W / 2); // 540
    const TEXT_TOP_Y = BOX_Y + 55; // <-- moves text within box (bigger = lower)

    // ===== TEXT STYLE =====
    const FONT_SIZE = 42; // smaller than 56 to fit nicely
    const LINE_SPACING = 10;

    const wrapped = escapeAss(wrapText(text, 24));

    /**
     * ASS colors are &HAABBGGRR
     * Alpha in ASS: 00 = fully opaque, FF = fully transparent
     * So alpha ~80 is nicely translucent.
     */

    // Draw a rectangle using ASS vector drawing (\p1)
    // Rectangle points: (x,y) -> (x+w,y) -> (x+w,y+h) -> (x,y+h)
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
Style: Box,Arial,1,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: Text,Arial,${FONT_SIZE},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,8,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Text
Dialogue: 0,0:00:00.00,0:01:00.00,Box,{\\p1\\1c&H000000&\\alpha&H80&}${boxShape}{\\p0}
Dialogue: 1,0:00:00.00,0:01:00.00,Text,{\\an8\\pos(${TEXT_CENTER_X},${TEXT_TOP_Y})\\q2\\fsp0\\fs${FONT_SIZE}\\fscy100\\fscx100\\bord0\\shad0\\lineSpacing${LINE_SPACING}}${wrapped}
`.trim();

    fs.writeFileSync("captions.ass", ass);

    // IMPORTANT: keep filter string on ONE line (avoids shell quoting issues)
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
