/**
 * delete-all-reports.js
 *
 * File overview:
 * - This is a small helper script, not part of the running backend.
 * - It connects directly to the Postgres database and deletes
 *   all rows from the "reports" table.
 * - Use it when you want to reset the database manually (for testing or demos).
 *
 * How to run:
 * - Open a terminal in the backend folder:
 *     cd backend
 * - Make sure .env contains a valid DATABASE_URL for your Postgres instance.
 * - Run:
 *     node delete-all-reports.js
 *
 * After running, the "reports" table will be empty.
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
