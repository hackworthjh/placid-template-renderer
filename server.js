const express = require("express");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

// Serve rendered videos
app.use("/renders", express.static(path.join(__dirname, "renders")));

// Utility: ensure directory exists
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
}

// POST /render
app.post("/render", async (req, res) => {
  try {
    const { videoUrl, audioUrl, text } = req.body;

    if (!videoUrl || !audioUrl || !text) {
      return res.status(400).json({ error: "Missing videoUrl, audioUrl, or text" });
    }

    ensureDir("renders");

    const id = Date.now();
    const outputFile = `reel-${id}.mp4`;
    const outputPath = path.join("renders", outputFile);

    // ---------- ASS SUBTITLE FILE (CENTERED TEXT) ----------
    const assText = `
[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, BackColour, Bold, Italic, Alignment, MarginL, MarginR, MarginV, BorderStyle, Outline, Shadow
Style: Default,Arial,56,&H00FFFFFF,&HA0000000,0,0,2,60,60,220,3,2,0

[Events]
Format: Layer, Start, End, Style, Text
Dialogue: 0,0:00:00.00,0:01:00.00,Default,${text
      .replace(/\r?\n/g, "\\N")
      .replace(/:/g, "\\:")}
`;

    fs.writeFileSync("captions.ass", assText);

    // ---------- FFmpeg COMMAND ----------
    const command = `
curl -L "${videoUrl}" -o base.mp4 &&
curl -L "${audioUrl}" -o voice.mp3 &&
ffmpeg -y \
-i base.mp4 \
-i voice.mp3 \
-vf "scale=1080:1920,subtitles=captions.ass" \
-map 0:v:0 -map 1:a:0 \
-shortest \
-c:v libx264 -preset ultrafast -crf 23 \
-c:a aac -b:a 192k \
-pix_fmt yuv420p \
"${outputPath}"
`;

    exec(command, { maxBuffer: 1024 * 1024 * 100 }, (err, stdout, stderr) => {
      if (err) {
        console.error("FFmpeg failed:", stderr);
        return res.status(500).json({ error: "Render failed" });
      }

      res.json({
        success: true,
        file: `/renders/${outputFile}`,
        url: `/renders/${outputFile}`
      });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Renderer running on port ${PORT}`);
});
