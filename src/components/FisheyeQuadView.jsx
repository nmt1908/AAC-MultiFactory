import React, { useEffect, useRef } from "react";

// Config cố định như bạn yêu cầu
const FISHEYE_CONFIG = {
  fov: 100,      // degrees
  yaw: 1,        // degrees
  pitch: -64,    // degrees
  roll: 0,       // degrees
  zoom: 1.0,
  lensStrength: 1.8,
};

// Danh sách camera không xử lý fisheye
const FISHEYE_EXCEPT_CODES = ["B2006_WR", "B2009_WR","F2005_WR","F4013_WR_G","F4012_WR","F4014_WR_G","B3010_WR","B2007_G_WR","F2004"];

// Kích thước logic của từng view (canvas sẽ scale theo CSS)
const VIEW_WIDTH = 400;
const VIEW_HEIGHT = 300;

// ======= math: giống app.js =======

function fisheyeToRectPixel(
  x,
  y,
  width,
  height,
  yaw,
  pitch,
  roll,
  fov,
  zoom,
  lensStrength,
  srcW,
  srcH
) {
  const nx = (2 * x / width - 1) * zoom;
  const ny = (2 * y / height - 1) * zoom;

  const f = 1 / Math.tan(fov / 2);
  let dx = nx;
  let dy = ny;
  let dz = f;

  const len = Math.hypot(dx, dy, dz);
  dx /= len;
  dy /= len;
  dz /= len;

  // roll (Z)
  if (roll !== 0) {
    const cosR = Math.cos(roll);
    const sinR = Math.sin(roll);
    const tx = dx * cosR - dy * sinR;
    const ty = dx * sinR + dy * cosR;
    dx = tx;
    dy = ty;
  }

  // pitch (X)
  if (pitch !== 0) {
    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);
    const ty = dy * cosP - dz * sinP;
    const tz = dy * sinP + dz * cosP;
    dy = ty;
    dz = tz;
  }

  // yaw (Y)
  if (yaw !== 0) {
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const tx = dx * cosY + dz * sinY;
    const tz = -dx * sinY + dz * cosY;
    dx = tx;
    dz = tz;
  }

  const theta = Math.atan2(Math.hypot(dx, dz), dy);
  const phi = Math.atan2(dz, dx);

  const r = (theta / Math.PI) * lensStrength;

  const srcX = Math.floor(((Math.cos(phi) * r) + 1) * srcW / 2);
  const srcY = Math.floor(((Math.sin(phi) * r) + 1) * srcH / 2);

  if (srcX >= 0 && srcX < srcW && srcY >= 0 && srcY < srcH) {
    return { x: srcX, y: srcY };
  }

  return null;
}

function renderViewToCanvas(
  canvas,
  srcData,
  srcW,
  srcH,
  baseYawDeg,
  basePitchDeg,
  cfg
) {
  if (!canvas || !srcData) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;

  const imageData = ctx.createImageData(width, height);
  const dst = imageData.data;

  const fov = (cfg.fov * Math.PI) / 180;
  const yaw = ((baseYawDeg + cfg.yaw) * Math.PI) / 180;
  const pitch = ((basePitchDeg + cfg.pitch) * Math.PI) / 180;
  const roll = (cfg.roll * Math.PI) / 180;
  const zoom = cfg.zoom;
  const lensStrength = cfg.lensStrength;

  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const mapped = fisheyeToRectPixel(
        i,
        j,
        width,
        height,
        yaw,
        pitch,
        roll,
        fov,
        zoom,
        lensStrength,
        srcW,
        srcH
      );

      const dstIdx = (j * width + i) * 4;

      if (!mapped) {
        dst[dstIdx] = 0;
        dst[dstIdx + 1] = 0;
        dst[dstIdx + 2] = 0;
        dst[dstIdx + 3] = 255;
        continue;
      }

      const srcIdx = (mapped.y * srcW + mapped.x) * 4;
      dst[dstIdx] = srcData[srcIdx];
      dst[dstIdx + 1] = srcData[srcIdx + 1];
      dst[dstIdx + 2] = srcData[srcIdx + 2];
      dst[dstIdx + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

// ======= Component chính =======

/**
 * FisheyeQuadView
 *  - snapshotUrl: URL ảnh fisheye từ camera (qua proxy snapshot)
 *  - cameraCode: mã camera (để xử lý ngoại lệ như B2006_WR, B2009_WR)
 */
const FisheyeQuadView = ({ snapshotUrl, cameraCode, className = "" }) => {
  const frontRef = useRef(null);
  const rightRef = useRef(null);
  const backRef = useRef(null);
  const leftRef = useRef(null);

  useEffect(() => {
    // nếu không có ảnh hoặc nằm trong danh sách ngoại lệ thì không render fisheye
    if (!snapshotUrl) return;
    if (cameraCode && FISHEYE_EXCEPT_CODES.includes(cameraCode)) return;

    const img = new Image();
    img.crossOrigin = "anonymous"; // cần backend set CORS nếu khác origin

    img.onload = () => {
      const srcW = img.width;
      const srcH = img.height;

      const tmpCanvas = document.createElement("canvas");
      tmpCanvas.width = srcW;
      tmpCanvas.height = srcH;
      const tmpCtx = tmpCanvas.getContext("2d");
      if (!tmpCtx) return;

      tmpCtx.drawImage(img, 0, 0);
      const srcImageData = tmpCtx.getImageData(0, 0, srcW, srcH);
      const srcData = srcImageData.data;

      const cfg = FISHEYE_CONFIG;

      const views = [
        { ref: frontRef.current, yaw: 0, pitch: 0 },
        { ref: rightRef.current, yaw: 90, pitch: 0 },
        { ref: backRef.current, yaw: 180, pitch: 0 },
        { ref: leftRef.current, yaw: -90, pitch: 0 },
      ];

      views.forEach(({ ref, yaw, pitch }) => {
        if (!ref) return;
        renderViewToCanvas(ref, srcData, srcW, srcH, yaw, pitch, cfg);
      });
    };

    img.onerror = () => {
      console.warn("Fisheye snapshot load error:", snapshotUrl);
    };

    img.src = snapshotUrl;
  }, [snapshotUrl, cameraCode]);

  // Nếu nằm trong danh sách ngoại lệ thì hiển thị ảnh raw
  if (cameraCode && FISHEYE_EXCEPT_CODES.includes(cameraCode)) {
    return (
      <div
        className={
          "w-full h-full bg-black flex items-center justify-center " +
          className
        }
      >
        <img
          src={snapshotUrl}
          alt={`Camera ${cameraCode || ""}`}
          className="max-w-full max-h-full object-contain"
        />
      </div>
    );
  }

  // Còn lại thì quad-view bằng canvas
  return (
    <div
      className={
        "w-full h-full grid grid-cols-2 grid-rows-2 gap-[1px] bg-black " +
        className
      }
    >
      <canvas
        ref={frontRef}
        width={VIEW_WIDTH}
        height={VIEW_HEIGHT}
        className="w-full h-full bg-black"
      />
      <canvas
        ref={rightRef}
        width={VIEW_WIDTH}
        height={VIEW_HEIGHT}
        className="w-full h-full bg-black"
      />
      <canvas
        ref={backRef}
        width={VIEW_WIDTH}
        height={VIEW_HEIGHT}
        className="w-full h-full bg-black"
      />
      <canvas
        ref={leftRef}
        width={VIEW_WIDTH}
        height={VIEW_HEIGHT}
        className="w-full h-full bg-black"
      />
    </div>
  );
};

export default FisheyeQuadView;
