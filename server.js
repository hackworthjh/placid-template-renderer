const express = require("express");
const { exec } = require("child_process");
const app = express();

app.use(express.json());

app.post("/render", (req, res) => {
  const { videoUrl, audioUrl, overlayText } = req.body;
  const output = `reel-${Date.now()}.mp4`;

  const command = `
    curl -L "${videoUrl}" -o base.mp4 &&
    curl -L "${audioUrl}" -o voice.mp3 &&
    ffmpeg -y \
      -i base.mp4 \
      -i voice.mp3 \
      -vf "scale=1080:1920,drawtext=text='${overlayText}':fontcolor=white:fontsize=72:x=(w-text_w)/2:y=1400:box=1:boxcolor=black@0.6:boxborderw=20" \
      -map 0:v -map 1:a -shortest \
      -c:v libx264 -preset fast -crf 23 \
      -pix_fmt yuv420p \
      ${output}
  `;

  exec(command, (error) => {
    if (error) {
      console.error(error);
      return res.status(500).send("Render failed");
    }
    res.json({ success: true, file: output });
  });
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Renderer running");
});
