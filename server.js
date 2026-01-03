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

// Hard wrap text into lines
function wrapText(text, maxChars = 26) {
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
  return lines.join("\\N");
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

    const wrappedText = wrapText(text);

    /**
     * ASS subtitle with:
     * Layer 0 → translucent box
     * Layer 1 → centered text
     */
    const ass = `
[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV
Style: Box,Arial,1,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,1,0,0,2,0,0,0
Style: Text,Arial,54,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,1,1,0,2,140,140,220

[Events]
Format: Layer, Start, End, Style, Text

; --- Translucent rectangle (centered near bottom) ---
Dialogue: 0,0:00:00.00,0:01:00.00,Box,{\\pos(540,1550)\\p1}m -420 -120 l 420 -120 l 420 120 l -420 120{\\p0}

; --- Text on top ---
Dialogue: 1,0:00:00.00,0:01:00.00,Text,${wrappedText}
`;

    fs.writeFileSync("captions.ass", ass);

    const command = `
curl -L "${videoUrl}" -o base.mp4 &&
curl -L "${audioUrl}" -o voice.mp3 &&
ffmpeg -y \
-i base.mp4 \
-i voice.mp3 \
-vf "scale=1080:1920,subtitles=captions.ass" \
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
        url: `/renders/${outputFile}`
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
