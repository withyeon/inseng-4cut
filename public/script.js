(() => {
  let video;
  let overlayImg;
  let canvas;
  let captureBtn;
  let retryBtn; // QR 화면 내 '다시 찍기'
  let retakeBtn; // 미리보기 화면의 '다시 찍기'
  let downloadBtn; // 미리보기 화면의 '다운로드'
  let videoWrapper;
  let controls;
  let statusMessage;
  let qrScreen;
  let qrDisplay;
  let countdownEl;

  // 촬영 상태
  let isCapturing = false;
  const NUM_SHOTS = 2;
  const capturedImages = [];
  let finalImageData = null;

  // 템플릿 슬롯(비율 좌표, 하드코딩 값)
  // template.png 기준으로 손으로 측정한 값(필요 시 __setSlots()로 실시간 조정 가능)
  let TEMPLATE_SLOTS_FIXED = [
    { x: 0.085, y: 0.106, w: 0.350, h: 0.800 }, // 왼쪽 슬롯
    { x: 0.570, y: 0.104, w: 0.350, h: 0.800 }, // 오른쪽 슬롯(말풍선 영역 아래까지 넉넉히)
  ];
  const USE_AUTODETECT_SLOTS = false; // 자동 감지 끔(말풍선 등으로 오검출 방지)
  const DEBUG_DRAW_SLOTS = false; // true로 두면 합성 이미지에 슬롯 테두리를 표시
  let detectedSlots = null; // [{x,y,w,h}, ...] normalized
  // 각 슬롯의 사진을 절대 픽셀 단위로 소폭 이동(원본 해상도 기준)
  // +x: 사진이 오른쪽으로 보임, -x: 왼쪽으로 보임, +y: 아래로 보임
  let SLOT_OFFSET_PX = [
    { x: 0, y: 0 },   // 첫 번째 슬롯: 오른쪽으로 소폭 이동
    { x: 0, y: 0 },  // 두 번째 슬롯: 왼쪽으로 소폭 이동
  ];
  // [NEW] 슬롯별 줌 팩터 (1.0 = contain 그대로, <1.0 더 축소/zoom-out, >1.0 확대)
  let PHOTO_ZOOM_FACTOR = [1.0, 1.0];

  window.addEventListener("load", () => {
    console.log("[app] load");
    video = document.getElementById("video-feed");
    overlayImg = document.getElementById("template-overlay");
    canvas = document.getElementById("photo-canvas");
    captureBtn = document.getElementById("capture-btn");
    retryBtn = document.getElementById("retry-btn");
    retakeBtn = document.getElementById("retake-btn");
    downloadBtn = document.getElementById("download-btn");
    videoWrapper = document.getElementById("video-wrapper");
    controls = document.getElementById("controls");
    statusMessage = document.getElementById("status-message");
    qrScreen = document.getElementById("qr-screen");
    qrDisplay = document.getElementById("qrcode-display");
    countdownEl = document.getElementById("countdown");

    // 오버레이는 촬영 중 항상 숨김 (합성에만 사용)
    if (overlayImg) overlayImg.style.display = "none";
    overlayImg.addEventListener("load", () => {
      // 로드되더라도 촬영 화면에서는 계속 숨김
      overlayImg.style.display = "none";
    });
    overlayImg.addEventListener("error", () => {
      // 투명한 자리표시자로 대체
      overlayImg.src =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==";
      overlayImg.style.display = "none";
    });

    startCamera();
    pingApi();

    captureBtn.addEventListener("click", onCapture);
    retryBtn.addEventListener("click", onRetry);
    if (retakeBtn) retakeBtn.addEventListener("click", onRetake);
    if (downloadBtn) downloadBtn.addEventListener("click", onDownload);

    window.addEventListener("unhandledrejection", (e) => {
      console.error("[app] unhandledrejection", e.reason || e);
    });
    window.addEventListener("error", (e) => {
      console.error("[app] window.error", e.message);
    });
  });

  async function startCamera() {
    try {
      console.log("[camera] requesting stream");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      video.srcObject = stream;
      await video.play().catch(() => {});
      console.log("[camera] started width=%s height=%s", video.videoWidth, video.videoHeight);
      setStatus("");
    } catch (err) {
      console.error(err);
      setStatus("카메라 권한을 허용해 주세요. 허용 후 버튼을 다시 누르세요.");
      // 캡처 버튼은 유지해 재요청 가능하게 함
      captureBtn.disabled = false;
    }
  }

  async function pingApi() {
    try {
      const res = await fetch("/api/health", { method: "GET" });
      console.log("[api] /api/health status=%s", res.status);
      if (res.status === 404) {
        setStatus("API(서버리스)가 준비되지 않았습니다. vercel dev를 프로젝트 루트에서 실행하세요.");
      }
    } catch (e) {
      console.warn("[api] /api/health failed", e);
    }
  }

  function setStatus(message) {
    statusMessage.textContent = message || "";
  }

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

  function ensureVideoReady() {
    if (video.videoWidth && video.videoHeight) return Promise.resolve();
    return new Promise((resolve) => {
      video.addEventListener("loadedmetadata", () => resolve(), { once: true });
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

  async function onCapture() {
    if (isCapturing) return;
    // 준비되지 않았으면 스트림을 다시 시도
    if (!video.srcObject) {
      console.log("[capture] no stream, restarting camera");
      await startCamera();
    }
    // 비디오 준비 대기 (최대 3초)
    const ready = await Promise.race([
      ensureVideoReady().then(() => true),
      new Promise((r) => setTimeout(() => r(false), 3000)),
    ]);
    if (!ready || !video.videoWidth) {
      setStatus("카메라가 준비되지 않았습니다. 권한을 허용하고 다시 시도하세요.");
      console.warn("[capture] not ready; videoWidth=%s", video.videoWidth);
      return;
    }
    await ensureTemplateReady();
    captureBtn.disabled = true;
    isCapturing = true;
    setStatus("촬영 준비...");
    await runCountdown(3);

    const width = video.videoWidth || 1080;
    const height = video.videoHeight || 1440;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");

    // 비디오 미러링 해제하여 실제 방향으로 캡처 (템플릿은 나중에 합성)
    ctx.save();
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, width, height);
    ctx.restore();

    const shot = canvas.toDataURL("image/png");
    console.log("[capture] shot length=%s", shot.length);
    capturedImages.push(shot);
    setStatus(`촬영 ${capturedImages.length}/${NUM_SHOTS} 완료`);

    if (capturedImages.length < NUM_SHOTS) {
      // 다음 촬영 대기
      captureBtn.disabled = false;
      isCapturing = false;
      return;
    }

    // 두 장 모두 촬영 → 합성 후 미리보기
    await composeFinalImage();
    enterPreviewMode();
    setStatus("미리보기 확인 후 '다운로드' 또는 '다시 찍기'를 선택하세요.");
    isCapturing = false;
  }

  function enterPreviewMode() {
    // 비디오 영역 숨기고 캔버스 미리보기를 표시
    if (video) video.style.display = "none";
    if (overlayImg) overlayImg.style.display = "none";
    canvas.style.display = "block";
    // 버튼 토글
    captureBtn.style.display = "none";
    if (downloadBtn) downloadBtn.style.display = "";
    if (retakeBtn) retakeBtn.style.display = "";
  }

  function exitPreviewToCamera() {
    canvas.style.display = "none";
    if (video) video.style.display = "";
    // 촬영 화면에서는 프레임 항상 숨김
    if (overlayImg) overlayImg.style.display = "none";
    captureBtn.style.display = "";
    if (downloadBtn) downloadBtn.style.display = "none";
    if (retakeBtn) retakeBtn.style.display = "none";
  }

  async function uploadPhoto(imageData) {
    const res = await fetch("/api/upload-photo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: imageData }),
    });
    console.log("[upload] response status=%s", res.status);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.warn("[upload] error body=", body);
      throw new Error(body.message || "Upload failed");
    }
    const data = await res.json();
    console.log("[upload] ok url=%s", data && data.url);
    if (!data || !data.url) throw new Error("Invalid response");
    return data.url;
  }

  async function onDownload() {
    if (!finalImageData) {
      setStatus("먼저 사진을 촬영해 주세요.");
      return;
    }
    try {
      setStatus("업로드 중...");
      const url = await uploadPhoto(finalImageData);
      setStatus("");
      showQrCode(url);
    } catch (e) {
      console.error(e);
      setStatus("업로드 중 오류가 발생했습니다. 다시 시도해 주세요.");
    }
  }

  function showQrCode(url) {
    if (!qrScreen || !qrDisplay) return;
    videoWrapper.style.display = "none";
    controls.style.display = "none";
    qrScreen.style.display = "block";
    qrScreen.setAttribute("aria-hidden", "false");

    qrDisplay.innerHTML = "";
    new QRCode(qrDisplay, {
      text: url,
      width: 260,
      height: 260,
      colorDark: "#000000",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.M,
    });
  }

  function onRetry() {
    if (!qrScreen) return;
    qrScreen.style.display = "none";
    qrScreen.setAttribute("aria-hidden", "true");
    qrDisplay.innerHTML = "";
    videoWrapper.style.display = "";
    controls.style.display = "";
    // 촬영 재개 준비
    isCapturing = false;
    captureBtn.disabled = false;
    if (overlayImg) overlayImg.style.display = "none";
    if (!video.srcObject) {
      startCamera();
    }
    setStatus("");
  }

  function onRetake() {
    // 미리보기 → 카메라로 복귀
    capturedImages.length = 0;
    finalImageData = null;
    isCapturing = false;
    exitPreviewToCamera();
    captureBtn.disabled = false;
    if (!video.srcObject) {
      startCamera();
    }
    setStatus("다시 촬영해 주세요.");
  }

  // 합성 도우미
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  // [NEW] contain 스케일 + 슬롯별 줌 팩터 + 오프셋 이동 적용
  function drawPhotoInSlot(ctx, img, dx, dy, dw, dh, offsetX = 0, offsetY = 0, slotIndex = 0) {
    // 1) contain 스케일
    const baseScale = Math.min(dw / img.width, dh / img.height);
    // 2) 줌 팩터 적용
    const zoom = PHOTO_ZOOM_FACTOR[slotIndex] != null ? PHOTO_ZOOM_FACTOR[slotIndex] : 1.0;
    const scale = baseScale * zoom;
    const rW = Math.ceil(img.width * scale);
    const rH = Math.ceil(img.height * scale);
    // 3) 중앙 정렬 후 오프셋 적용
    const baseX = dx + (dw - rW) / 2;
    const baseY = dy + (dh - rH) / 2;
    const posX = Math.round(baseX + offsetX);
    const posY = Math.round(baseY + offsetY);
    // 4) 슬롯 경계로 클리핑 후 그리기
    ctx.save();
    ctx.beginPath();
    ctx.rect(dx, dy, dw, dh);
    ctx.clip();
    ctx.drawImage(img, posX, posY, rW, rH);
    ctx.restore();
  }

  async function composeFinalImage() {
    await ensureTemplateReady();
    // 투명 구멍 자동 감지(1회)
    if (!detectedSlots) {
      try {
        detectedSlots = detectTransparentSlots(overlayImg);
        console.log("[slots] autodetected:", detectedSlots);
      } catch (e) {
        console.warn("[slots] autodetect failed, using defaults", e);
        detectedSlots = null;
      }
    }
    const outW = overlayImg.naturalWidth || video.videoWidth || 1080;
    const outH = overlayImg.naturalHeight || video.videoHeight || 1440;
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, outW, outH);

    // 슬롯에 사진 배치
    const imgs = await Promise.all(capturedImages.slice(0, NUM_SHOTS).map(loadImage));
    const slotsToUse = USE_AUTODETECT_SLOTS && detectedSlots && detectedSlots.length >= NUM_SHOTS
      ? detectedSlots
      : TEMPLATE_SLOTS_FIXED;
    slotsToUse.slice(0, NUM_SHOTS).forEach((slot, i) => {
      const dx = Math.round(slot.x * outW);
      const dy = Math.round(slot.y * outH);
      const dw = Math.round(slot.w * outW);
      const dh = Math.round(slot.h * outH);
      const off = SLOT_OFFSET_PX[i] || { x: 0, y: 0 };
      drawPhotoInSlot(ctx, imgs[i], dx, dy, dw, dh, off.x, off.y, i);
      if (DEBUG_DRAW_SLOTS) {
        ctx.save();
        ctx.strokeStyle = "rgba(255,0,0,0.85)";
        ctx.lineWidth = Math.max(2, Math.round(outW * 0.004));
        ctx.strokeRect(dx, dy, dw, dh);
        ctx.restore();
      }
    });

    // 템플릿을 맨 위에 얹기(투명 PNG 전제)
    ctx.drawImage(overlayImg, 0, 0, outW, outH);

    finalImageData = canvas.toDataURL("image/png");
    console.log("[compose] final length=%s", finalImageData.length);
  }

  // 투명 슬롯 자동 감지: 템플릿 이미지의 알파 채널을 스캔하여 2개의 큰 투명 영역을 찾아 반환
  // 반환: [{x,y,w,h}, ...] (0~1 정규화 좌표)
  function detectTransparentSlots(img) {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) throw new Error("overlay natural size unavailable");
    const off = document.createElement("canvas");
    off.width = w;
    off.height = h;
    const ctx = off.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;

    const stepX = Math.max(1, Math.floor(w / 600)); // 성능을 위한 스텝
    const stepY = Math.max(1, Math.floor(h / 600));
    const THRESH = 10; // 투명 판정 알파

    // 각 열별 투명 픽셀 비율
    const colRatio = new Array(w).fill(0);
    for (let x = 0; x < w; x += stepX) {
      let transparent = 0;
      let total = 0;
      for (let y = 0; y < h; y += stepY) {
        const idx = (y * w + x) * 4 + 3; // alpha idx
        const a = data[idx];
        total++;
        if (a <= THRESH) transparent++;
      }
      colRatio[x] = transparent / total;
    }

    // 투명 비율이 높은 컬럼을 세그먼트로 그룹화
    const MIN_COL_RATIO = 0.15; // 이 이상이면 해당 컬럼에 구멍이 일부라도 있다고 간주
    const segments = [];
    let segStart = null;
    for (let x = 0; x < w; x += stepX) {
      if (colRatio[x] >= MIN_COL_RATIO) {
        if (segStart === null) segStart = x;
      } else if (segStart !== null) {
        segments.push([segStart, x - stepX]);
        segStart = null;
      }
    }
    if (segStart !== null) segments.push([segStart, w - 1]);

    // 가장 넓은 2개 세그먼트를 선택(왼쪽→오른쪽)
    segments.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
    const pick = segments.slice(0, 2).sort((a, b) => a[0] - b[0]);
    if (pick.length === 0) throw new Error("no transparent segments found");

    // 각 세그먼트에서 상하 경계를 찾기
    // 요구사항: 안전마진 없이, 모서리가 1px 정도 겹치도록 확장
    const overlapPx = 1; // 경계를 바깥으로 확장하는 픽셀 수
    const slots = pick.map(([sx, ex]) => {
      // 상하: 각 행의 투명 비율을 계산하여 최대 구간을 잡는다
      const rowRatio = new Array(h).fill(0);
      for (let y = 0; y < h; y += stepY) {
        let transparent = 0;
        let total = 0;
        for (let x = sx; x <= ex; x += stepX) {
          const idx = (y * w + x) * 4 + 3;
          const a = data[idx];
          total++;
          if (a <= THRESH) transparent++;
        }
        rowRatio[y] = transparent / total;
      }
      const MIN_ROW_RATIO = 0.6; // 이 이상이면 그 행은 대부분 구멍
      // top
      let top = 0;
      for (let y = 0; y < h; y += stepY) {
        if (rowRatio[y] >= MIN_ROW_RATIO) {
          top = y;
          break;
        }
      }
      // bottom
      let bottom = h - 1;
      for (let y = h - 1; y >= 0; y -= stepY) {
        if (rowRatio[y] >= MIN_ROW_RATIO) {
          bottom = y;
          break;
        }
      }
      // 경계 확장(겹치도록 1px 바깥으로)
      const left = Math.max(0, sx - overlapPx);
      const up = Math.max(0, top - overlapPx);
      const right = Math.min(w, ex + overlapPx);
      const down = Math.min(h, bottom + overlapPx);
      const dx = left;
      const dy = up;
      const dw = Math.max(1, right - left);
      const dh = Math.max(1, down - up);
      return {
        x: dx / w,
        y: dy / h,
        w: dw / w,
        h: dh / h,
      };
    });
    return slots;
  }

  // 콘솔에서 즉시 조정 가능하도록 헬퍼 제공
  // 사용 예: __setSlots([{x:0.086,y:0.105,w:0.333,h:0.772},{...}]); onRetake(); // 재촬영
  window.__setSlots = async (slots) => {
    if (!Array.isArray(slots) || slots.length < 2) {
      console.warn("[slots] 잘못된 형식입니다. 예) [{x:0.08,y:0.1,w:0.33,h:0.77},{...}]");
      return;
    }
    TEMPLATE_SLOTS_FIXED = slots;
    console.log("[slots] updated", TEMPLATE_SLOTS_FIXED);
    // 이미 두 장 촬영이 끝난 상태라면 즉시 미리보기 재합성
    try {
      if (capturedImages.length >= NUM_SHOTS) {
        setStatus("미리보기 갱신 중(슬롯)...");
        await composeFinalImage();
        setStatus("미리보기 갱신 완료");
      }
    } catch (e) {
      console.warn("[slots] recompose failed", e);
    }
  };
  window.__getSlots = () => {
    return TEMPLATE_SLOTS_FIXED;
  };
  // 오프셋(px) 런타임 조정
  window.__setOffset = async (arr) => {
    if (!Array.isArray(arr) || arr.length < 2) {
      console.warn("오류: [{x:0, y:0}, {x:0, y:0}] 형식으로 입력하세요.");
      return;
    }
    SLOT_OFFSET_PX = arr;
    console.log("[offset] 오프셋 업데이트(px):", SLOT_OFFSET_PX);
    // 이미 두 장 촬영이 끝난 상태라면 즉시 미리보기 재합성
    try {
      if (capturedImages.length >= NUM_SHOTS) {
        console.log("[offset] 미리보기를 다시 합성합니다...");
        setStatus("미리보기 갱신 중...");
        await composeFinalImage();
        setStatus("미리보기 갱신 완료");
        console.log("[offset] 미리보기 갱신 완료.");
      } else {
        console.log("[offset] 먼저 사진을 2장 촬영하세요.");
      }
    } catch (e) {
      console.warn("[offset] recompose failed", e);
    }
  };
  window.__getOffset = () => SLOT_OFFSET_PX;
  // [NEW] 줌 런타임 조정
  window.__setZoom = async (arr) => {
    if (!Array.isArray(arr) || arr.length < 2) {
      console.warn("오류: [zoom1, zoom2] (예: [0.8, 0.8]) 형식으로 입력하세요.");
      return;
    }
    PHOTO_ZOOM_FACTOR = arr;
    console.log("[zoom] 줌 팩터 업데이트:", PHOTO_ZOOM_FACTOR);
    try {
      if (capturedImages.length >= NUM_SHOTS) {
        console.log("[zoom] 미리보기를 다시 합성합니다...");
        setStatus("미리보기 갱신 중...");
        await composeFinalImage();
        setStatus("미리보기 갱신 완료");
        console.log("[zoom] 미리보기 갱신 완료.");
      } else {
        console.log("[zoom] 먼저 사진을 2장 촬영하세요.");
      }
    } catch (e) {
      console.warn("[zoom] recompose failed", e);
    }
  };
  window.__getZoom = () => PHOTO_ZOOM_FACTOR;
})();

