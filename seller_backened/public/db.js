const mysql = require("mysql2");

const db = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "",          // XAMPP default
  database: "seller_dashboard"     // <-- यह सही database name है
});
module.exports = db;

