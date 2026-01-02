const express = require("express");
const { exec } = require("child_process");
const fs = require("fs");

const app = express();
app.use(express.json());

// Helper function to wrap text (simple word wrap)
function wrapText(text, maxCharsPerLine = 30) {
  const words = text.split(" ");
  const lines = [];
  let currentLine = "";
  for (const word of words) {
    if ((currentLine + " " + word).trim().length > maxCharsPerLine) {
      lines.push(currentLine.trim());
      currentLine = word;
    } else {
      currentLine += " " + word;
    }
  }
  if (currentLine) lines.push(currentLine.trim());
  return lines.join("\n");
}

app.post("/render", (req, res) => {
  const { videoUrl, audioUrl, text } = req.body;
  const outputFile = `reel-${Date.now()}.mp4`;

  if (!videoUrl || !audioUrl || !text) {
    return res.status(400).json({ success: false, message: "Missing videoUrl, audioUrl, or text" });
  }

  // Wrap text and write to file
  const wrappedText = wrapText(text, 30); // Adjust 30 chars per line if needed
  fs.writeFileSync("text.txt", wrappedText);

  // Calculate font size based on number of lines and target area height (bottom 400px)
  const maxHeight = 400;
  const maxFontSize = 48;
  const lineCount = wrappedText.split("\n").length;
  const fontSize = Math.min(maxFontSize, Math.floor(maxHeight / lineCount));

  // FFmpeg command
  const command = `
    curl -L "${videoUrl}" -o base.mp4 && \
    curl -L "${audioUrl}" -o voice.mp3 && \
    ffmpeg -y \
      -i base.mp4 \
      -stream_loop -1 -i voice.mp3 \
      -vf "scale=1080:1920,drawtext=textfile=text.txt:fontcolor=white:fontsize=${fontSize}:x=(w-text_w)/2:y=h-400:box=1:boxcolor=black@0.6:boxborderw=20:line_spacing=8:reload=1" \
      -map 0:v:0 -map 1:a:0 \
      -shortest \
      -c:v libx264 -preset ultrafast -crf 23 \
      -c:a aac -b:a 192k \
      -pix_fmt yuv420p \
      renders/${outputFile}
  `;

  exec(command, { maxBuffer: 1024 * 1024 * 50 }, (err) => {
    if (err) {
      console.error("FFmpeg error:", err);
      return res.status(500).json({ success: false, message: "Render failed" });
    }
    res.json({
      success: true,
      file: `renders/${outputFile}`,
      message: "Render completed successfully"
    });
  });
});

// Serve rendered files
app.use("/renders", express.static("renders"));

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Renderer running on port", PORT);
  console.log("Available at your primary URL https://placid-template-renderer.onrender.com");
});
