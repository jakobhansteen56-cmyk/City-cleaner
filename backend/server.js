const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();
const { Pool } = require("pg");
const OpenAI = require("openai").default;

const app = express();

// Tillat at frontend (nettleseren) kan snakke med serveren
app.use(cors());

// Statiske filer (f.eks. routes.html) fra mappen over backend
app.use(express.static(path.join(__dirname, "..")));

// Eksplicit route til routes.html slik at den alltid kan nås
app.get("/routes.html", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "routes.html"));
});

// Gjør at serveren kan lese JSON-data i forespørsler
app.use(express.json({ limit: "5mb" })); // 5 MB holder til små bilder i base64

// OpenAI-klient (brukes kun hvis OPENAI_API_KEY er satt)
let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  console.log("OpenAI validation enabled via OPENAI_API_KEY.");
}

// Koble til Postgres hvis DATABASE_URL er satt, ellers bruk minne
let pool = null;
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  console.log("Using Postgres database via DATABASE_URL.");
} else {
  console.log("DATABASE_URL not set. Using in-memory storage only.");
}

// Midlertidig lagring i minne (fallback og for lokal testing)
const reports = [];

/** Sjekker om adressen er i Karlsruhe (OpenAI tekstkall). Returnerer true/false. */
async function checkAddressInKarlsruhe(address) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "user",
        content: `Is the following address in Karlsruhe, Germany? Answer only "yes" or "no". Address: ${address}`,
      },
    ],
    max_tokens: 10,
  });
  const answer = (completion.choices[0]?.message?.content || "").trim().toLowerCase();
  return answer.startsWith("yes");
}

/** Sjekker om bildet viser et uteområde (ikke innendørs) og rater søppel 0–10. Returnerer { isOutdoor, litterRating }. */
async function checkStreetAndLitter(imageData) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Look at this image. Answer with exactly two lines:
1) Does this image show an outdoor area (uteområde), or is it obviously indoors (inne)? Answer "yes" if outdoor, "no" if obviously indoors. Write only "yes" or "no".
2) Rate how much litter/garbage is visible in the scene from 0 (no litter) to 10 (extremely littered). Write only a single number 0-10.`,
          },
          {
            type: "image_url",
            image_url: { url: imageData },
          },
        ],
      },
    ],
    max_tokens: 50,
  });
  const text = (completion.choices[0]?.message?.content || "").trim();
  const lines = text.split(/\r?\n/).map((s) => s.trim());
  const isOutdoor = (lines[0] || "").toLowerCase().startsWith("yes");
  const numMatch = (lines[1] || lines[0] || "").match(/\d+/);
  const litterRating = numMatch ? parseInt(numMatch[0], 10) : 0;
  return { isOutdoor, litterRating };
}

// Tar imot bilde (imageData) + adresse
app.post("/api/report", async (req, res) => {
  const { imageData, address } = req.body;

  if (!imageData || !address) {
    return res.status(400).json({ error: "Missing imageData or address" });
  }

  console.log("Report received. Address:", address.substring(0, 80));

  // OpenAI-validering: kun hvis API-nøkkel er satt
  if (openai) {
    try {
      console.log("Running OpenAI validation (Karlsruhe, street, litter).");
      // 1) Er adressen i Karlsruhe?
      let inKarlsruhe;
      try {
        inKarlsruhe = await checkAddressInKarlsruhe(address);
      } catch (err) {
        console.error("OpenAI validation error (Karlsruhe check):", err.message || err);
        throw err;
      }
      if (!inKarlsruhe) {
        return res.status(200).json({ success: false, reason: "not_karlsruhe" });
      }

      // 2) Er bildet et uteområde, og hvor mye søppel (0–10)?
      let isOutdoor, litterRating;
      try {
        const result = await checkStreetAndLitter(imageData);
        isOutdoor = result.isOutdoor;
        litterRating = result.litterRating;
      } catch (err) {
        console.error("OpenAI validation error (image/street check):", err.message || err);
        throw err;
      }
      if (!isOutdoor) {
        return res.status(200).json({ success: false, reason: "not_outdoor" });
      }
      if (litterRating < 2) {
        return res.status(200).json({ success: false, reason: "too_clean" });
      }
    } catch (err) {
      console.error("OpenAI validation error:", err);
      return res.status(500).json({
        success: false,
        error: "Validation failed",
        message: err.message || "OpenAI request failed",
      });
    }
  } else {
    console.log("OpenAI validation skipped (OPENAI_API_KEY not set).");
  }

  console.log("All validations passed. Saving report.");
  const report = {
    id: reports.length + 1,
    imageData,
    address,
    createdAt: new Date().toISOString(),
  };

  // Forsøk å lagre i database hvis tilgjengelig
  if (pool) {
    try {
      await pool.query(
        `
        INSERT INTO reports (image_data, address, created_at)
        VALUES ($1, $2, NOW())
      `,
        [imageData, address]
      );
      console.log("New report stored in Postgres.");
    } catch (err) {
      console.error("Failed to store in Postgres, falling back to memory:", err);
      reports.push(report);
      console.log("New report stored in memory instead:", report);
    }
  } else {
    reports.push(report);
    console.log("New report stored in memory:", report);
  }

  res.status(201).json({ success: true });
});

// Henter ut alt som er lagret
app.get("/api/report", async (req, res) => {
  if (pool) {
    try {
      const result = await pool.query(
        `
        SELECT
          id,
          image_data AS "imageData",
          address,
          created_at AS "createdAt"
        FROM reports
        ORDER BY created_at DESC
      `
      );
      return res.json(result.rows);
    } catch (err) {
      console.error("Failed to read from Postgres, falling back to memory:", err);
    }
  }

  // Fallback: in-memory-lista
  res.json(reports);
});

// Sletter alle rapporter (brukes av routes.html etter planlagt rute)
app.delete("/api/report", async (req, res) => {
  if (pool) {
    try {
      await pool.query("DELETE FROM reports");
      console.log("All reports deleted from Postgres.");
    } catch (err) {
      console.error("Failed to delete reports from Postgres:", err);
      return res.status(500).json({
        success: false,
        error: "Failed to delete reports",
        message: err.message || "Database error",
      });
    }
  }

  // Tøm også in-memory-lista
  reports.length = 0;
  console.log("In-memory reports list cleared.");

  res.json({ success: true });
});

// Konfigurasjon for frontend (f.eks. Google Maps API-nøkkel)
app.get("/api/config", (req, res) => {
  res.json({
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || "",
  });
});

// Hent korteste rute mellom adresser via Google Routes API
app.post("/api/route", async (req, res) => {
  const { addresses } = req.body || {};
  const key = process.env.GOOGLE_MAPS_API_KEY;

  if (!key) {
    return res.status(503).json({
      error: "Google Maps API key not configured",
      message: "Set GOOGLE_MAPS_API_KEY in server environment.",
    });
  }

  if (!Array.isArray(addresses) || addresses.length < 2) {
    return res.status(400).json({
      error: "At least two addresses required",
      message: "Send { addresses: [\"addr1\", \"addr2\", ...] }",
    });
  }

  const trimmed = addresses.map((a) => (a || "").trim()).filter(Boolean);
  if (trimmed.length < 2) {
    return res.status(400).json({
      error: "At least two non-empty addresses required",
    });
  }

  // For Google Routes: tving alle adresser til Karlsruhe, Germany for å unngå
  // at like gatenavn i andre land velges ved geokoding.
  const karlsruheAddresses = trimmed.map((addr) => {
    const lower = addr.toLowerCase();
    return lower.includes("karlsruhe")
      ? addr
      : `${addr}, Karlsruhe, Germany`;
  });

  const origin = { address: karlsruheAddresses[0] };
  const destination = { address: karlsruheAddresses[karlsruheAddresses.length - 1] };
  const intermediates =
    karlsruheAddresses.length > 2
      ? karlsruheAddresses.slice(1, -1).map((a) => ({ address: a }))
      : [];

  const body = {
    origin,
    destination,
    travelMode: "DRIVE",
    ...(intermediates.length > 0 && { intermediates }),
    ...(intermediates.length > 0 && { optimizeWaypointOrder: true }),
  };

  const fieldMask = [
    "routes.legs",
    "routes.distanceMeters",
    "routes.duration",
    "routes.polyline.encodedPolyline",
    "routes.viewport",
  ];
  if (intermediates.length > 0) {
    fieldMask.push("routes.optimizedIntermediateWaypointIndex");
  }

  const url = "https://routes.googleapis.com/directions/v2:computeRoutes";

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": fieldMask.join(","),
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status === 400 ? 400 : 500).json({
        error: "Routes API request failed",
        message: data.error?.message || data.message || response.statusText,
      });
    }

    if (!data.routes || data.routes.length === 0) {
      return res.status(400).json({
        error: "No route found",
        message: "Could not compute a route for the given addresses.",
      });
    }

    res.json(data);
  } catch (err) {
    console.error("Routes API error:", err);
    res.status(500).json({
      error: "Failed to fetch route",
      message: err.message || "Network error",
    });
  }
});

// Start serveren
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});