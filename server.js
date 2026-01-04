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

function wrapText(text, maxChars = 28) {
  const words = text.split(" ");
  const lines = [];
  let line = "";

  for (const word of words) {
    if ((line + " " + word).trim().length > maxChars) {
      lines.push(line.trim());
      line = word;
    } else {
      line += " " + word;
    }
  }

  if (line.trim()) lines.push(line.trim());

  return lines.slice(0, 6).join("\n");
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

    const wrappedText = wrapText(text);
    fs.writeFileSync("text.txt", wrappedText);

    const lines = wrappedText.split("\n").length;

    const VIDEO_W = 1080;
    const VIDEO_H = 1920;

    const FONT_SIZE = 36;
    const LINE_SPACING = 14;

    const BOX_W = 900;
    const TEXT_PADDING_X = 60;
    const TEXT_PADDING_Y = 36;

    const textHeight =
      lines * FONT_SIZE + (lines - 1) * LINE_SPACING;

    const BOX_H = textHeight + TEXT_PADDING_Y * 2;

    const BOX_X = (VIDEO_W - BOX_W) / 2;
    const BOX_Y = VIDEO_H - BOX_H - 180;

    const TEXT_X = BOX_X + TEXT_PADDING_X;
    const TEXT_Y = BOX_Y + TEXT_PADDING_Y;
    const TEXT_W = BOX_W - TEXT_PADDING_X * 2;

    const command = `
curl -L "${videoUrl}" -o base.mp4 &&
curl -L "${audioUrl}" -o voice.mp3 &&
ffmpeg -y -i base.mp4 -i voice.mp3 \
-vf "scale=${VIDEO_W}:${VIDEO_H},\
drawbox=x=${BOX_X}:y=${BOX_Y}:w=${BOX_W}:h=${BOX_H}:color=black@0.45:t=fill,\
drawtext=textfile=text.txt:\
fontcolor=white:\
fontsize=${FONT_SIZE}:\
line_spacing=${LINE_SPACING}:\
x=${TEXT_X}:\
y=${TEXT_Y}:\
box=0" \
-map 0:v:0 -map 1:a:0 \
-shortest \
-c:v libx264 -preset ultrafast -crf 23 \
-c:a aac -b:a 192k \
-pix_fmt yuv420p \
"${outputPath}"
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
