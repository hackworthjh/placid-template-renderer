const express = require("express");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

// Ensure renders folder exists
const rendersDir = path.join(__dirname, "renders");
if (!fs.existsSync(rendersDir)) fs.mkdirSync(rendersDir);

app.post("/render", (req, res) => {
  const { videoUrl, audioUrl, text } = req.body;
  if (!videoUrl || !audioUrl) {
    return res.status(400).json({ success: false, message: "videoUrl and audioUrl are required" });
  }

  const outputFileName = `reel-${Date.now()}.mp4`;
  const outputPath = path.join(rendersDir, outputFileName);

  // Absolute path for text overlay
  const textFilePath = path.join(__dirname, "text.txt");
  fs.writeFileSync(textFilePath, text || "");

  const command = `
    curl -L "${videoUrl}" -o base.mp4 && \
    curl -L "${audioUrl}" -o voice.mp3 && \
    ffmpeg -y \
      -i base.mp4 \
      -stream_loop -1 -i voice.mp3 \
      -vf "scale=1080:1920,drawtext=textfile='${textFilePath}':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=h-200:box=1:boxcolor=black@0.6:boxborderw=20" \
      -map 0:v:0 -map 1:a:0 \
      -shortest \
      -c:v libx264 -preset ultrafast -crf 23 \
      -c:a aac -b:a 192k \
      -pix_fmt yuv420p \
      "${outputPath}"
  `;

  exec(command, { maxBuffer: 1024 * 1024 * 50 }, (err, stdout, stderr) => {
    if (err) {
      console.error("Render error:", err);
      console.error("FFmpeg stdout:", stdout);
      console.error("FFmpeg stderr:", stderr);
      return res.status(500).json({
        success: false,
        message: "Render failed. Check server logs for details.",
        error: err.message,
      });
    }

    const baseUrl = req.protocol + "://" + req.get("host");
    res.json({
      success: true,
      file: `${baseUrl}/renders/${outputFileName}`,
      message: "Render complete",
    });
  });
});

// Serve rendered files publicly
app.use("/renders", express.static(rendersDir));

app.listen(process.env.PORT || 3000, () => {
  console.log("Renderer running");
  console.log(`Available at http://localhost:${process.env.PORT || 3000}`);
});
