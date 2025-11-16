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

    overlayImg.addEventListener("error", () => {
      // 투명한 자리표시자
      overlayImg.src =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==";
    });

    startCamera();

    captureBtn.addEventListener("click", onCapture);
    retryBtn.addEventListener("click", onRetry);
  });

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      video.srcObject = stream;
      await video.play().catch(() => {});
      setStatus("");
    } catch (err) {
      console.error(err);
      setStatus("카메라 권한을 허용해 주세요.");
      captureBtn.disabled = true;
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
    await ensureVideoReady();
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

    try {
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
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || "Upload failed");
    }
    const data = await res.json();
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

