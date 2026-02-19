const express = require("express");
const { exec, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());
app.use("/renders", express.static(path.join(__dirname, "renders")));

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
}

/* ---------- helpers ---------- */

function sanitize(text) {
  return String(text)
    .replace(/[{}]/g, "")
    .replace(/\\/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

function wrapText(text, maxChars = 40) {
  const words = text.split(" ");
  const lines = [];
  let line = "";

  for (const w of words) {
    const test = (line ? line + " " : "") + w;
    if (test.length > maxChars) {
      if (line) lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function roundedRectPath(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  const x2 = x + w;
  const y2 = y + h;

  return [
    `m ${x + r} ${y}`,
    `l ${x2 - r} ${y}`,
    `b ${x2} ${y} ${x2} ${y} ${x2} ${y + r}`,
    `l ${x2} ${y2 - r}`,
    `b ${x2} ${y2} ${x2} ${y2} ${x2 - r} ${y2}`,
    `l ${x + r} ${y2}`,
    `b ${x} ${y2} ${x} ${y2} ${x} ${y2 - r}`,
    `l ${x} ${y + r}`,
    `b ${x} ${y} ${x} ${y} ${x + r} ${y}`
  ].join(" ");
}

function getAudioDurationMs(file) {
  try {
    const out = execSync(
      `ffprobe -v error -show_entries format=duration -of default=nokey=1:noprint_wrappers=1 "${file}"`
    ).toString();
    return Math.floor(parseFloat(out) * 1000);
  } catch {
    return 8000;
  }
}

/* ---------- endpoint ---------- */

app.post("/render", (req, res) => {
  try {
    const { videoUrl, audioUrl, text, hook } = req.body;

    if (!videoUrl || !audioUrl || !text || !hook) {
      return res.status(400).json({ error: "Missing inputs" });
    }

    ensureDir("renders");

    const id = Date.now();
    const output = `renders/reel-${id}.mp4`;

    const VIDEO_W = 1080;
    const VIDEO_H = 1920;

    /* ---------- BOTTOM STORY BOX ---------- */

    const BOX_W = 900;
    const BOX_X = Math.round((VIDEO_W - BOX_W) / 2);
    const BOX_Y = 1280;
    const RADIUS = 60;

    const FONT_SIZE = 44;
    const LINE_SPACING = 56;
    const PAD_T = 30;
    const PAD_B = 30;

    const safeText = sanitize(text);
    const lines = wrapText(safeText, 40);

    const textHeight = lines.length * LINE_SPACING;
    const BOX_H = textHeight + PAD_T + PAD_B;

    const boxShape = roundedRectPath(
      BOX_X,
      BOX_Y,
      BOX_W,
      BOX_H,
      RADIUS
    );

    /* ---------- TOP HOOK BOX ---------- */

    const HOOK_BOX_W = 900;
    const HOOK_BOX_X = Math.round((VIDEO_W - HOOK_BOX_W) / 2);
    const HOOK_BOX_Y = 150;
    const HOOK_RADIUS = 50;

    const HOOK_FONT_SIZE = 60;
    const HOOK_PAD_T = 35;
    const HOOK_PAD_B = 35;

    const safeHook = sanitize(hook);
    const hookLines = wrapText(safeHook, 28);

    const hookTextHeight = hookLines.length * (HOOK_FONT_SIZE + 10);
    const HOOK_BOX_H = hookTextHeight + HOOK_PAD_T + HOOK_PAD_B;

    const hookShape = roundedRectPath(
      HOOK_BOX_X,
      HOOK_BOX_Y,
      HOOK_BOX_W,
      HOOK_BOX_H,
      HOOK_RADIUS
    );

    /* ---------- DOWNLOAD MEDIA ---------- */

    const downloadCmd = `
curl -L "${videoUrl}" -o base.mp4 &&
curl -L "${audioUrl}" -o audio.mp3
`;

    exec(downloadCmd, (err) => {
      if (err) return res.status(500).json({ error: "Download failed" });

      const audioMs = getAudioDurationMs("audio.mp3");
      const perLineMs = Math.floor(audioMs / Math.max(1, lines.length));

      let events = "";
      let hookEvents = "";

      /* ---------- Hook Text Events ---------- */

      hookLines.forEach((line, i) => {
        const y = HOOK_BOX_Y + HOOK_PAD_T + i * (HOOK_FONT_SIZE + 10);

        hookEvents += `
Dialogue: 2,0:00:00.00,0:01:00.00,Hook,{\\an8\\pos(${VIDEO_W / 2},${y})\\fs${HOOK_FONT_SIZE}\\bord0\\shad0}${line}
`;
      });

      /* ---------- Story Text Events ---------- */

      lines.forEach((line, i) => {
        const startMs = i * perLineMs;
        const s = Math.floor(startMs / 1000);
        const cs = Math.floor((startMs % 1000) / 10);
        const start = `0:00:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;

        const y = BOX_Y + PAD_T + i * LINE_SPACING;

        events += `
Dialogue: 1,${start},0:01:00.00,Text,{\\an8\\pos(${VIDEO_W / 2},${y})\\fs${FONT_SIZE}\\bord0\\shad0\\alpha&HFF&\\t(0,300,\\alpha&H00&)}${line}
`;
      });

      /* ---------- ASS FILE ---------- */

      const ass = `
[Script Info]
ScriptType: v4.00+
PlayResX: ${VIDEO_W}
PlayResY: ${VIDEO_H}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Box,Arial,1,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: Text,Liberation Sans,${FONT_SIZE},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,8,0,0,0,1
Style: Hook,Liberation Sans,${HOOK_FONT_SIZE},&H0000D7FF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,8,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Text

Dialogue: 0,0:00:00.00,0:01:00.00,Box,{\\p1\\bord2\\shad0\\1c&H000000&\\3c&HFFFFFF&\\alpha&H40&}${hookShape}{\\p0}
${hookEvents}

Dialogue: 0,0:00:00.00,0:01:00.00,Box,{\\p1\\bord2\\shad0\\1c&H000000&\\3c&HFFFFFF&\\alpha&H80&}${boxShape}{\\p0}
${events}
`.trim();

      fs.writeFileSync("captions.ass", ass);

      const BORDER = 8;

      const renderCmd = `
ffmpeg -y -i base.mp4 -i audio.mp3 \
-vf "scale=${VIDEO_W}:${VIDEO_H},drawbox=x=0:y=0:w=${VIDEO_W}:h=${VIDEO_H}:t=${BORDER}:color=gray,subtitles=captions.ass" \
-map 0:v -map 1:a -shortest \
-c:v libx264 -preset ultrafast -crf 23 \
-c:a aac -b:a 192k -pix_fmt yuv420p "${output}"
`;

      exec(renderCmd, (err2) => {
        if (err2) return res.status(500).json({ error: "Render failed" });
        res.json({ success: true, url: `/${output}` });
      });
    });
  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
});

app.listen(process.env.PORT || 10000, () =>
  console.log("Renderer running")
);
