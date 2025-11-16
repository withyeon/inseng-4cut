(() => {
  let video;
  let overlayImg;
  let canvas;
  let captureBtn;
  let retryBtn;
  let videoWrapper;
  let controls;
  let statusMessage;
  let qrScreen;
  let qrDisplay;

  window.addEventListener("load", () => {
    console.log("[app] load");
    video = document.getElementById("video-feed");
    overlayImg = document.getElementById("template-overlay");
    canvas = document.getElementById("photo-canvas");
    captureBtn = document.getElementById("capture-btn");
    retryBtn = document.getElementById("retry-btn");
    videoWrapper = document.getElementById("video-wrapper");
    controls = document.getElementById("controls");
    statusMessage = document.getElementById("status-message");
    qrScreen = document.getElementById("qr-screen");
    qrDisplay = document.getElementById("qrcode-display");

    // 오버레이는 로드되기 전까지 감춰 alt 텍스트 노출을 방지
    if (overlayImg) overlayImg.style.display = "none";
    overlayImg.addEventListener("load", () => {
      overlayImg.style.display = "";
    });
    overlayImg.addEventListener("error", () => {
      // 투명한 자리표시자로 대체
      overlayImg.src =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==";
      overlayImg.style.display = "";
    });

    startCamera();
    pingApi();

    captureBtn.addEventListener("click", onCapture);
    retryBtn.addEventListener("click", onRetry);

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
    setStatus("업로드 중...");
    captureBtn.disabled = true;

    const width = video.videoWidth || 1080;
    const height = video.videoHeight || 1440;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");

    // 비디오 미러링 해제하여 실제 방향으로 저장
    ctx.save();
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, width, height);
    ctx.restore();

    // 템플릿 오버레이
    ctx.drawImage(overlayImg, 0, 0, width, height);

    const imageData = canvas.toDataURL("image/png");
    console.log("[capture] imageData length=%s", imageData.length);

    try {
      console.log("[upload] POST /api/upload-photo");
      const url = await uploadPhoto(imageData);
      showQrCode(url);
      setStatus("");
    } catch (e) {
      console.error(e);
      setStatus("업로드 중 오류가 발생했습니다. 다시 시도해 주세요.");
      captureBtn.disabled = false;
    }
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
    captureBtn.disabled = false;
    setStatus("");
  }
})();

