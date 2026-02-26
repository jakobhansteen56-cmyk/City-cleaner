const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { Pool } = require("pg");

const app = express();

// Tillat at frontend (nettleseren) kan snakke med serveren
app.use(cors());

// Gjør at serveren kan lese JSON-data i forespørsler
app.use(express.json({ limit: "5mb" })); // 5 MB holder til små bilder i base64

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

// Tar imot bilde (imageData) + adresse
app.post("/api/report", async (req, res) => {
  const { imageData, address } = req.body;

  if (!imageData || !address) {
    return res.status(400).json({ error: "Missing imageData or address" });
  }

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

// Start serveren
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});