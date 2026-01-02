const express = require("express");
const { exec } = require("child_process");
const fs = require("fs");

const app = express();
app.use(express.json());

// POST /render
app.post("/render", (req, res) => {
  const { videoUrl, audioUrl, text } = req.body;

  if (!videoUrl || !audioUrl) {
    return res.status(400).json({ success: false, message: "videoUrl and audioUrl are required" });
  }

  const outputFile = `reel-${Date.now()}.mp4`;
  const videoFile = "base.mp4";
  const audioFile = "voice.mp3";
  const textFile = "text.txt";

  // Save overlay text safely
  try {
    fs.writeFileSync(textFile, text || "");
  } catch (err) {
    console.error("Error writing text.txt:", err);
    return res.status(500).json({ success: false, message: "Failed to write text file" });
  }

  // Build FFmpeg command
  const command = `
    curl -L "${videoUrl}" -o ${videoFile} && \
    curl -L "${audioUrl}" -o ${audioFile} && \
    ffmpeg -y \
      -i ${videoFile} \
      -stream_loop -1 -i ${audioFile} \
      -vf "scale=1080:1920,drawtext=textfile=${textFile}:fontcolor=white:fontsize=72:x=(w-text_w)/2:y=1400:box=1:boxcolor=black@0.6:boxborderw=20" \
      -map 0:v:0 -map 1:a:0 \
      -shortest \
      -c:v libx264 -preset ultrafast -crf 23 \
      -c:a aac -b:a 192k \
      -pix_fmt yuv420p \
      ${outputFile}
  `;

  // Execute FFmpeg asynchronously
  exec(command, { maxBuffer: 1024 * 1024 * 30 }, (execErr, stdout, stderr) => {
    if (execErr) {
      console.error("FFmpeg error:", execErr);
      console.error("FFmpeg stderr:", stderr);
    } else {
      console.log(`Render complete: ${outputFile}`);
    }

    // Cleanup temporary files
    [videoFile, audioFile, textFile].forEach((file) => {
      fs.unlink(file, (err) => {
        if (err) console.warn(`Could not delete ${file}:`, err.message);
      });
    });
  });

  // Immediately respond to client while render runs
  res.json({
    success: true,
    file: outputFile,
    message: "Render started in background"
  });
});

// Listen on Render-assigned port or fallback 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Renderer running on port ${PORT}`);
  console.log("==> Your service is live 🎉");
});
