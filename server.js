const express = require("express");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json({ limit: "1mb" }));

app.use("/renders", express.static(path.join(__dirname, "renders")));

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Safe, simple text wrap.
 * Keeps text inside box width.
 */
function wrapText(text, maxChars = 32) {
  const clean = String(text)
    .replace(/\s+/g, " ")
    .replace(/[^\x20-\x7E]/g, "")
    .trim();

  const words = clean.split(" ");
  const lines = [];
  let line = "";

  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (test.length > maxChars) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);

  return lines.join("\n");
}

app.post("/render", async (req, res) => {
  try {
    const { videoUrl, audioUrl, text } = req.body;
    if (!videoUrl || !audioUrl || !text) {
      return res.status(400).json({ error: "Missing inputs" });
    }

    ensureDir("renders");

    const id = Date.now();
    const outputFile = `reel-${id}.mp4`;
    const outputPath = path.join("renders", outputFile);

    // ===== Layout constants =====
    const VIDEO_W = 1080;
    const VIDEO_H = 1920;

    const BOX_W = 880;
    const BOX_H = 360;
    const BOX_X = Math.round((VIDEO_W - BOX_W) / 2);
    const BOX_Y = 1180;

    const FONT_SIZE = 42;
    const LINE_SPACING = 8;

    const TEXT_X = "(w-text_w)/2";
    const TEXT_Y = BOX_Y + 40;

    // Wrap text and write to file
    const wrappedText = wrapText(text, 34);
    fs.writeFileSync("text.txt", wrappedText);

    const cmd = `
curl -L "${videoUrl}" -o base.mp4 &&
curl -L "${audioUrl}" -o audio.mp3 &&
ffmpeg -y -i base.mp4 -i audio.mp3 \
-vf "scale=${VIDEO_W}:${VIDEO_H},\
drawbox=x=${BOX_X}:y=${BOX_Y}:w=${BOX_W}:h=${BOX_H}:color=black@0.55:t=fill,\
drawtext=textfile=text.txt:\
fontcolor=white:fontsize=${FONT_SIZE}:\
line_spacing=${LINE_SPACING}:\
x=${TEXT_X}:y=${TEXT_Y}:\
box=0" \
-map 0:v:0 -map 1:a:0 \
-shortest \
-c:v libx264 -preset ultrafast -crf 23 \
-c:a aac -b:a 192k \
-pix_fmt yuv420p \
"${outputPath}"
`;

    exec(cmd, { maxBuffer: 1024 * 1024 * 50 }, (err) => {
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
