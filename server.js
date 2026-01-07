const express = require("express");
const { exec, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

app.use("/renders", express.static(path.join(__dirname, "renders")));

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/* ================= TEXT HELPERS ================= */

function sanitizeForAssUserText(s) {
  return String(s)
    .replace(/[{}]/g, "")
    .replace(/\\/g, "/")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

function breakLongWords(text, maxChars) {
  const parts = text.split(" ");
  const out = [];
  for (const p of parts) {
    if (p.length <= maxChars) out.push(p);
    else {
      let i = 0;
      while (i < p.length) {
        out.push(p.slice(i, i + maxChars));
        i += maxChars;
      }
    }
  }
  return out.join(" ");
}

function wrapText(text, maxChars) {
  const words = text.split(" ");
  const lines = [];
  let line = "";

  for (const word of words) {
    const test = (line ? line + " " : "") + word;
    if (test.length > maxChars) {
      if (line) lines.push(line);
      line = word;
    } else line = test;
  }
  if (line) lines.push(line);

  return lines.join("\\N");
}

/* ================= BOX / FIT LOGIC ================= */

function estimateLineH(fontSize) {
  return Math.round(fontSize * 1.2);
}

function computeMaxLines(boxH, padT, padB, fontSize) {
  return Math.max(
    1,
    Math.floor((boxH - padT - padB) / estimateLineH(fontSize))
  );
}

function estimateCharsPerLine(usableW, fontSize) {
  return Math.max(12, Math.floor(usableW / (fontSize * 0.55)));
}

/**
 * KEY CHANGE:
 * - keeps searching
 * - prefers MORE lines (fills vertically)
 */
function fitTextToBox(text, boxW, boxH, opts) {
  const {
    padL = 40,
    padR = 40,
    padT = 30,
    padB = 30,
    startFont = 50,
    minFont = 30,
    safetyChars = 2,
    range = 12
  } = opts;

  const usableW = boxW - padL - padR;
  let best = null;

  for (let fontSize = startFont; fontSize >= minFont; fontSize -= 2) {
    const maxLines = computeMaxLines(boxH, padT, padB, fontSize);
    const est = estimateCharsPerLine(usableW, fontSize);

    for (let chars = est - range; chars <= est + range; chars += 2) {
      const safeChars = Math.max(10, chars - safetyChars);
      const safe = breakLongWords(text, safeChars);
      const wrapped = wrapText(safe, safeChars);
      const lineCount = wrapped.split("\\N").length;

      if (lineCount <= maxLines) {
        if (!best || lineCount > best.lineCount) {
          best = { wrapped, fontSize, lineCount };
        }
      }
    }

    if (best && best.lineCount === maxLines) break;
  }

  return best;
}

/* ================= KARAOKE ================= */

function buildKaraokeText(wrappedAssText, totalMs) {
  const tokens = wrappedAssText.split(/(\s|\\N)/).filter(Boolean);
  const words = tokens.filter(t => t !== " " && t !== "\\N");
  if (!words.length) return wrappedAssText;

  const perWord = Math.max(6, Math.floor(totalMs / words.length / 10));

  let out = "";
  for (const t of tokens) {
    if (t === " " || t === "\\N") out += t;
    else out += `{\\kf${perWord}}${t}`;
  }
  return out;
}

function getDurationMs(file) {
  try {
    const s = execSync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${file}"`
    ).toString();
    return Math.round(parseFloat(s) * 1000);
  } catch {
    return null;
  }
}

/* ================= RENDER ================= */

app.post("/render", (req, res) => {
  try {
    const { videoUrl, audioUrl, text } = req.body;
    if (!videoUrl || !audioUrl || !text)
      return res.status(400).json({ error: "Missing inputs" });

    ensureDir("renders");

    const id = Date.now();
    const output = `renders/reel-${id}.mp4`;

    const VIDEO_W = 1080;
    const VIDEO_H = 1920;

    const BOX_W = 870;
    const BOX_H = 380;
    const BOX_X = (VIDEO_W - BOX_W) / 2;
    const BOX_Y = 1120;
    const RADIUS = 60;

    const PAD_L = 40;
    const PAD_R = 40;
    const PAD_T = 30;
    const PAD_B = 30;

    const clean = sanitizeForAssUserText(text);

    const fit = fitTextToBox(clean, BOX_W, BOX_H, {
      padL: PAD_L,
      padR: PAD_R,
      padT: PAD_T,
      padB: PAD_B
    });

    const TEXT_X = VIDEO_W / 2;
    const TEXT_Y = BOX_Y + PAD_T;

    const CLIP = `${BOX_X + PAD_L},${BOX_Y + PAD_T},${BOX_X + BOX_W - PAD_R},${BOX_Y + BOX_H - PAD_B}`;

    const BOX_SHAPE = `
m ${BOX_X + RADIUS} ${BOX_Y}
l ${BOX_X + BOX_W - RADIUS} ${BOX_Y}
b ${BOX_X + BOX_W} ${BOX_Y} ${BOX_X + BOX_W} ${BOX_Y} ${BOX_X + BOX_W} ${BOX_Y + RADIUS}
l ${BOX_X + BOX_W} ${BOX_Y + BOX_H - RADIUS}
b ${BOX_X + BOX_W} ${BOX_Y + BOX_H} ${BOX_X + BOX_W} ${BOX_Y + BOX_H} ${BOX_X + BOX_W - RADIUS} ${BOX_Y + BOX_H}
l ${BOX_X + RADIUS} ${BOX_Y + BOX_H}
b ${BOX_X} ${BOX_Y + BOX_H} ${BOX_X} ${BOX_Y + BOX_H} ${BOX_X} ${BOX_Y + BOX_H - RADIUS}
l ${BOX_X} ${BOX_Y + RADIUS}
b ${BOX_X} ${BOX_Y} ${BOX_X} ${BOX_Y} ${BOX_X + RADIUS} ${BOX_Y}
`.trim();

    exec(`curl -L "${videoUrl}" -o base.mp4 && curl -L "${audioUrl}" -o voice.mp3`, err => {
      if (err) return res.status(500).json({ error: "Download failed" });

      const dur = Math.min(
        getDurationMs("base.mp4") || 10000,
        getDurationMs("voice.mp3") || 10000
      );

      const karaoke = buildKaraokeText(fit.wrapped, dur - 1200);

      const ass = `
[Script Info]
PlayResX:${VIDEO_W}
PlayResY:${VIDEO_H}
WrapStyle:2

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Box,Arial,1,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: Text,DejaVu Sans Bold,${fit.fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,8,0,0,0,1

[Events]
Format: Layer,Start,End,Style,Text
Dialogue:0,0:00:00.00,0:01:00.00,Box,{\\p1\\1c&H000000&\\alpha&H80&}${BOX_SHAPE}{\\p0}
Dialogue:1,0:00:00.00,0:01:00.00,Text,{\\an8\\pos(${TEXT_X},${TEXT_Y})\\clip(${CLIP})\\2a&HFF&}${karaoke}
`;

      fs.writeFileSync("captions.ass", ass);

      exec(
        `ffmpeg -y -i base.mp4 -i voice.mp3 -vf "scale=${VIDEO_W}:${VIDEO_H},subtitles=captions.ass" -shortest -pix_fmt yuv420p "${output}"`,
        err2 => {
          if (err2) return res.status(500).json({ error: "Render failed" });
          res.json({ success: true, url: `/${output}` });
        }
      );
    });
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

app.listen(process.env.PORT || 10000, () =>
  console.log("Renderer running")
);
