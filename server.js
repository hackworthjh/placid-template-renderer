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

function cleanText(text) {
  return String(text)
    .replace(/[{}]/g, "")
    .replace(/\\/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

function wrapText(text, maxChars = 36) {
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
  return lines.join("\n");
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

    // ===== DIMENSIONS =====
    const VIDEO_W = 1080;
    const VIDEO_H = 1920;

    const BOX_W = 900;
    const BOX_H = 360;
    const BOX_X = Math.floor((VIDEO_W - BOX_W) / 2);
    const BOX_Y = 1150;

    const FONT_SIZE = 44;
    const LINE_SPACING = 10;
    const TEXT_Y = BOX_Y + 50;

    const wrappedText = wrapText(cleanText(text), 36);
    fs.writeFileSync("text.txt", wrappedText);

    const filter = [
      `scale=${VIDEO_W}:${VIDEO_H}`,
      `drawbox=x=${BOX_X}:y=${BOX_Y}:w=${BOX_W}:h=${BOX_H}:color=black@0.55:t=fill`,
      `drawtext=textfile=text.txt:fontcolor=white:fontsize=${FONT_SIZE}:line_spacing=${LINE_SPACING}:x=(w-text_w)/2:y=${TEXT_Y}`
    ].join(",");

    const cmd = `
curl -L "${videoUrl}" -o base.mp4 &&
curl -L "${audioUrl}" -o audio.mp3 &&
ffmpeg -y -i base.mp4 -i audio.mp3 -vf "${filter}" \
-map 0:v:0 -map 1:a:0 -shortest \
-c:v libx264 -preset ultrafast -crf 24 \
-c:a aac -b:a 128k \
-pix_fmt yuv420p "${outputPath}"
`;

    exec(cmd, { maxBuffer: 1024 * 1024 * 300 }, (err, stdout, stderr) => {
      console.log("STDOUT:", stdout);
      console.error("STDERR:", stderr);

      if (err) {
        return res.status(500).json({ error: stderr || "Render failed" });
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
app.listen(PORT, () =>
  console.log(`Renderer running on port ${PORT}`)
);
