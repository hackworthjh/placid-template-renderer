const express = require("express");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

app.post("/render", (req, res) => {
  const { videoUrl, audioUrl, text } = req.body;
  const output = `reel-${Date.now()}.mp4`;
  const outputPath = path.join(__dirname, output);

  // Write overlay text to a file
  const textPath = path.join(__dirname, "text.txt");
  fs.writeFileSync(textPath, text || "");

  // FFmpeg command with fontfile for Linux
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

  exec(command, { maxBuffer: 1024 * 1024 * 50 }, (err) => {
    if (err) {
      console.error(err);
      return res.status(500).send("Render failed");
    }
    // Return the file URL
    res.json({ success: true, file: `http://placid-template-renderer.onrender.com/${output}` });
  });
});

// Serve rendered videos
app.use(express.static(__dirname));

app.listen(process.env.PORT || 3000, () => {
  console.log("Renderer running");
});
