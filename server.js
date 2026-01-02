const express = require("express");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

// Serve rendered videos
app.use("/renders", express.static(path.join(__dirname, "renders")));

function wrapText(text, maxCharsPerLine = 28) {
  const words = text.split(" ");
  let lines = [];
  let current = "";

  for (const word of words) {
    if ((current + " " + word).trim().length > maxCharsPerLine) {
      lines.push(current.trim());
      current = word;
    } else {
      current += " " + word;
    }
  }
  if (current.trim()) lines.push(current.trim());
  return lines.join("\n");
}

app.post("/render", (req, res) => {
  try {
    const { videoUrl, audioUrl, text } = req.body;
    if (!videoUrl || !audioUrl || !text) {
      return res.status(400).json({ error: "Missing inputs" });
    }

    const id = Date.now();
    const outputFile = `reel-${id}.mp4`;
    const outputPath = path.join("renders", outputFile);

    if (!fs.existsSync("renders")) fs.mkdirSync("renders");

    // Wrap text safely
    const wrappedText = wrapText(text);
    fs.writeFileSync("text.txt", wrappedText);

    // Build the command as a single line string
    const command = [
  `curl -L "${videoUrl}" -o base.mp4`,
  `curl -L "${audioUrl}" -o voice.mp3`,
  `ffmpeg -y -i base.mp4 -i voice.mp3 -vf "scale=1080:1920,drawtext=textfile=text.txt:fontcolor=white:fontsize=56:line_spacing=14:box=1:boxcolor=black@0.65:boxborderw=30:x=(w-text_w)/2:y=h-text_h-220:align=center" -map 0:v:0 -map 1:a:0 -shortest -c:v libx264 -preset ultrafast -crf 23 -c:a aac -b:a 192k -pix_fmt yuv420p ${outputPath}`
].join(" && ");


    exec(command, { maxBuffer: 1024 * 1024 * 50 }, (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Render failed" });
      }

      res.json({
        success: true,
        file: `/renders/${outputFile}`,
        url: `/renders/${outputFile}`
      });
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Renderer running");
});
