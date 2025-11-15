(() => {
  let video;
  let overlayImg;
  let canvas;
  let captureBtn;
  let emailForm;
  let photoPreview;
  let emailInput;
  let sendBtn;
  let retryBtn;
  let videoWrapper;
  let statusMessage;
  let countdownEl;

  let capturedImageData = null;
  let capturedImages = []; // dataURL list
  let isCapturing = false;
  const NUM_SHOTS = 2;
  const CAPTURE_TARGET_RATIO = 3 / 4; // width : height = 3 : 4 (세로)
  const CAPTURE_OUT_WIDTH = 1080;
  const CAPTURE_OUT_HEIGHT = Math.round(CAPTURE_OUT_WIDTH / CAPTURE_TARGET_RATIO); // 1440
  // 슬롯 좌표는 템플릿 이미지(overlay)의 가로/세로를 1로 보았을 때의 비율 값입니다.
  // 필요 시 아래 숫자만 조정하면 됩니다. (x, y, w, h: 0~1)
  const TEMPLATE_SLOTS = [
    // 화면 기준 비율 좌표 (대략 왼쪽/오른쪽 세로 직사각형)
    { x: 0.075, y: 0.12, w: 0.34, h: 0.72 }, // 왼쪽
    { x: 0.545, y: 0.12, w: 0.34, h: 0.72 }, // 오른쪽
  ];
  // 최종 합성 시 템플릿을 맨 위에 다시 얹을지 여부
  // 템플릿의 네모가 '진짜 투명'일 때만 true 권장. (체커보드 무늬는 투명 아님)
  const DRAW_TEMPLATE_ON_FINAL = true;
  // 슬롯 위치 확인용 디버그 테두리
  const DEBUG_DRAW_SLOTS = false;
  // 템플릿 투명 여부 자동 진단 로그
  const DEBUG_CHECK_TRANSPARENCY = true;

  const TRANSPARENT_PX =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==";

  window.addEventListener("load", () => {
    video = document.getElementById("video-feed");
    overlayImg = document.getElementById("template-overlay");
    canvas = document.getElementById("photo-canvas");
    captureBtn = document.getElementById("capture-btn");
    emailForm = document.getElementById("email-form");
    photoPreview = document.getElementById("photo-preview");
    emailInput = document.getElementById("email-input");
    sendBtn = document.getElementById("send-btn");
    retryBtn = document.getElementById("retry-btn");
    videoWrapper = document.getElementById("video-wrapper");
    statusMessage = document.getElementById("status-message");
    countdownEl = document.getElementById("countdown");

    // If the overlay fails to load (placeholder or missing), fall back to transparent pixel
    overlayImg.addEventListener("error", () => {
      overlayImg.src = TRANSPARENT_PX;
    });

    // 촬영 중 가림 방지를 위해 초기에는 템플릿을 숨겨둡니다
    if (overlayImg) overlayImg.style.visibility = "hidden";

    // 템플릿 이미지의 투명 여부를 로드 완료 시점에 점검
    if (overlayImg && overlayImg.complete && overlayImg.naturalWidth > 0) {
      if (DEBUG_CHECK_TRANSPARENCY) {
        checkTemplateTransparencyAndLog();
      }
    } else {
      overlayImg.addEventListener(
        "load",
        () => {
          if (DEBUG_CHECK_TRANSPARENCY) {
            checkTemplateTransparencyAndLog();
          }
        },
        { once: true }
      );
    }

    startCamera();

    captureBtn.addEventListener("click", onCapture);
    sendBtn.addEventListener("click", onSendEmail);
    retryBtn.addEventListener("click", onRetry);
  });

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: CAPTURE_OUT_WIDTH },
          height: { ideal: CAPTURE_OUT_HEIGHT },
          aspectRatio: { ideal: CAPTURE_TARGET_RATIO },
        },
        audio: false,
      });
      video.srcObject = stream;
      // iOS Safari sometimes needs an explicit play
      await video.play().catch(() => {});
      setStatus("");
    } catch (err) {
      console.error("Camera error:", err);
      setStatus("카메라에 접근할 수 없습니다. 브라우저에서 카메라 권한을 허용해 주세요.");
      captureBtn.disabled = true;
    }
  }

  function ensureVideoReady() {
    if (video.videoWidth && video.videoHeight) return Promise.resolve();
    return new Promise((resolve) => {
      video.addEventListener(
        "loadedmetadata",
        () => {
          resolve();
        },
        { once: true }
      );
    });
  }

  async function onCapture() {
    if (isCapturing) return;
    await ensureVideoReady();
    isCapturing = true;
    captureBtn.disabled = true;
    try {
      // 촬영 중에는 템플릿을 숨김 유지
      if (overlayImg) overlayImg.style.visibility = "hidden";
      await runCountdown(3);
      const shot = await captureFramePortrait();
      capturedImages.push(shot);

      if (capturedImages.length < NUM_SHOTS) {
        setStatus(`촬영 ${capturedImages.length}/${NUM_SHOTS} 완료. 다시 버튼을 눌러 다음 촬영을 진행하세요.`);
        captureBtn.disabled = false;
        isCapturing = false;
        return;
      }

      // 모든 촬영이 끝나면 합성
      await composeFinalImage();

      // UI 전환
      videoWrapper.style.display = "none";
      captureBtn.style.display = "none";
      emailForm.style.display = "block";
      setStatus("촬영이 완료되었습니다. 이메일 주소 입력 후 전송하세요.");
    } catch (e) {
      console.error(e);
      setStatus("촬영 중 오류가 발생했습니다. 다시 시도해 주세요.");
    } finally {
      isCapturing = false;
      captureBtn.disabled = false;
    }
  }

  function isValidEmail(email) {
    // Simple validation
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  async function onSendEmail() {
    if (!capturedImageData) {
      setStatus("먼저 사진을 촬영해 주세요.");
      return;
    }
    const email = (emailInput.value || "").trim();
    if (!isValidEmail(email)) {
      setStatus("올바른 이메일 주소를 입력해 주세요.");
      emailInput.focus();
      return;
    }

    sendBtn.disabled = true;
    setStatus("전송 중...");

    try {
      const res = await fetch("/send-photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, image: capturedImageData }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Request failed");
      }

      setStatus("전송 완료! 이메일을 확인해 주세요.");
    } catch (err) {
      console.error(err);
      setStatus("전송 중 오류가 발생했습니다. 다시 시도해 주세요.");
    } finally {
      sendBtn.disabled = false;
    }
  }

  function onRetry() {
    // Reset UI back to camera
    emailForm.style.display = "none";
    videoWrapper.style.display = "";
    captureBtn.style.display = "";
    emailInput.value = "";
    capturedImageData = null;
    capturedImages = [];
    setStatus("");
  }

  function setStatus(message) {
    statusMessage.textContent = message || "";
  }

  // ===== Helper functions =====
  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function runCountdown(seconds) {
    if (!countdownEl) return;
    for (let s = seconds; s > 0; s--) {
      countdownEl.textContent = String(s);
      await sleep(1000);
    }
    countdownEl.textContent = "";
  }

  async function captureFrame() {
    const width = video.videoWidth || 1080;
    const height = video.videoHeight || 1440;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");

    // 화면 미러링 보정하여 카메라 프레임 캡처
    ctx.save();
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, width, height);
    ctx.restore();

    return canvas.toDataURL("image/png");
  }

  // 세로(3:4) 비율로 중앙 크롭하여 캡처
  async function captureFramePortrait() {
    const vW = video.videoWidth || CAPTURE_OUT_WIDTH;
    const vH = video.videoHeight || CAPTURE_OUT_HEIGHT;
    const targetRatio = CAPTURE_TARGET_RATIO;
    const sourceRatio = vW / vH;

    let sx = 0, sy = 0, sw = vW, sh = vH;
    if (sourceRatio > targetRatio) {
      // 원본이 더 가로로 넓음 → 가로를 크롭
      sw = Math.round(vH * targetRatio);
      sx = Math.round((vW - sw) / 2);
    } else if (sourceRatio < targetRatio) {
      // 원본이 더 세로로 큼 → 세로를 크롭
      sh = Math.round(vW / targetRatio);
      sy = Math.round((vH - sh) / 2);
    }

    const outW = CAPTURE_OUT_WIDTH;
    const outH = CAPTURE_OUT_HEIGHT;
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    ctx.save();
    // 미러링(셀피 자연스러운 연출)
    ctx.translate(outW, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, outW, outH);
    ctx.restore();
    return canvas.toDataURL("image/png");
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function ensureTemplateReady() {
    if (overlayImg && overlayImg.naturalWidth && overlayImg.naturalHeight) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      overlayImg.addEventListener("load", () => resolve(), { once: true });
    });
  }

  function drawImageCover(ctx, img, dx, dy, dw, dh) {
    const sRatio = img.width / img.height;
    const dRatio = dw / dh;
    let sx = 0;
    let sy = 0;
    let sw = img.width;
    let sh = img.height;
    if (sRatio > dRatio) {
      // source wider -> crop width
      sh = img.height;
      sw = sh * dRatio;
      sx = (img.width - sw) / 2;
    } else {
      // source taller -> crop height
      sw = img.width;
      sh = sw / dRatio;
      sy = (img.height - sh) / 2;
    }
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  }

  async function composeFinalImage() {
    await ensureTemplateReady();
    // 합성 캔버스 크기: 템플릿 기준(없을 경우 비디오 크기)
    const outW = overlayImg.naturalWidth || video.videoWidth || 1080;
    const outH = overlayImg.naturalHeight || video.videoHeight || 1440;
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, outW, outH);

    // 1) 비투명 템플릿인 경우에는 먼저 템플릿을 그립니다.
    if (!DRAW_TEMPLATE_ON_FINAL) {
      ctx.drawImage(overlayImg, 0, 0, outW, outH);
    }

    // 2) 슬롯에 사진 배치
    const imgs = await Promise.all(capturedImages.slice(0, NUM_SHOTS).map(loadImage));
    TEMPLATE_SLOTS.slice(0, NUM_SHOTS).forEach((slot, i) => {
      const dx = Math.round(slot.x * outW);
      const dy = Math.round(slot.y * outH);
      const dw = Math.round(slot.w * outW);
      const dh = Math.round(slot.h * outH);
      drawImageCover(ctx, imgs[i], dx, dy, dw, dh);
      if (DEBUG_DRAW_SLOTS) {
        ctx.save();
        ctx.strokeStyle = "rgba(255,0,0,0.8)";
        ctx.lineWidth = Math.max(2, Math.round(outW * 0.004));
        ctx.strokeRect(dx, dy, dw, dh);
        ctx.restore();
      }
    });

    // 3) 투명 템플릿이면 맨 위에 얹어 최종 프레임을 구성합니다.
    if (DRAW_TEMPLATE_ON_FINAL && overlayImg) {
      ctx.drawImage(overlayImg, 0, 0, outW, outH);
    }

    capturedImageData = canvas.toDataURL("image/png");
    photoPreview.src = capturedImageData;
  }

  // 템플릿 투명 영역(슬롯) 여부를 샘플링해 콘솔에 로깅
  async function checkTemplateTransparencyAndLog() {
    try {
      await ensureTemplateReady();
      const width = overlayImg.naturalWidth;
      const height = overlayImg.naturalHeight;
      const offscreen = document.createElement("canvas");
      offscreen.width = width;
      offscreen.height = height;
      const ctx = offscreen.getContext("2d");
      ctx.drawImage(overlayImg, 0, 0, width, height);

      function alphaAt(px, py) {
        const data = ctx.getImageData(px, py, 1, 1).data;
        return data[3]; // 0..255
      }

      const results = TEMPLATE_SLOTS.map((slot, idx) => {
        const innerMargin = 0.12; // 슬롯 가장자리 앤티앨리어싱 영향 줄이기 위한 내부 여백
        const samples = [];
        for (let ix = 1; ix <= 3; ix++) {
          for (let iy = 1; iy <= 3; iy++) {
            const nx =
              slot.x +
              slot.w * innerMargin +
              (slot.w * (1 - innerMargin * 2)) * (ix / 4);
            const ny =
              slot.y +
              slot.h * innerMargin +
              (slot.h * (1 - innerMargin * 2)) * (iy / 4);
            const px = Math.min(width - 1, Math.max(0, Math.round(nx * width)));
            const py = Math.min(height - 1, Math.max(0, Math.round(ny * height)));
            samples.push(alphaAt(px, py));
          }
        }
        const avg = Math.round(
          samples.reduce((a, b) => a + b, 0) / samples.length
        );
        const minA = Math.min(...samples);
        // 완전 투명(0)에 가깝다고 판단하는 임계값
        const THRESHOLD = 15;
        const isTransparent = avg <= THRESHOLD && minA <= THRESHOLD;
        console.log(
          `[Template Transparency] slot ${idx + 1}: avgAlpha=${avg}, minAlpha=${minA} -> transparent=${isTransparent}`
        );
        return isTransparent;
      });
      const overall = results.every(Boolean);
      console.log(
        `[Template Transparency] overall: ${overall ? "OK (holes are transparent)" : "NOT TRANSPARENT (holes opaque)"}`
      );
    } catch (e) {
      console.warn("[Template Transparency] check failed:", e);
    }
  }
  // 디버그: 콘솔에서 수동 실행 가능하도록 노출
  window.__checkTemplateTransparency = checkTemplateTransparencyAndLog;
})();


