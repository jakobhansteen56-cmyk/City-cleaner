/**
 * One-off script: deletes all rows from the reports table.
 * Run from backend folder: node delete-all-reports.js
 */
require("dotenv").config();
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  try {
    const result = await pool.query("DELETE FROM reports");
    console.log("Deleted", result.rowCount, "row(s) from reports.");
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();
