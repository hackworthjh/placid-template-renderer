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

function escapeASS(text) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}")
    .replace(/\n/g, "\\N");
}

function buildASS(text) {
  const VIDEO_W = 1080;
  const VIDEO_H = 1920;

  const BOX_W = 900;
  const BOX_X = (VIDEO_W - BOX_W) / 2;
  const BOX_Y = VIDEO_H - 520;

  const MARGIN_L = BOX_X + 60;
  const MARGIN_R = BOX_X + 60;
  const MARGIN_V = 40;

  return `
[Script Info]
ScriptType: v4.00+
PlayResX: ${VIDEO_W}
PlayResY: ${VIDEO_H}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Arial,36,&H00FFFFFF,&H00000000,&H66000000,0,0,3,0,0,2,${MARGIN_L},${MARGIN_R},${MARGIN_V},1

[Events]
Format: Layer, Start, End, Style, Text
Dialogue: 0,0:00:00.00,0:10:00.00,Caption,${escapeASS(text)}
`;
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

    fs.writeFileSync("captions.ass", buildASS(text));

    const command = `
curl -L "${videoUrl}" -o base.mp4 &&
curl -L "${audioUrl}" -o voice.mp3 &&
ffmpeg -y -i base.mp4 -i voice.mp3 \
-vf "scale=1080:1920,subtitles=captions.ass" \
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
