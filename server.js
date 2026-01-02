const express = require("express");
const { spawn } = require("child_process");
const fs = require("fs");

const app = express();
app.use(express.json());

app.post("/render", (req, res) => {
  const { videoUrl, audioUrl, text } = req.body;
  if (!videoUrl || !audioUrl) {
    return res.status(400).json({ error: "videoUrl and audioUrl are required" });
  }

  const output = `reel-${Date.now()}.mp4`;

  // Write overlay text to a file
  fs.writeFileSync("text.txt", text || "");

  // Build the FFmpeg command as an array for spawn
  const ffmpegArgs = [
    "-y",
    "-i", "base.mp4",
    "-stream_loop", "-1",
    "-i", "voice.mp3",
    "-vf", 'scale=1080:1920,drawtext=textfile=text.txt:fontcolor=white:fontsize=72:x=(w-text_w)/2:y=1400:box=1:boxcolor=black@0.6:boxborderw=20',
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-shortest",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "23",
    "-c:a", "aac",
    "-b:a", "192k",
    "-pix_fmt", "yuv420p",
    output
  ];

  // Download video and audio first, then run FFmpeg in detached mode
  const downloadCommand = `
curl -L "${videoUrl}" -o base.mp4 && \
curl -L "${audioUrl}" -o voice.mp3
`;

  const download = spawn("bash", ["-c", downloadCommand], { stdio: "inherit" });

  download.on("close", (code) => {
    if (code !== 0) {
      console.error("Download failed");
      return;
    }

    // Start FFmpeg as a detached process
    const ffmpeg = spawn("ffmpeg", ffmpegArgs, {
      detached: true,
      stdio: "ignore"
    });

    ffmpeg.unref(); // Let it run independently

    console.log(`Render started for ${output}`);
    res.json({ success: true, file: output, message: "Render started in background" });
  });
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Renderer running");
});
