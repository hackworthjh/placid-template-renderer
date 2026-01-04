const express = require("express");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

app.use("/renders", express.static(path.join(__dirname, "renders")));

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
}

/**
 * VERY IMPORTANT:
 * At fontsize 56 and 900px width,
 * ~16 characters per line is the max safe value
 */
function wrapText(text, maxChars = 16) {
  const words = text.split(" ");
  const lines = [];
  let line = "";

  for (const word of words) {
    if ((line + " " + word).trim().length > maxChars) {
      lines.push(line.trim());
      line = word;
    } else {
      line += " " + word;
    }
  }

  if (line.trim()) lines.push(line.trim());

  // REAL newlines (not escaped)
  return lines.join("\n");
}

app.post("/render", (req, res) => {
  try {
    const { videoUrl, audioUrl, text } = req.body;
    if (!videoUrl || !audioUrl || !text) {
      return res.status(400).json({ error: "Missing inputs" });
    }

    ensureDir("renders");

    const id = Date.now();
    const outputFile = `reel-${id}.mp4`;
    const outputPath = path.join("renders", outputFile);

    // Write wrapped text
    const wrappedText = wrapText(text);
    fs.writeFileSync("text.txt", wrappedText);

    // ===== LAYOUT CONSTANTS =====
    const VIDEO_W = 1080;
    const VIDEO_H = 1920;

    const BOX_W = 900;
    const BOX_H = 360;

    const BOX_X = (VIDEO_W - BOX_W) / 2;
    const BOX_Y = VIDEO_H - 620;

    // Text anchored INSIDE the box
    const TEXT_X = "(w-text_w)/2";
    const TEXT_Y = BOX_Y + 70;

    const command = `
curl -L "${videoUrl}" -o base.mp4 &&
curl -L "${audioUrl}" -o voice.mp3 &&
ffmpeg -y -i base.mp4 -i voice.mp3 \
-vf "scale=${VIDEO_W}:${VIDEO_H},\
drawbox=x=${BOX_X}:y=${BOX_Y}:w=${BOX_W}:h=${BOX_H}:color=black@0.55:t=fill,\
drawtext=textfile=text.txt:\
fontcolor=white:\
fontsize=56:\
line_spacing=20:\
x=${TEXT_X}:\
y=${TEXT_Y}" \
-map 0:v:0 -map 1:a:0 \
-shortest \
-c:v libx264 -preset ultrafast -crf 23 \
-c:a aac -b:a 192k \
-pix_fmt yuv420p \
"${outputPath}"
`;

    exec(command, { maxBuffer: 1024 * 1024 * 100 }, (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Render failed" });
      }

      res.json({
        success: true,
        url: `/renders/${outputFile}`,
      });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Renderer running on port ${PORT}`);
});
