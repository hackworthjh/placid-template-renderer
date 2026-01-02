const express = require("express");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

const rendersDir = path.join(__dirname, "renders");
if (!fs.existsSync(rendersDir)) fs.mkdirSync(rendersDir);

function wrapText(text, maxCharsPerLine = 30) {
  if (!text) return "";
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > maxCharsPerLine) {
      lines.push(line.trim());
      line = word;
    } else {
      line += " " + word;
    }
  }
  if (line) lines.push(line.trim());
  return lines.join("\\n"); // FFmpeg needs \n as literal for newlines
}

app.post("/render", (req, res) => {
  const { videoUrl, audioUrl, text } = req.body;

  if (!videoUrl || !audioUrl) {
    return res.status(400).json({ success: false, message: "videoUrl and audioUrl are required" });
  }

  const outputFile = `reel-${Date.now()}.mp4`;
  const outputPath = path.join(rendersDir, outputFile);

  // Wrap text to fit video width
  const wrappedText = wrapText(text, 30); // adjust 30 for desired width

  const drawtext = `drawtext=text='${wrappedText.replace(/'/g, "'\\''")}':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=h-300:box=1:boxcolor=black@0.6:boxborderw=20:line_spacing=10`;

  const command = `
    curl -L "${videoUrl}" -o base.mp4 && \
    curl -L "${audioUrl}" -o voice.mp3 && \
    ffmpeg -y \
      -i base.mp4 \
      -stream_loop -1 -i voice.mp3 \
      -vf "${drawtext}" \
      -map 0:v:0 -map 1:a:0 \
      -shortest \
      -c:v libx264 -preset ultrafast -crf 23 \
      -c:a aac -b:a 192k \
      -pix_fmt yuv420p \
      "${outputPath}"
  `;

  exec(command, { maxBuffer: 1024 * 1024 * 50 }, (err, stdout, stderr) => {
    if (err) {
      console.error("Render failed:", err);
      console.error(stderr);
      return res.status(500).json({ success: false, message: "Render failed" });
    }

    const fullUrl = `${req.protocol}://${req.get("host")}/renders/${outputFile}`;
    res.json({ success: true, file: fullUrl, message: "Render completed" });
  });
});

app.use("/renders", express.static(rendersDir));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("Renderer running on port", port);
  console.log("Your service is live 🎉");
});
