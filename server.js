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
  if (!videoUrl || !audioUrl) {
    return res.status(400).json({ success: false, message: "videoUrl and audioUrl are required" });
  }

  const outputFile = `reel-${Date.now()}.mp4`;
  const outputPath = path.join("renders", outputFile);

  // Write overlay text to file for FFmpeg
  fs.writeFileSync("text.txt", text || "");

  const command = `
curl -L "${videoUrl}" -o base.mp4 && \
curl -L "${audioUrl}" -o voice.mp3 && \
ffmpeg -y \
  -i base.mp4 \
  -stream_loop -1 -i voice.mp3 \
  -vf "scale=1080:1920,drawtext=textfile=text.txt:fontcolor=white:fontsize=60:box=1:boxcolor=black@0.6:boxborderw=20:x=(w-text_w)/2:y=h-(text_h*3)-50:wrap=1" \
  -map 0:v:0 -map 1:a:0 \
  -shortest \
  -c:v libx264 -preset ultrafast -crf 23 \
  -c:a aac -b:a 192k \
  -pix_fmt yuv420p \
  "${outputPath}"
`;

  exec(command, { maxBuffer: 1024 * 1024 * 50 }, (err, stdout, stderr) => {
    if (err) {
      console.error("FFmpeg error:", err);
      console.error("STDOUT:", stdout);
      console.error("STDERR:", stderr);
      return res.status(500).json({ success: false, message: "Render failed" });
    }

    res.json({
      success: true,
      file: `https://${req.headers.host}/${outputPath}`,
      message: "Render completed successfully"
    });
  });
});

// Serve the renders folder statically
app.use("/renders", express.static(path.join(__dirname, "renders")));

app.listen(process.env.PORT || 3000, () => {
  console.log("Renderer running");
  console.log("Service is live at port", process.env.PORT || 3000);
});
