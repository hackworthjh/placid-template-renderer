const { exec } = require("child_process");

const IMAGE_URL = "https://res.cloudinary.com/dj7j23fjf/image/upload/v1770236487/reels/image_j1q7cb.png";

const TEXT = "Test that hopefully works";

const cmd = `
ffmpeg -y \
-loop 1 \
-i "${IMAGE_URL}" \
-vf "scale=1080:1920,
zoompan=z='min(zoom+0.0009,1.12)':d=180,
drawtext=text='${TEXT}':
fontcolor=white:
fontsize=64:
box=1:
boxcolor=black@0.45:
boxborderw=30:
x=(w-text_w)/2:
y=h*0.72" \
-t 6 \
-r 30 \
-pix_fmt yuv420p \
output.mp4
`;

exec(cmd, (err, stdout, stderr) => {
  if (err) {
    console.error("FFmpeg error:", stderr);
    process.exit(1);
  }

  console.log("Video created successfully");
  process.exit(0);
});
