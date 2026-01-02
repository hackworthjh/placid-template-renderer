const express = require("express");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

// Serve rendered videos statically
app.use("/renders", express.static(path.join(__dirname, "renders")));

app.post("/render", (req, res) => {
  const { videoUrl, audioUrl, text } = req.body;

  if (!videoUrl || !audioUrl) {
    return res.status(400).json({ success: false, message: "videoUrl and audioUrl are required" });
  }

  const outputFileName = `reel-${Date.now()}.mp4`;
  const outputFilePath = path.join(__dirname, "renders", outputFileName);

  // Ensure 'renders' folder exists
  if (!fs.existsSync(path.join(__dirname, "renders"))) {
    fs.mkdirSync(path.join(__dirname, "renders"));
  }

  // Write overlay text to file
  fs.writeFileSync("text.txt", text || "");

  // FFmpeg command with multi-line wrapping and vertical centering
  const command = `
curl -L "${videoUrl}" -o base.mp4 && \
curl -L "${audioUrl}" -o voice.mp3 && \
ffmpeg -y \
  -i base.mp4 \
  -stream_loop -1 -i voice.mp3 \
  -vf "scale=1080:1920,drawtext=textfile=text.txt:fontcolor=white:fontsize='if(gt(text_w,iw-100),(iw-100)*48/text_w,48)':x=(w-text_w)/2:y='h-(text_h+100)':box=1:boxcolor=black@0.6:boxborderw=20:wrap=word" \
  -map 0:v:0 -map 1:a:0 \
  -shortest \
  -c:v libx264 -preset ultrafast -crf 23 \
  -c:a aac -b:a 192k \
  -pix_fmt yuv420p \
  "${outputFilePath}"
`;

  exec(command, { maxBuffer: 1024 * 1024 * 50 }, (err) => {
    if (err) {
      console.error("Render error:", err);
      return res.status(500).json({ success: false, message: "Render failed" });
    }

    const baseUrl = req.protocol + "://" + req.get("host");
    res.json({
      success: true,
      file: `${baseUrl}/renders/${outputFileName}`,
      message: "Render complete",
    });
  });
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Renderer running");
});
