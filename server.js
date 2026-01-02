const express = require("express");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

// Ensure the renders folder exists
const rendersDir = path.join(__dirname, "renders");
if (!fs.existsSync(rendersDir)) {
  fs.mkdirSync(rendersDir);
}

app.post("/render", (req, res) => {
  const { videoUrl, audioUrl, text } = req.body;
  const timestamp = Date.now();
  const output = `reel-${timestamp}.mp4`;
  const outputPath = path.join("renders", output);

  // Write overlay text to a file
  fs.writeFileSync("text.txt", text || "");

  // FFmpeg command with bottom text box
  const command = `
    curl -L "${videoUrl}" -o base.mp4 && \
    curl -L "${audioUrl}" -o voice.mp3 && \
    ffmpeg -y \
      -i base.mp4 \
      -stream_loop -1 -i voice.mp3 \
      -vf "scale=1080:1920,drawtext=textfile=text.txt:fontcolor=white:fontsize=72:box=1:boxcolor=black@0.6:boxborderw=10:x=(w-text_w)/2:y=h-(text_h+50):force_style='Alignment=2'" \
      -map 0:v:0 -map 1:a:0 \
      -shortest \
      -c:v libx264 -preset ultrafast -crf 23 \
      -c:a aac -b:a 192k \
      -pix_fmt yuv420p \
      ${outputPath}
  `;

  exec(command, { maxBuffer: 1024 * 1024 * 50 }, (err, stdout, stderr) => {
    if (err) {
      console.error("FFmpeg error:", stderr || err);
      return res.status(500).json({ success: false, message: "Render failed" });
    }
    res.json({ success: true, file: output, message: "Render complete" });
  });
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Renderer running");
});
