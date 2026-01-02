const express = require("express");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

// Ensure 'renders' folder exists
const rendersDir = path.join(__dirname, "renders");
if (!fs.existsSync(rendersDir)) fs.mkdirSync(rendersDir);

app.post("/render", (req, res) => {
  const { videoUrl, audioUrl, text } = req.body;
  if (!videoUrl || !audioUrl) {
    return res.status(400).json({ success: false, message: "videoUrl and audioUrl are required" });
  }

  const timestamp = Date.now();
  const outputFile = `reel-${timestamp}.mp4`;
  const outputPath = path.join(rendersDir, outputFile);

  // Prepare text file with line breaks (\n) if needed
  fs.writeFileSync(path.join(__dirname, "text.txt"), text || "");

  // Build FFmpeg command
  const command = `
    curl -L "${videoUrl}" -o base.mp4 && \
    curl -L "${audioUrl}" -o voice.mp3 && \
    ffmpeg -y \
      -i base.mp4 \
      -stream_loop -1 -i voice.mp3 \
      -vf "scale=1080:1920,drawtext=textfile=text.txt:fontcolor=white:fontsize=60:box=1:boxcolor=black@0.6:boxborderw=20:x=(w-text_w)/2:y=h-(text_h*3)-50" \
      -map 0:v:0 -map 1:a:0 \
      -shortest \
      -c:v libx264 -preset ultrafast -crf 23 \
      -c:a aac -b:a 192k \
      -pix_fmt yuv420p \
      "${outputPath}"
  `;

  exec(command, { maxBuffer: 1024 * 1024 * 50 }, (err, stdout, stderr) => {
    if (err) {
      console.error("FFmpeg error:", stderr || err);
      return res.status(500).json({ success: false, message: "Render failed" });
    }
    res.json({
      success: true,
      file: `/renders/${outputFile}`,
      message: "Render completed"
    });
  });
});

// Serve rendered files statically
app.use("/renders", express.static(rendersDir));

app.listen(process.env.PORT || 3000, () => {
  console.log("Renderer running");
});
