const express = require("express");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

// Serve the "renders" folder statically
const RENDERS_DIR = path.join(__dirname, "renders");
if (!fs.existsSync(RENDERS_DIR)) fs.mkdirSync(RENDERS_DIR);
app.use("/renders", express.static(RENDERS_DIR));

app.post("/render", (req, res) => {
  const { videoUrl, audioUrl, text } = req.body;
  if (!videoUrl || !audioUrl) {
    return res.status(400).json({ success: false, message: "videoUrl and audioUrl are required" });
  }

  const outputFileName = `reel-${Date.now()}.mp4`;
  const outputPath = path.join(RENDERS_DIR, outputFileName);

  const textPath = path.join(__dirname, "text.txt");
fs.writeFileSync(textPath, text || "");

const command = `
curl -L "${videoUrl}" -o base.mp4 && \
curl -L "${audioUrl}" -o voice.mp3 && \
ffmpeg -y \
  -i base.mp4 \
  -stream_loop -1 -i voice.mp3 \
  -vf "scale=1080:1920,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:textfile=${textPath}:fontcolor=white:fontsize=72:x=(w-text_w)/2:y=1400:box=1:boxcolor=black@0.6:boxborderw=20" \
  -map 0:v:0 -map 1:a:0 \
  -shortest \
  -c:v libx264 -preset ultrafast -crf 23 \
  -c:a aac -b:a 192k \
  -pix_fmt yuv420p \
  "${outputPath}"
`;

  // Execute FFmpeg
  exec(command, { maxBuffer: 1024 * 1024 * 50 }, (err, stdout, stderr) => {
    if (err) {
      console.error("FFmpeg error:", err);
      console.error("FFmpeg stderr:", stderr);
      return res.status(500).json({ success: false, message: "Render failed", error: err.message });
    }

    console.log("Render complete:", outputFileName);
    // Respond with a full URL so Make can download directly
    const fileUrl = `${req.protocol}://${req.get("host")}/renders/${outputFileName}`;
    res.json({
      success: true,
      file: fileUrl,
      message: "Render complete",
      stdout,
      stderr
    });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Renderer running on port ${PORT}`);
});
