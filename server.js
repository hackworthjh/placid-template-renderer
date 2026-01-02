const express = require("express");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

app.post("/render", (req, res) => {
  const { videoUrl, audioUrl, text } = req.body;
  if (!videoUrl || !audioUrl) {
    return res.status(400).send("Missing videoUrl or audioUrl");
  }

  const output = `reel-${Date.now()}.mp4`;

  // Write overlay text to a file (prevents FFmpeg crashes)
  fs.writeFileSync("text.txt", text || "");

  const command = `
curl -L "${videoUrl}" -o base.mp4 && \
curl -L "${audioUrl}" -o voice.mp3 && \
ffmpeg -y \
  -i base.mp4 \
  -stream_loop -1 -i voice.mp3 \
  -vf "scale=1080:1920,drawtext=textfile=text.txt:fontcolor=white:fontsize=72:x=(w-text_w)/2:y=1400:box=1:boxcolor=black@0.6:boxborderw=20" \
  -map 0:v:0 -map 1:a:0 \
  -shortest \
  -c:v libx264 -preset ultrafast -crf 23 \
  -c:a aac -b:a 192k \
  -pix_fmt yuv420p \
  ${output}
`;

  exec(command, { maxBuffer: 1024 * 1024 * 50 }, (err, stdout, stderr) => {
    if (err) {
      console.error("FFmpeg error:", err);
      console.error("stderr:", stderr);
      return res.status(500).send("Render failed");
    }
    res.json({ success: true, file: output });
  });
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Renderer running");
  console.log("==> Your service is live 🎉");
});
