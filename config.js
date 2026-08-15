const CONFIG = {
  coupleName: "Gede & Nia",
  hashtag: "#duNiaGede",
  weddingDate: "19 August 2026",
  weddingDateISO: "2026-08-19",
  location: "Tabanan, Bali",

  // Paste the deployed Google Apps Script /exec URL here.
  // Leave blank only while doing a local UI/camera test.
  backendUrl: "",

  photoCount: 2,
  filenamePrefix: "DU-NIA-GEDE",

  // Camera images are resized before upload.
  maxImageWidth: 1600,
  jpegQuality: 0.85,

  photoStrip: {
    width: 1080,
    height: 1920,

    // These are the two photo windows in the supplied 1080 x 1920 template.
    // The cream 2px border is redrawn after the guest photo is placed.
    photo1: { x: 98, y: 268, width: 884, height: 554 },
    photo2: { x: 98, y: 851, width: 884, height: 601 },

    borderColor: "#f8f7f2",
    borderWidth: 2
  }
};
