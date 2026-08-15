(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const screens = [...document.querySelectorAll(".screen")];

  const state = {
    screen: "welcome",
    guestName: "",
    sanitizedGuestName: "",
    sessionId: "",
    photos: [null, null],
    currentPhoto: 0,
    stream: null,
    finalDataUrl: "",
    finalBlob: null,
    finalFilename: "",
    uploadTimer: null,
    uploadAttempts: 0,
    cameraFacingMode: "user",
    orientation: "portrait"
  };

  const screenNames = {
    welcome: "welcome",
    name: "name",
    camera: "camera",
    photoPreview: "photoPreview",
    generating: "generating",
    final: "final"
  };

  function showScreen(name) {
    state.screen = name;
    screens.forEach((screen) => {
      screen.classList.toggle("active", screen.dataset.screen === screenNames[name]);
    });
    if (name !== "camera") stopCamera();
  }

  function sanitizeFilename(value) {
    return value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9\s_-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-_]+|[-_]+$/g, "")
      .slice(0, 60) || "Guest-Name";
  }

  function timeStamp(date = new Date()) {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Makassar",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).format(date).replace(/:/g, "");
  }

  function localSessionId() {
    const d = new Date();
    const pad = (n, size = 2) => String(n).padStart(size, "0");
    return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-LOCAL`;
  }

  function toast(message) {
    const el = $("toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove("show"), 3000);
  }

  function setNameError(message = "") {
    $("nameError").textContent = message;
  }

  function setPhotoProgress(index) {
    $("photoCounter").textContent = `PHOTO ${index + 1} / 2`;
    $("dot1").classList.toggle("active", index >= 0);
    $("dot2").classList.toggle("active", index >= 1);
    $("cameraInstruction").textContent = index === 0
      ? "Get ready! 😊"
      : "One more for the memories.";
  }

  async function createServerSession() {
    if (!CONFIG.backendUrl) {
      state.sessionId = localSessionId();
      return;
    }

    try {
      const data = await jsonp(`${CONFIG.backendUrl}?action=createSession`);
      if (!data || !data.ok || !data.sessionId) throw new Error("Session could not be created.");
      state.sessionId = data.sessionId;
    } catch (error) {
      // Do not invent a server session. The final image remains downloadable locally,
      // but a Drive retry requires a real server-issued session.
      state.sessionId = "";
      toast("We’ll keep your photo here. The album connection needs another try.");
    }
  }

  function jsonp(url, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const callbackName = `__pb_jsonp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const script = document.createElement("script");
      let settled = false;

      const cleanup = () => {
        clearTimeout(timer);
        script.remove();
        try { delete window[callbackName]; } catch (_) {}
      };

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error("Backend request timed out."));
      }, timeoutMs);

      window[callbackName] = (data) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(data);
      };

      const joiner = url.includes("?") ? "&" : "?";
      script.src = `${url}${joiner}callback=${encodeURIComponent(callbackName)}&_=${Date.now()}`;
      script.onerror = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error("Backend request failed."));
      };
      document.head.appendChild(script);
    });
  }

  function currentOrientation() {
    const angle = Number(window.screen?.orientation?.angle || 0);
    if (angle === 90 || angle === 270) return "landscape";
    return window.innerWidth > window.innerHeight ? "landscape" : "portrait";
  }

  function updateCameraOrientation() {
    const orientation = currentOrientation();
    state.orientation = orientation;
    document.querySelector(".camera-screen")?.setAttribute("data-orientation", orientation);
    const pill = $("orientationPill");
    if (pill) pill.textContent = `Auto · ${orientation === "portrait" ? "Portrait" : "Landscape"}`;
  }

  async function startCamera(facingMode = state.cameraFacingMode) {
    $("cameraError").hidden = true;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera API unavailable.");
      }

      stopCamera();
      const baseVideo = {
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      };

      try {
        state.stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { ...baseVideo, facingMode: { exact: facingMode } }
        });
      } catch (exactError) {
        // Some browsers/devices do not accept exact facingMode constraints.
        state.stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { ...baseVideo, facingMode: { ideal: facingMode } }
        });
      }

      const video = $("cameraVideo");
      video.srcObject = state.stream;
      // Keep the live preview natural for both front and rear cameras.
      // Do not mirror either feed; this matches a conventional camera-app view.
      video.classList.remove("mirror");
      await video.play();
      updateCameraOrientation();
      setPhotoProgress(state.currentPhoto);
      showScreen("camera");
    } catch (error) {
      $("cameraError").hidden = false;
      showScreen("camera");
      console.warn(error);
    }
  }

  function stopCamera() {
    if (!state.stream) return;
    state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
    $("cameraVideo").srcObject = null;
  }

  function captureVideoFrame() {
    const video = $("cameraVideo");
    // Match the phone's current orientation so the captured frame follows the UI.
    const targetAspect = state.orientation === "landscape" ? 4 / 3 : 3 / 4;
    const sourceW = video.videoWidth;
    const sourceH = video.videoHeight;
    if (!sourceW || !sourceH) throw new Error("Camera is not ready.");

    let sx = 0, sy = 0, sw = sourceW, sh = sourceH;
    const sourceAspect = sourceW / sourceH;

    if (sourceAspect > targetAspect) {
      sw = Math.round(sourceH * targetAspect);
      sx = Math.round((sourceW - sw) / 2);
    } else if (sourceAspect < targetAspect) {
      sh = Math.round(sourceW / targetAspect);
      sy = Math.round((sourceH - sh) / 2);
    }

    const maxW = CONFIG.maxImageWidth;
    const w = Math.min(maxW, 1400);
    const h = Math.round(w / targetAspect);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { alpha: false });

    // Draw the camera frame exactly as delivered by the browser.
    // Neither front nor rear camera is mirrored. The browser handles
    // camera orientation; we only crop to the current UI aspect ratio.
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);

    return canvas.toDataURL("image/jpeg", CONFIG.jpegQuality);
  }

  async function countdownAndCapture() {
    if (!$("shutterBtn") || $("shutterBtn").disabled) return;
    $("shutterBtn").disabled = true;

    const countdown = $("countdown");
    for (const number of ["3", "2", "1"]) {
      countdown.textContent = number;
      countdown.classList.remove("show");
      void countdown.offsetWidth;
      countdown.classList.add("show");
      await sleep(800);
    }

    try {
      const dataUrl = captureVideoFrame();
      state.photos[state.currentPhoto] = dataUrl;

      $("shutterFlash").classList.remove("flash");
      void $("shutterFlash").offsetWidth;
      $("shutterFlash").classList.add("flash");

      $("capturedPhoto").src = dataUrl;
      $("previewStep").textContent = `PHOTO ${state.currentPhoto + 1} / 2`;
      $("previewTitle").textContent = state.currentPhoto === 0
        ? "Ready? Let's capture it."
        : "One more for the memories.";

      showScreen("photoPreview");
    } catch (error) {
      toast("We couldn't capture that one. Please try again.");
      console.warn(error);
    } finally {
      $("shutterBtn").disabled = false;
      countdown.textContent = "";
    }
  }

  function drawImageCover(ctx, img, box, mirror = false) {
    const sourceW = img.naturalWidth || img.width;
    const sourceH = img.naturalHeight || img.height;
    const targetAspect = box.width / box.height;
    const sourceAspect = sourceW / sourceH;

    let sx = 0, sy = 0, sw = sourceW, sh = sourceH;
    if (sourceAspect > targetAspect) {
      sw = sourceH * targetAspect;
      sx = (sourceW - sw) / 2;
    } else {
      sh = sourceW / targetAspect;
      sy = (sourceH - sh) / 2;
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.width, box.height);
    ctx.clip();

    if (mirror) {
      ctx.translate(box.x + box.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, sx, sy, sw, sh, 0, box.y, box.width, box.height);
    } else {
      ctx.drawImage(img, sx, sy, sw, sh, box.x, box.y, box.width, box.height);
    }
    ctx.restore();
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  async function composePhotoStrip() {
    showScreen("generating");

    const [photo1, photo2, template] = await Promise.all([
      loadImage(state.photos[0]),
      loadImage(state.photos[1]),
      loadImage("assets/template.png")
    ]);

    const canvas = $("compositionCanvas");
    canvas.width = CONFIG.photoStrip.width;
    canvas.height = CONFIG.photoStrip.height;
    const ctx = canvas.getContext("2d", { alpha: false });

    ctx.drawImage(template, 0, 0, canvas.width, canvas.height);

    drawImageCover(ctx, photo1, CONFIG.photoStrip.photo1);
    drawImageCover(ctx, photo2, CONFIG.photoStrip.photo2);

    // Restore the template's thin cream photo-window borders.
    ctx.save();
    ctx.strokeStyle = CONFIG.photoStrip.borderColor;
    ctx.lineWidth = CONFIG.photoStrip.borderWidth;
    [CONFIG.photoStrip.photo1, CONFIG.photoStrip.photo2].forEach((box) => {
      ctx.strokeRect(
        box.x + .5,
        box.y + .5,
        box.width - 1,
        box.height - 1
      );
    });
    ctx.restore();

    state.finalDataUrl = canvas.toDataURL("image/png");
    state.finalBlob = dataUrlToBlob(state.finalDataUrl);
    state.finalFilename =
      `${CONFIG.filenamePrefix}_20260819_${state.sanitizedGuestName}_${timeStamp()}.png`;

    $("finalStrip").src = state.finalDataUrl;
    showScreen("final");

    // Give the browser one frame to paint the final strip before starting upload.
    requestAnimationFrame(() => uploadSession());
  }

  function dataUrlToBlob(dataUrl) {
    const [meta, base64] = dataUrl.split(",");
    const mime = (meta.match(/data:([^;]+);/) || [])[1] || "application/octet-stream";
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    return new Blob([bytes], { type: mime });
  }

  function setSaveStatus(type, message) {
    const status = $("saveStatus");
    status.classList.remove("saved", "failed");
    if (type) status.classList.add(type);
    $("saveStatusText").textContent = message;
  }

  function appendHidden(form, name, value) {
    const input = document.createElement("textarea");
    input.name = name;
    input.value = value;
    input.style.display = "none";
    form.appendChild(input);
  }

  function submitUploadForm() {
    return new Promise((resolve) => {
      if (!CONFIG.backendUrl) {
        resolve(false);
        return;
      }

      const form = document.createElement("form");
      form.method = "POST";
      form.action = CONFIG.backendUrl;
      form.target = "uploadSink";
      form.style.display = "none";

      appendHidden(form, "action", "uploadSession");
      appendHidden(form, "sessionId", state.sessionId);
      appendHidden(form, "guestName", state.guestName);
      appendHidden(form, "sanitizedGuestName", state.sanitizedGuestName);
      appendHidden(form, "photo1DataUrl", state.photos[0]);
      appendHidden(form, "photo2DataUrl", state.photos[1]);
      appendHidden(form, "finalDataUrl", state.finalDataUrl);

      document.body.appendChild(form);
      form.submit();
      form.remove();

      // The hidden iframe only confirms that the POST was handed to Apps Script.
      // The real success state is verified through JSONP status polling.
      setTimeout(() => resolve(true), 250);
    });
  }

  async function uploadSession() {
    if (!CONFIG.backendUrl) {
      setSaveStatus("failed", "Album backup isn't connected yet");
      $("retryUploadBtn").hidden = true;
      return;
    }

    if (!state.sessionId) {
      setSaveStatus("failed", "We couldn't create a secure album session.");
      $("retryUploadBtn").hidden = false;
      return;
    }

    $("retryUploadBtn").hidden = true;

    state.uploadAttempts += 1;
    setSaveStatus("", "Saving your memory…");

    try {
      await submitUploadForm();
      await pollUploadStatus();
    } catch (error) {
      setSaveStatus("failed", "Your photo is ready, but we couldn't save a copy to our wedding album.");
      $("retryUploadBtn").hidden = false;
      console.warn(error);
    }
  }

  async function pollUploadStatus() {
    const started = Date.now();
    const maxWait = 30000;

    while (Date.now() - started < maxWait) {
      try {
        const data = await jsonp(
          `${CONFIG.backendUrl}?action=status&sessionId=${encodeURIComponent(state.sessionId)}`,
          7000
        );

        if (data?.status === "saved") {
          setSaveStatus("saved", "Saved with love 💙");
          $("retryUploadBtn").hidden = true;
          return;
        }
        if (data?.status === "failed") {
          setSaveStatus("failed", "Your photo is ready, but we couldn't save a copy to our wedding album.");
          $("retryUploadBtn").hidden = false;
          return;
        }
      } catch (error) {
        // Continue polling; a transient JSONP failure should not discard the photo.
      }
      await sleep(1800);
    }

    setSaveStatus("failed", "Your photo is ready, but the album is taking a little longer than expected.");
    $("retryUploadBtn").hidden = false;
  }

  function downloadFinal() {
    if (!state.finalDataUrl) return;
    const a = document.createElement("a");
    a.href = state.finalDataUrl;
    a.download = state.finalFilename || `${CONFIG.filenamePrefix}_memory.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function shareFinal() {
    if (!state.finalBlob) return;

    const file = new File(
      [state.finalBlob],
      state.finalFilename || "DU-NIA-GEDE_memory.png",
      { type: "image/png" }
    );

    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({
          title: "#duNiaGede Photobooth",
          text: "A little memory from Gede & Nia's big day 💙",
          files: [file]
        });
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }

    downloadFinal();
    toast("File sharing isn't available here, so we've downloaded your memory instead.");
  }

  function resetForRetake() {
    state.photos = [null, null];
    state.currentPhoto = 0;
    state.finalDataUrl = "";
    state.finalBlob = null;
    state.finalFilename = "";
    $("capturedPhoto").src = "";
    startCamera();
  }

  function openRetakeModal() {
    $("retakeModal").hidden = false;
    $("confirmRetakeBtn").focus();
  }

  function closeRetakeModal() {
    $("retakeModal").hidden = true;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  $("startBtn").addEventListener("click", () => showScreen("name"));

  $("continueNameBtn").addEventListener("click", async () => {
    const value = $("guestName").value.trim().replace(/\s+/g, " ");
    if (!value) {
      setNameError("Please enter your name so we can keep your memory.");
      $("guestName").focus();
      return;
    }

    setNameError("");
    state.guestName = value;
    state.sanitizedGuestName = sanitizeFilename(value);
    state.photos = [null, null];
    state.currentPhoto = 0;
    state.uploadAttempts = 0;

    await createServerSession();
    await startCamera();
  });

  $("guestName").addEventListener("keydown", (event) => {
    if (event.key === "Enter") $("continueNameBtn").click();
  });

  $("shutterBtn").addEventListener("click", countdownAndCapture);
  $("cameraRetryBtn").addEventListener("click", startCamera);
  $("cameraSwitchBtn").addEventListener("click", async () => {
    const btn = $("cameraSwitchBtn");
    btn.disabled = true;
    state.cameraFacingMode = state.cameraFacingMode === "user" ? "environment" : "user";
    try {
      await startCamera(state.cameraFacingMode);
    } finally {
      btn.disabled = false;
    }
  });

  window.addEventListener("resize", updateCameraOrientation, { passive: true });
  window.addEventListener("orientationchange", () => {
    setTimeout(updateCameraOrientation, 150);
  }, { passive: true });
  window.screen?.orientation?.addEventListener?.("change", updateCameraOrientation);

  $("retakePhotoBtn").addEventListener("click", () => {
    startCamera();
  });

  $("usePhotoBtn").addEventListener("click", async () => {
    if (state.currentPhoto === 0) {
      state.currentPhoto = 1;
      await startCamera();
    } else {
      await composePhotoStrip();
    }
  });

  $("finalRetakeBtn").addEventListener("click", openRetakeModal);
  $("cancelRetakeBtn").addEventListener("click", closeRetakeModal);
  $("confirmRetakeBtn").addEventListener("click", () => {
    closeRetakeModal();
    resetForRetake();
  });

  $("downloadBtn").addEventListener("click", downloadFinal);
  $("shareBtn").addEventListener("click", shareFinal);
  $("retryUploadBtn").addEventListener("click", uploadSession);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.screen === "camera") stopCamera();
  });

  window.addEventListener("pagehide", stopCamera);
})();
