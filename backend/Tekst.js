const express = require("express");
const cors = require("cors");

const app = express();

// Tillat at frontend (nettleseren) kan snakke med serveren
app.use(cors());

// Gjør at serveren kan lese JSON-data i forespørsler
app.use(express.json({ limit: "5mb" })); // 5 MB holder til små bilder i base64

// Midlertidig lagring i minne (forsvinner når serveren restartes)
const reports = [];

// Tar imot bilde (imageData) + adresse
app.post("/api/report", (req, res) => {
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

  reports.push(report);
  console.log("New report stored in memory:", report);

  res.status(201).json({ success: true });
});

// Henter ut alt som er lagret (for testing senere)
app.get("/api/report", (req, res) => {
  res.json(reports);
});

// Start serveren
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});