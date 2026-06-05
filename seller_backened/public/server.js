



    const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const db = require("./db");
const multer = require("multer");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const app = express();
app.use(express.json());
app.use(cors({
    origin: "http://localhost:3000",
    credentials: true
}));
const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);

const sessionStore = new MySQLStore({
  host: "localhost",
  user: "root",
  password: "",
  database: "seller_dashboard"
});

app.use(session({
  name: "connect.sid",
  secret: "banasthali_secret_key",
  resave: false,
  saveUninitialized: false,
  store: sessionStore,   
  cookie: {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    maxAge: 1000 * 60 * 10
  }
}));


const path = require("path");
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, "public")));
app.use('/images', express.static( 'images'));

// ===== MULTER CONFIG =====
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "images/");
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

// ===== REVIEW IMAGE STORAGE =====
const storageReview = multer.diskStorage({
destination: function (req, file, cb) {
cb(null, "images/reviews/");
},
filename: function (req, file, cb) {
cb(null, Date.now() + "-" + file.originalname);
}
});

const uploadReview = multer({ 
  storage: storageReview,
  fileFilter: (req, file, cb) => {
    console.log("File filtering:", file.fieldname, file.originalname, file.mimetype);
    const allowed = /jpeg|jpg|png|gif/;
    const isValid = allowed.test(file.mimetype) && allowed.test(path.extname(file.originalname).toLowerCase());
    if (isValid) cb(null, true);
    else cb(new Error("Only JPG, JPEG, PNG, GIF allowed"));
  }
});

app.use("/images/reviews", express.static("images/reviews"));

app.post("/api/add-review", uploadReview.single("review_image"), (req,res)=>{

const product_id = req.body.product_id || req.body.id;
const {rating, review_text} = req.body;

console.log("=== REVIEW REQUEST ===");
console.log("product_id:", product_id);
console.log("rating:", rating);
console.log("review_text:", review_text);
console.log("File received:", req.file);
console.log("All body fields:", req.body);
console.log("====================");

if(!product_id || product_id === "0"){
return res.status(400).json({message:"Invalid product id"});
}

if(!req.session.user){
return res.status(401).json({message:"Login required"});
}

const buyer_id = req.session.user.buyer_id;

const checkDelivery = `
SELECT * FROM orders 
WHERE buyer_id=? AND product_id=? AND status='delivered'
`;

db.query(checkDelivery,[buyer_id,product_id],(err,result)=>{

if(err){
console.log("Delivery check error:",err);
return res.status(500).json({message:"Database error"});
}

if(result.length === 0){
return res.status(400).json({message:"You can review only after delivery"});
}

const image = req.file ? req.file.filename : null;

const sql = `
INSERT INTO reviews(product_id,buyer_id,rating,review_text,review_image)
VALUES(?,?,?,?,?)
`;

db.query(sql,[product_id,buyer_id,rating,review_text,image],(err,result)=>{

if(err){
console.log("❌ REVIEW INSERT ERROR:", err);
return res.status(500).json({message:"Review save failed"});
}

console.log("✅ Review saved successfully");

res.json({message:"Review added successfully"});

});

});

});
app.get("/api/reviews/:product_id",(req,res)=>{

const product_id = req.params.product_id;

const sql = `
SELECT r.*, b.name 
FROM reviews r
JOIN buyerdetails b ON r.buyer_id = b.buyer_id
WHERE r.product_id = ?
ORDER BY r.review_id DESC
`;

db.query(sql,[product_id],(err,result)=>{

if(err){
console.log("Review fetch error:",err);
return res.status(500).json({error:"Database error"});
}

res.json({reviews: result});

});

});

app.get("/api/seller/reviews", isSellerLoggedIn, (req, res) => {
  const seller_id = req.session.user.seller_id;

  const sql = `
    SELECT r.*, b.name as buyer_name, p.Product_name, p.image AS product_image
    FROM reviews r
    JOIN buyerdetails b ON r.buyer_id = b.buyer_id
    JOIN product p ON r.product_id = p.product_id
    WHERE p.seller_id = ?
    ORDER BY r.review_id DESC
  `;

  db.query(sql, [seller_id], (err, result) => {
    if (err) {
      console.log("Seller reviews fetch error:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.json({ reviews: result });
  });
});



const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, //  max 2MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png/;
    const isValid =
      allowed.test(file.mimetype) &&
      allowed.test(path.extname(file.originalname).toLowerCase());

    if (isValid) cb(null, true);
    else cb(new Error("Only JPG, JPEG, PNG allowed"));
  }
});

app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

// ===== NODEMAILER CONFIGURATION =====
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'deepanjalis0909@gmail.com',
    pass: 'lxlb qnci inad afjv'  // Gmail app password
  }
});

// In-memory OTP storage (for production, use database table)
const otpStorage = new Map();

function isSellerLoggedIn(req, res, next) {
    console.log("🔐 isSellerLoggedIn check:");
    console.log("   Session ID:", req.sessionID);
    console.log("   Session.user:", req.session.user);
    console.log("   Cookies:", req.headers.cookie);
    
    if (req.session.user && req.session.user.role === "seller") {
        console.log("   ✅ Seller authorized:", req.session.user.seller_id);
        return next();
    }
    
    console.log("   ❌ Authorization failed - No seller session");
    // Check if request expects HTML (browser navigation) or JSON (API call)
    if (req.headers.accept && req.headers.accept.includes('text/html')) {
        return res.redirect('/novaconnect_2ndpage.html');
    }
    return res.status(401).json({ message: "Unauthorized" });
}

function isBuyerLoggedIn(req, res, next) {
    if (req.session.user && req.session.user.role === "buyer") {
        return next();
    }
    // Check if request expects HTML (browser navigation) or JSON (API call)
    if (req.headers.accept && req.headers.accept.includes('text/html')) {
        return res.redirect('/novaconnect_2ndpage.html');
    }
    return res.status(401).json({ message: "Unauthorized" });
}

function isAdminLoggedIn(req, res, next) {
    if (req.session.user && req.session.user.role === "admin") {
        return next();
    }
    // Check if request expects HTML (browser navigation) or JSON (API call)
    if (req.headers.accept && req.headers.accept.includes('text/html')) {
        return res.redirect('/novaconnect_2ndpage.html');
    }
    return res.status(401).json({ message: "Unauthorized" });
}

app.get("/seller", isSellerLoggedIn, (req, res) => {
  res.sendFile(path.join(__dirname,  "..", "public", "shalviseller.html"));
});

app.get("/buyer", isBuyerLoggedIn, (req, res) => {
  res.sendFile(path.join(__dirname, "buyer_dashboard.html"));
});

app.get("/admin", isAdminLoggedIn, (req, res) => {
  res.sendFile(path.join(__dirname, "admin_dashboard.html"));
});



app.post("/seller/register", async (req, res) => {
  const { name, email, smartcard_id, hostel,  password } = req.body;

  try {
    // 1️⃣ Check if email already exists
    const checkEmailSql = "SELECT email FROM sellerdetails WHERE email = ?";
    
    db.query(checkEmailSql, [email], async (err, emailResult) => {
      if (err) {
        console.log("Error checking email:", err);
        return res.status(500).json({ message: "Server error" });
      }
      
      if (emailResult.length > 0) {
        return res.status(400).json({ 
          message: "Email already registered",
          emailExists: true 
        });
      }

      // 2️⃣ Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // 3️⃣ Get last seller_id
      const getLastIdSql =
        "SELECT seller_id FROM sellerdetails ORDER BY id DESC LIMIT 1";

    db.query(getLastIdSql, (err, result) => {
      if (err) {
        console.log(" Error fetching seller_id:", err);
        return res.status(500).send("Server error");
      }

      // 4️⃣ Generate next seller_id
      let nextSellerId = "S001";

      if (result.length > 0) {
        const lastId = result[0].seller_id; // e.g. S007
        const number = parseInt(lastId.substring(1)) + 1;
        nextSellerId = "S" + number.toString().padStart(3, "0");
      }

      // 5️⃣ Insert seller
      const insertSql = `
      INSERT INTO sellerdetails (seller_id, name, email, smartcard_id, hostel, hashedPassword)
      VALUES (?, ?, ?, ?, ?, ?)
`;


      db.query(
        insertSql,
        [nextSellerId, name, email, smartcard_id, hostel, hashedPassword],

        (err, result) => {
          if (err) {
            console.log(" Insert error:", err);
            return res.status(500).send("Error saving seller");
          }

          console.log("✅ Seller registered:", nextSellerId);
          req.session.user = { email, role: "seller", seller_id: nextSellerId, name };
          req.session.save(() => {
            res.json({ 
              message: "Seller registered successfully!",
              redirect: "/seller"
            });
          });
        }
      );
    });
    });
  } catch (error) {
    console.log("Server error:", error);
    res.status(500).send("Internal error");
  }
});
app.post("/buyer/register", async (req, res) => {
 const { name,  email, smartcard_id, hostel, password } = req.body;

  try {
    // 1️⃣ Check if email already exists
    const checkEmailSql = "SELECT email FROM buyerdetails WHERE email = ?";
    
    db.query(checkEmailSql, [email], async (err, emailResult) => {
      if (err) {
        console.log("Error checking email:", err);
        return res.status(500).json({ message: "Server error" });
      }
      
      if (emailResult.length > 0) {
        return res.status(400).json({ 
          message: "Email already registered",
          emailExists: true 
        });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      
      const getLastIdSql =
        "SELECT buyer_id FROM buyerdetails WHERE buyer_id IS NOT NULL ORDER BY id DESC LIMIT 1";

    db.query(getLastIdSql, (err, result) => {
      if (err) {
        console.log("Fetch buyer_id error:", err);
        return res.status(500).send("Server error");
      }

    
      let nextBuyerId = "B001";

      if (result.length > 0) {
        const lastId = result[0].buyer_id; // B007
        const number = parseInt(lastId.substring(1)) + 1;
        nextBuyerId = "B" + number.toString().padStart(3, "0");
      }

      
      const insertSql = `
      INSERT INTO buyerdetails (buyer_id, name, email, smartcard_id, hostel, hashedPassword)
      VALUES (?, ?, ?, ?, ?, ?)
`      ;


      db.query(
        insertSql,
        [nextBuyerId, name, email, smartcard_id , hostel, hashedPassword],

        (err, result) => {
          if (err) {
            console.log(" Buyer insert error:", err);
            return res.status(500).send("Error saving buyer");
          }

          console.log("✅ Buyer registered:", nextBuyerId);
          req.session.user = { email, role: "buyer", buyer_id: nextBuyerId, name };
          req.session.save(() => {
            res.json({ 
              message: "Buyer registered successfully!",
              redirect: "/buyer"
            });
          });
        }
      );
    });
    });
  } catch (err) {
    console.log("Buyer server error:", err);
    res.status(500).send("Server error");
  }
});



// ===== ADD PRODUCT =====
app.post("/product", isSellerLoggedIn, upload.single("image"), (req, res) => {
  const { Product_name, description } = req.body;

  const price = parseFloat(req.body.price);
  const quantity = parseInt(req.body.quantity, 10);
  const image = req.file?.filename;

  // ✅ VALIDATIONS
  if (!Product_name || !image) {
    return res.status(400).json({
      message: "Product name & image are required"
    });
  }

  if (!Number.isFinite(price) || price <= 0) {
    return res.status(400).json({
      message: "Invalid price."
    });
  }

  if (!Number.isInteger(quantity) || quantity < 0) {
    return res.status(400).json({
      message: "Quantity must be a whole number"
    });
  }

  // Generate custom product_id in P001 format
  const getLastIdSql = "SELECT product_id FROM product ORDER BY product_id DESC LIMIT 1";
  
  db.query(getLastIdSql, (err, result) => {
    if (err) {
      console.error("❌ Error fetching last product_id:", err);
      return res.status(500).json({ 
        message: "Database error. Please check if product table exists.",
        error: err.message 
      });
    }

    let newProductId;
    
    if (result.length === 0) {
      // First product
      newProductId = "P001";
      console.log("✅ First product, assigning ID:", newProductId);
    } else {
      // Extract number from last product_id (e.g., "P001" -> 1)
      const lastId = result[0].product_id;
      console.log("📋 Last product_id in database:", lastId);
      
      const numMatch = String(lastId).match(/\d+/);
      const lastNum = numMatch ? parseInt(numMatch[0], 10) : 0;
      const nextNum = lastNum + 1;
      
      // Format with leading zeros (P001, P002, etc.)
      newProductId = "P" + String(nextNum).padStart(3, "0");
      console.log("✅ Generated new product_id:", newProductId);
    }

    // Get seller_id from session
    const seller_id = req.session.user.seller_id;

    const sql = `
      INSERT INTO product (product_id, Product_name, price, \`quantity\`, description, image, seller_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    console.log("🔄 Attempting to insert product with ID:", newProductId, "for seller:", seller_id);

    db.query(
      sql,
      [newProductId, Product_name, price, quantity, description || "", image, seller_id],
      (err, result) => {
        if (err) {
          console.error("❌ DB Insert Error:", err);
          console.error("❌ Error Code:", err.code);
          console.error("❌ SQL Message:", err.sqlMessage);
          
          // Check if error is due to column type mismatch
          if (err.code === 'ER_TRUNCATED_WRONG_VALUE' || err.sqlMessage?.includes('Incorrect integer')) {
            return res.status(500).json({ 
              message: "Database schema error: product_id column needs to be VARCHAR, not integer. Please run the fix_product_id.sql script." 
            });
          }
          
          return res.status(500).json({ 
            message: "Insert failed: " + (err.sqlMessage || err.message)
          });
        }

        console.log("✅ Product inserted successfully with ID:", newProductId);
        res.json({ message: "Product added successfully", product_id: newProductId });
      }
    );
  });
});

// Seller-specific: only returns products for the logged-in seller
app.get("/seller/products", isSellerLoggedIn, (req, res) => {
  const seller_id = req.session.user.seller_id;
  db.query("SELECT * FROM product WHERE seller_id = ? ORDER BY product_id DESC", [seller_id], (err, results) => {
    if (err) {
      console.error("DB Fetch Error:", err);
      return res.status(500).json({ message: "Failed to fetch products", error: err.sqlMessage });
    }
    res.json(results);
  });
});

// Public: returns all products (for buyers)
app.get("/products", (req, res) => {
  // Disable caching for product list
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  
  db.query("SELECT * FROM product WHERE quantity > 0 ORDER BY product_id DESC", (err, results) => {
    if (err) {
      console.error("DB Fetch Error:", err);
      return res.status(500).json({ message: "Failed to fetch products", error: err.sqlMessage });
    }
    res.json(results);
  });
});
app.delete("/product/:id", isSellerLoggedIn, (req, res) => {
  const id = req.params.id;

  console.log("Delete request for ID:", id); 
  
  const sql = "DELETE FROM product WHERE product_id = ?";

  db.query(sql, [id], (err, result) => {
    if (err) {
      console.log(err);
      return res.status(500).json({ message: "Delete failed" });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.json({ message: "Product deleted successfully" });
  });
});

app.put("/product/:id/quantity", isSellerLoggedIn, (req, res) => {
  const quantity = parseInt(req.body.quantity, 10);
  const id = req.params.id;
  const seller_id = req.session.user.seller_id;

  if (!Number.isInteger(quantity) || quantity < 0) {
    return res.status(400).json({
      message: "Quantity must be a non-negative integer"
    });
  }

  // First check if product exists and belongs to this seller
  const checkSql = "SELECT product_id FROM product WHERE product_id = ? AND seller_id = ?";
  db.query(checkSql, [id, seller_id], (err, results) => {
    if (err) {
      console.error("Check product error:", err);
      return res.status(500).json({ message: "Database error" });
    }

    if (results.length === 0) {
      return res.status(404).json({ message: "Product not found or access denied" });
    }

    const sql = "UPDATE product SET \`quantity\` = ? WHERE product_id = ? AND seller_id = ?";
    db.query(sql, [quantity, id, seller_id], (err) => {
      if (err) {
        console.error("Update quantity error:", err);
        return res.status(500).json({ message: "Update failed" });
      }
      res.json({ message: "Stock updated successfully" });
    });
  });
});



// ===== ADMIN REGISTER =====
app.post("/admin/register", async (req, res) => {
  const { name, email, password } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    // Get last admin_id
    const getLastIdSql =
      "SELECT admin_id FROM admindetails ORDER BY id DESC LIMIT 1";

    db.query(getLastIdSql, (err, result) => {
      if (err) {
        console.log("Fetch admin_id error:", err);
        return res.status(500).json({ message: "Server error" });
      }

      // Generate next admin_id
      let nextAdminId = "A001";

      if (result.length > 0) {
        const lastId = result[0].admin_id; // A007
        const number = parseInt(lastId.substring(1)) + 1;
        nextAdminId = "A" + number.toString().padStart(3, "0");
      }

      const insertSql = `
        INSERT INTO admindetails (admin_id, name, email, hashedPassword)
        VALUES (?, ?, ?, ?)
      `;

      db.query(
        insertSql,
        [nextAdminId, name, email, hashedPassword],
        (err) => {
          if (err) {
            console.log("Admin insert error:", err);
            return res.status(500).json({ message: "Error saving admin" });
          }

          req.session.user = { email, role: "admin" };
          req.session.save(() => {
            console.log("Admin created & logged in:", nextAdminId);
            res.json({ message: "Admin registered successfully", redirect: "/admin" });
          });
        }
      );
    });

  } catch (err) {
    console.log("Admin server error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/login", (req, res) => {
  const { email, password, rememberMe } = req.body;

  // Set session duration based on remember me
  // Remember me: 30 days, Otherwise: 10 minutes
  const sessionDuration = rememberMe ? 1000 * 60 * 60 * 24 * 30 : 1000 * 60 * 10;

  // Step 1: Check if email exists in any table
  const adminQuery  = "SELECT * FROM admindetails WHERE email=?";
  const sellerQuery = "SELECT * FROM sellerdetails WHERE email=?";
  const buyerQuery  = "SELECT * FROM buyerdetails WHERE email=?";

  db.query(adminQuery, [email], (err, adminResult) => {
    if (err) return res.status(500).json({ message: "Database error" });

    if (adminResult.length > 0) {
      // Email found in admin — verify password
      return verifyAndLogin(req, res, adminResult[0], "admin", sessionDuration);
    }

    db.query(sellerQuery, [email], (err, sellerResult) => {
      if (err) return res.status(500).json({ message: "Database error" });

      if (sellerResult.length > 0) {
        // Email found in seller — verify password
        return verifyAndLogin(req, res, sellerResult[0], "seller", sessionDuration);
      }

      db.query(buyerQuery, [email], (err, buyerResult) => {
        if (err) return res.status(500).json({ message: "Database error" });

        if (buyerResult.length > 0) {
          // Email found in buyer — verify password
          return verifyAndLogin(req, res, buyerResult[0], "buyer", sessionDuration);
        }

        // Email not found in any table
        return res.status(404).json({ message: "This email is not registered. Please sign up first." });
      });
    });
  });
});

// Helper: verify password and create session
async function verifyAndLogin(req, res, user, role, sessionDuration) {
  const match = await bcrypt.compare(req.body.password, user.hashedPassword);
  if (!match) {
    return res.status(401).json({ message: "Incorrect password" });
  }

  const sessionData = { email: user.email, role };
  if (role === "seller") {
    sessionData.seller_id = user.seller_id;
    sessionData.name = user.name;
  } else if (role === "buyer") {
    sessionData.buyer_id = user.buyer_id;
    sessionData.name = user.name;
  }

  req.session.user = sessionData;
  req.session.cookie.maxAge = sessionDuration;
  req.session.save(() => {
    const roleName = role.charAt(0).toUpperCase() + role.slice(1);
    return res.json({ message: `${roleName} login successful`, redirect: `/${role}` });
  });
}

// ===== SELLER PROFILE ENDPOINTS =====

// Get seller profile data
app.get("/seller/profile", isSellerLoggedIn, (req, res) => {
  const sellerId = req.session.user.seller_id;
  
  const query = "SELECT seller_id, name, email, smartcard_id, hostel FROM sellerdetails WHERE seller_id = ?";
  
  db.query(query, [sellerId], (err, result) => {
    if (err) {
      console.log("Error fetching seller profile:", err);
      return res.status(500).json({ message: "Database error" });
    }
    
    if (result.length === 0) {
      return res.status(404).json({ message: "Seller not found" });
    }
    
    res.json({ 
      success: true, 
      profile: result[0] 
    });
  });
});

// Update seller profile
app.put("/seller/profile", isSellerLoggedIn, (req, res) => {
  const sellerId = req.session.user.seller_id;
  const { name, smartcard_id, hostel } = req.body;
  
  console.log("📝 Profile update request:", { sellerId, name, smartcard_id, hostel });
  
  // Validate input
  if (!name || !smartcard_id || !hostel) {
    console.log("❌ Validation failed: Missing required fields");
    return res.status(400).json({ message: "All fields are required" });
  }
  
  const query = "UPDATE sellerdetails SET name = ?, smartcard_id = ?, hostel = ? WHERE seller_id = ?";
  
  console.log("🔄 Executing database update for seller:", sellerId);
  
  db.query(query, [name, smartcard_id, hostel, sellerId], (err, result) => {
    if (err) {
      console.log("❌ Database error:", err);
      return res.status(500).json({ message: "Database error: " + err.message });
    }
    
    console.log("✅ Database update result:", result);
    
    if (result.affectedRows === 0) {
      console.log("⚠️ No rows affected - seller not found:", sellerId);
      return res.status(404).json({ message: "Seller not found" });
    }
    
    console.log(`✅ Profile updated successfully for seller ${sellerId}`);
    
    // Update session data with new name
    req.session.user.name = name;
    req.session.save(() => {
      res.json({ 
        success: true, 
        message: "Profile updated successfully",
        updatedRows: result.affectedRows
      });
    });
  });
});

// ===== TEST ENDPOINT TO VERIFY DATABASE =====
app.get("/test/seller-table", isSellerLoggedIn, (req, res) => {
  const sellerId = req.session.user.seller_id;
  
  console.log("🔍 Testing database connection for seller:", sellerId);
  
  const query = "SELECT * FROM sellerdetails WHERE seller_id = ?";
  
  db.query(query, [sellerId], (err, result) => {
    if (err) {
      console.log("❌ Database test error:", err);
      return res.status(500).json({ 
        success: false, 
        error: err.message,
        message: "Database connection failed" 
      });
    }
    
    console.log("✅ Database test result:", result);
    
    res.json({
      success: true,
      seller_found: result.length > 0,
      seller_data: result[0] || null,
      table_exists: true
    });
  });
});



// ===== ORDER MANAGEMENT ENDPOINTS =====

// Track processed request IDs to prevent duplicate submissions
const processedRequests = new Map();

// Clean up old request IDs every 5 minutes
setInterval(() => {
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  for (const [requestId, timestamp] of processedRequests.entries()) {
    if (timestamp < fiveMinutesAgo) {
      processedRequests.delete(requestId);
    }
  }
}, 5 * 60 * 1000);

// 1. Place order (Buyer side - creates orders for each product from each seller)
app.post("/api/orders", isBuyerLoggedIn, async (req, res) => {
  const { buyer_id, items, requestId } = req.body;
  
  console.log("\n" + "=".repeat(60));
  console.log("🔵 SERVER: Order request received - Request ID:", requestId || 'NO REQUEST ID');
  console.log("🔵 SERVER: Buyer ID:", buyer_id);
  console.log("🔵 SERVER: Items count:", items?.length);
  console.log("🔵 SERVER: Unique product IDs:", items?.map(item => item.id));
  console.log("🔵 SERVER: Request timestamp:", new Date().toISOString());
  console.log("🔵 SERVER: Session user:", req.session.user?.buyer_id);
  
  // Check if this request was already processed
  if (requestId && processedRequests.has(requestId)) {
    console.log("⚠️ SERVER: DUPLICATE REQUEST DETECTED - Request ID already processed:", requestId);
    console.log("=".repeat(60));
    return res.status(429).json({ 
      success: false, 
      message: "Duplicate request - order already processed" 
    });
  }
  
  // Mark this request as being processed
  if (requestId) {
    processedRequests.set(requestId, Date.now());
    console.log("✅ SERVER: Request ID marked as processing");
  }
  
  console.log("=".repeat(60));

  if (!buyer_id || !items || items.length === 0) {
    return res.status(400).json({ 
      success: false, 
      message: "Buyer ID and items are required" 
    });
  }

  // Validate buyer_id is not 0 or empty
  if (buyer_id === 0 || buyer_id === '0' || buyer_id === '') {
    return res.status(400).json({ 
      success: false, 
      message: "Invalid buyer ID" 
    });
  }

  console.log(`\n🔄 Processing ${items.length} item(s) for buyer ${buyer_id}...\n`);

  try {
    let ordersCreated = 0;
    
    // Insert each item as a separate order
    for (const item of items) {
      // Validate product_id
      if (!item.id || item.id === 0 || item.id === '0') {
        console.error('❌ Invalid product ID:', item.id);
        continue; // Skip this item
      }

      console.log(`\n--- Processing item ${ordersCreated + 1}/${items.length} ---`);

      // Fetch seller_id, productname, quantity from product table
      const productQuery = `
        SELECT seller_id, Product_name, image, \`quantity\`
      FROM product 
      WHERE \`product_id\` = ?
      `;
      
      const productResult = await new Promise((resolve, reject) => {
        db.query(productQuery, [item.id], (err, results) => {
          if (err) reject(err);
          else resolve(results);
        });
      });

      const product_name = productResult[0]?.Product_name;
      const product_image = productResult[0]?.image;
      const availableStock = productResult[0]?.quantity || 0;

      console.log(`📊 Product ${item.id} data:`, {
        name: product_name,
        availableStock: availableStock,
        stockType: typeof availableStock,
        rawQuantity: productResult[0]?.quantity
      });

      if (!product_name) {
       console.log("❌ Product not found for ID:", item.id);
       continue;
      }

      // Check stock availability
      if (item.qty > availableStock) {
        console.log(`❌ Insufficient stock for Product ${item.id}: Requested ${item.qty}, Available ${availableStock}`);
        continue; // Skip this item
      }

      // Store current stock for later update
      item.currentStock = availableStock;
      item.newStock = Math.max(0, availableStock - item.qty);
      
      console.log(`📋 Stock calculation: Product ${item.id} - Current: ${item.currentStock}, Qty: ${item.qty}, New: ${item.newStock}`);

      // Get seller_id from product or use fallback
      const seller_id = productResult.length > 0 && productResult[0].seller_id 
        ? productResult[0].seller_id 
        : (item.seller_id || 'S001');

      console.log(`📝 Creating order ${ordersCreated + 1}:`, {
        buyer_id,
        seller_id,
        product_id: item.id,
        product_name: item.name,
        quantity: item.qty,
        price: item.price
      });

      // Check for duplicate order (same buyer, same product within last 60 seconds)
      const dupCheck = await new Promise((resolve, reject) => {
        db.query(
          `SELECT order_id FROM orders WHERE buyer_id = ? AND product_id = ? AND order_date > DATE_SUB(NOW(), INTERVAL 60 SECOND)`,
          [buyer_id, item.id],
          (err, results) => {
            if (err) reject(err);
            else resolve(results);
          }
        );
      });

      if (dupCheck.length > 0) {
        console.log(`⚠️ Skipping duplicate: Product ${item.id} already ordered by ${buyer_id} in last 60s`);
        continue;
      }

      const insertQuery = `
        INSERT INTO orders 
        (buyer_id, seller_id, product_id, product_name, product_image, quantity, total_amount, total_price, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
      `;

      const totalAmount = item.price * item.qty;
      
      // Extract filename from image URL if it's a full URL
      let imageFilename = item.image || '';
      if (imageFilename && imageFilename.includes('/images/')) {
        imageFilename = imageFilename.split('/images/').pop();
      }

      await new Promise((resolve, reject) => {
        db.query(
          insertQuery,
          [
            buyer_id,
            seller_id,
            item.id,          // Ensure product_id is not 0
            product_name,
            product_image,
            
            item.qty,
            totalAmount,
            item.price
          ],
          (err, result) => {
            if (err) {
              console.error('❌ Database insert error:', err);
              console.error('Error details:', err.message);
              console.error('Parameters:', { buyer_id, seller_id, product_id: item.id });
              reject(err);
            }
            else {
              console.log('✅ Order inserted successfully - Order ID:', result.insertId);
              ordersCreated++;
              resolve(result);
            }
          }
        );
      });

      // Update stock after successful order insertion
      const updateSql = "UPDATE product SET `quantity` = ? WHERE `product_id` = ?";
      console.log(`🔄 Executing stock update: ${updateSql} with values [${item.newStock}, ${item.id}]`);
      
      db.query(
        updateSql,
        [item.newStock, item.id],
        (err, result) => {
          if (err) {
            console.error(`❌ Stock update FAILED for product ${item.id}:`, {
              error: err.message,
              code: err.code,
              sql: err.sql,
              newStock: item.newStock,
              productId: item.id
            });
          } else {
            console.log(`✅ Stock update SUCCESS: Product ${item.id} new stock = ${item.newStock} (was ${item.currentStock})`);
            console.log(`   Rows affected: ${result.affectedRows}`);
            
            // Verify update immediately
            db.query("SELECT `product_id`, `quantity` FROM product WHERE `product_id` = ?", [item.id], (verifyErr, verifyResult) => {
              if (verifyErr) {
                console.error(`❌ Verification query failed:`, verifyErr);
              } else if (verifyResult.length > 0) {
                console.log(`   ✓ Verification: Database shows stock = ${verifyResult[0].quantity} for product ${item.id}`);
              } else {
                console.error(`❌ Verification: Product ${item.id} not found in database!`);
              }
            });
          }
        }
      );

      console.log(`✅ Order created: Product ${item.id} from Seller ${seller_id} to Buyer ${buyer_id}`);
    }

    console.log(`\n🎉 SERVER: Total orders created: ${ordersCreated} out of ${items.length} items`);
    console.log(`🎉 SERVER: Request ID: ${requestId || 'NO REQUEST ID'} - COMPLETED\n`);

    res.json({ 
      success: true, 
      message: `Order placed successfully (${ordersCreated} item${ordersCreated !== 1 ? 's' : ''})`,
      ordersCreated: ordersCreated,
      requestId: requestId
    });
  } catch (error) {
    console.error("❌ Error placing order:", error);
    console.error("Error details:", error.message);
    console.error("Error code:", error.code);
    res.status(500).json({ 
      success: false, 
      message: "Error placing order: " + (error.message || "Unknown error"),
      error: error.code || error.message
    });
  }
});

// 2. Get buyer's orders
app.get("/api/orders/buyer/:buyer_id", isBuyerLoggedIn, (req, res) => {
  const { buyer_id } = req.params;

  const query = `
    SELECT * FROM orders 
    WHERE buyer_id = ? 
    ORDER BY order_date DESC
  `;

  db.query(query, [buyer_id], (err, results) => {
    if (err) {
      console.error("Error fetching buyer orders:", err);
      return res.status(500).json({ 
        success: false, 
        message: "Error fetching orders" 
      });
    }

    // Group orders by timestamp (orders placed at the same time = same order batch)
    const orderGroups = {};
    
    results.forEach(order => {
      // Create a unique key based on order_date (rounded to nearest second)
      const orderTime = new Date(order.order_date).getTime();
      const timeKey = Math.floor(orderTime / 1000); // Group by second
      
      if (!orderGroups[timeKey]) {
        orderGroups[timeKey] = {
          id: order.order_id, // Use first order_id as group ID
          date: order.order_date,
          status: order.status,
          total: 0,
          items: []
        };
      }
      
      // Add item to this order group
      orderGroups[timeKey].items.push({
        id: order.product_id,
        name: order.product_name,
        image: order.product_image && order.product_image.startsWith('http') 
          ? order.product_image 
          : `http://localhost:3000/images/${order.product_image}`,
        price: order.total_price,
        qty: order.quantity
      });
      
      // Add to total amount
      orderGroups[timeKey].total += order.total_amount;
      
      // Update status to most advanced status in the group
      // Priority: delivered > out_for_delivery > pending
      const statusPriority = { 'pending': 1, 'out_for_delivery': 2, 'delivered': 3 };
      if (statusPriority[order.status] > statusPriority[orderGroups[timeKey].status]) {
        orderGroups[timeKey].status = order.status;
      }
    });

    // Convert grouped orders to array
    const formattedOrders = Object.values(orderGroups);
    
    console.log(`✅ Grouped ${results.length} items into ${formattedOrders.length} orders for buyer ${buyer_id}`);

    res.json({ 
      success: true, 
      orders: formattedOrders 
    });
  });
});

// 3. Get single order details (Buyer)
app.get("/api/orders/:order_id", isBuyerLoggedIn, (req, res) => {
  const { order_id } = req.params;

  const query = `
    SELECT * FROM orders 
    WHERE order_id = ?
  `;

  db.query(query, [order_id], (err, results) => {
    if (err) {
      console.error("Error fetching order details:", err);
      return res.status(500).json({ 
        success: false, 
        message: "Error fetching order details" 
      });
    }

    if (results.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: "Order not found" 
      });
    }

    res.json({ 
      success: true, 
      order: results[0] 
    });
  });
});

// 4. Cancel order (Buyer) - only if status is 'pending'
app.put("/api/orders/:order_id/cancel", isBuyerLoggedIn, (req, res) => {
  const { order_id } = req.params;
  const buyer_id = req.session.user.buyer_id;

  // First check if the order belongs to this buyer and is pending
  const checkQuery = `
    SELECT * FROM orders 
    WHERE order_id = ? AND buyer_id = ? AND status = 'pending'
  `;

  db.query(checkQuery, [order_id, buyer_id], (err, results) => {
    if (err) {
      console.error("Error checking order:", err);
      return res.status(500).json({ 
        success: false, 
        message: "Error processing request" 
      });
    }

    if (results.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: "Order not found or cannot be cancelled" 
      });
    }

    // Update order status to cancelled
    const updateQuery = `
      UPDATE orders 
      SET status = 'cancelled' 
      WHERE order_id = ?
    `;

    db.query(updateQuery, [order_id], (err, result) => {
      if (err) {
        console.error("Error cancelling order:", err);
        return res.status(500).json({ 
          success: false, 
          message: "Error cancelling order" 
        });
      }

      res.json({ 
        success: true, 
        message: "Order cancelled successfully" 
      });
    });
  });
});

// 5. Get buyer's order statistics
app.get("/api/orders/buyer/:buyer_id/stats", isBuyerLoggedIn, (req, res) => {
  const { buyer_id } = req.params;

  const statsQuery = `
    SELECT 
      COUNT(*) as total_orders,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_orders,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_orders,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_orders,
      SUM(total_amount) as total_spent
    FROM orders 
    WHERE buyer_id = ?
  `;

  db.query(statsQuery, [buyer_id], (err, results) => {
    if (err) {
      console.error("Error fetching buyer stats:", err);
      return res.status(500).json({ 
        success: false, 
        message: "Error fetching statistics" 
      });
    }

    res.json({ 
      success: true, 
      stats: results[0] 
    });
  });
});

// 6. Get seller's orders
app.get("/api/orders/seller/:seller_id", isSellerLoggedIn, (req, res) => {
  const { seller_id } = req.params;

  console.log("📦 Fetching orders for seller:", seller_id);
  console.log("Session user:", req.session.user);

  const query = `
    SELECT 
  o.order_id,
  o.buyer_id,
  o.product_id,
  o.product_name,
  o.product_image,
  o.total_price,
  o.quantity,
  o.total_amount,
  o.status,
  o.order_date,
  b.name as buyer_name,
  b.email as buyer_email
FROM orders o
LEFT JOIN buyerdetails b ON o.buyer_id = b.buyer_id
WHERE o.seller_id = ?
  `;

  db.query(query, [seller_id], (err, results) => {
    if (err) {
      console.error("❌ Error fetching seller orders:", err);
      return res.status(500).json({ 
        success: false, 
        message: "Error fetching orders: " + err.message 
      });
    }

    console.log(`✅ Found ${results.length} orders for seller ${seller_id}`);
    
    // Debug: Log first few order IDs
    if (results.length > 0) {
      console.log("Sample order IDs from database:");
      results.slice(0, 5).forEach((order, index) => {
        console.log(`  Order ${index + 1}: ID=${order.order_id}, Product=${order.product_name}, Buyer=${order.buyer_id}, ProductID=${order.product_id}`);
      });
    }

    res.json({ 
      success: true, 
      orders: results 
    });
  });
});

// 4. Update order status (Seller side)
app.put("/api/orders/:order_id/status", isSellerLoggedIn, (req, res) => {
  const { order_id } = req.params;
  const { status } = req.body;
  const seller_id = req.session.user.seller_id;

  console.log(`📝 Update order status request:`, { order_id, status, seller_id });
  console.log(`Session user:`, req.session.user);

  // Validate status
  const validStatuses = ['pending', 'out_for_delivery', 'delivered'];
  if (!validStatuses.includes(status)) {
    console.log(`❌ Invalid status: ${status}`);
    return res.status(400).json({ 
      success: false, 
      message: "Invalid status. Must be: pending, out_for_delivery, or delivered" 
    });
  }

  const query = `
    UPDATE orders 
    SET status = ?
    WHERE order_id = ? AND seller_id = ?
  `;

  db.query(query, [status, order_id, seller_id], (err, result) => {
    if (err) {
      console.error("❌ Error updating order status:", err);
      return res.status(500).json({ 
        success: false, 
        message: "Error updating order status: " + err.message 
      });
    }

    console.log(`Database result:`, result);

    if (result.affectedRows === 0) {
      console.log(`⚠️ No rows affected - order ${order_id} not found or doesn't belong to seller ${seller_id}`);
      return res.status(404).json({ 
        success: false, 
        message: "Order not found or you don't have permission to update it" 
      });
    }

    console.log(`✅ Order ${order_id} status updated to: ${status}`);

    res.json({ 
      success: true, 
      message: "Order status updated successfully" 
    });
  });
});

// 5. Get order statistics for seller
app.get("/api/orders/seller/:seller_id/stats", isSellerLoggedIn, (req, res) => {
  const { seller_id } = req.params;

  const query = `
    SELECT 
      COUNT(*) as total_orders,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_count,
      SUM(CASE WHEN status = 'out_for_delivery' THEN 1 ELSE 0 END) as out_for_delivery_count,
      SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered_count,
      SUM(total_amount) as total_revenue
    FROM orders
    WHERE seller_id = ?
  `;

  db.query(query, [seller_id], (err, results) => {
    if (err) {
      console.error("Error fetching order stats:", err);
      return res.status(500).json({ 
        success: false, 
        message: "Error fetching statistics" 
      });
    }

    res.json({ 
      success: true, 
      stats: results[0] 
    });
  });
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ message: "Logged out" });
  });
});

app.get("/check-session", (req, res) => {
  console.log("🔍 Check session called:");
  console.log("   Session ID:", req.sessionID);
  console.log("   Session user:", req.session.user);
  console.log("   Cookies:", req.headers.cookie);
  
  if (req.session.user) {
    console.log("   ✅ Session valid:", req.session.user.role, req.session.user.seller_id || req.session.user.buyer_id);
    res.json({
      loggedIn: true,
      user: req.session.user
    });
  } else {
    console.log("   ❌ No session found");
    res.json({ loggedIn: false });
  }
});
// ===== FORGOT PASSWORD - SEND OTP =====
app.post("/forgot-password", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Email is required" });
  }

  try {
    // Check if email exists in any of the tables
    const adminQuery = "SELECT email FROM admindetails WHERE email = ?";
    const sellerQuery = "SELECT email FROM sellerdetails WHERE email = ?";
    const buyerQuery = "SELECT email FROM buyerdetails WHERE email = ?";

    let emailExists = false;
    let userType = "";

    // Check admin
    const [adminResult] = await new Promise((resolve, reject) => {
      db.query(adminQuery, [email], (err, result) => {
        if (err) reject(err);
        else resolve([result]);
      });
    });

    if (adminResult.length > 0) {
      emailExists = true;
      userType = "admin";
    }

    // Check seller if not found in admin
    if (!emailExists) {
      const [sellerResult] = await new Promise((resolve, reject) => {
        db.query(sellerQuery, [email], (err, result) => {
          if (err) reject(err);
          else resolve([result]);
        });
      });

      if (sellerResult.length > 0) {
        emailExists = true;
        userType = "seller";
      }
    }

    // Check buyer if not found in seller
    if (!emailExists) {
      const [buyerResult] = await new Promise((resolve, reject) => {
        db.query(buyerQuery, [email], (err, result) => {
          if (err) reject(err);
          else resolve([result]);
        });
      });

      if (buyerResult.length > 0) {
        emailExists = true;
        userType = "buyer";
      }
    }

    if (!emailExists) {
      return res.status(404).json({ message: "Email not registered" });
    }

    // Generate 6-digit OTP
    const otp = crypto.randomInt(100000, 999999).toString();

    // Store OTP with expiry (5 minutes)
    const expiryTime = Date.now() + 5 * 60 * 1000; // 5 minutes
    otpStorage.set(email, {
      otp: otp,
      expiry: expiryTime,
      userType: userType,
      verified: false
    });

    // Send OTP via email
    const mailOptions = {
      from: 'NovaConnect <rastogishalvi19@gmail.com>',
      to: email,
      subject: 'Password Reset OTP - NovaConnect',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8f9fa; border-radius: 10px;">
          <div style="background: linear-gradient(135deg, #667eea, #764ba2); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0;">NovaConnect</h1>
            <p style="color: white; margin: 10px 0 0 0;">Password Reset Request</p>
          </div>
          
          <div style="background: white; padding: 30px; border-radius: 0 0 10px 10px;">
            <h2 style="color: #333; margin-top: 0;">Reset Your Password</h2>
            <p style="color: #666; line-height: 1.6;">
              We received a request to reset your password. Use the OTP below to proceed:
            </p>
            
            <div style="background: #f0f4ff; border-left: 4px solid #667eea; padding: 20px; margin: 25px 0; text-align: center;">
              <p style="color: #666; margin: 0 0 10px 0; font-size: 14px;">Your OTP is:</p>
              <h1 style="color: #667eea; font-size: 36px; margin: 0; letter-spacing: 8px; font-weight: bold;">${otp}</h1>
            </div>
            
            <p style="color: #666; line-height: 1.6;">
              <strong>This OTP will expire in 5 minutes.</strong>
            </p>
            
            <p style="color: #666; line-height: 1.6; margin-top: 20px;">
              If you didn't request a password reset, please ignore this email or contact support if you have concerns.
            </p>
            
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
            
            <p style="color: #999; font-size: 12px; text-align: center; margin: 0;">
              This is an automated email from NovaConnect. Please do not reply to this email.
            </p>
          </div>
        </div>
      `
    };

    try {
      await transporter.sendMail(mailOptions);
      console.log(`✅ OTP sent successfully to ${email}`);
      
      res.json({
        message: "OTP has been sent to your email. Please check your inbox."
      });
    } catch (emailError) {
      console.error("❌ Email sending error:", emailError);
      res.status(500).json({
        message: "Failed to send OTP. Please try again later."
      });
    }

  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// ===== VERIFY OTP =====
app.post("/verify-otp", (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ message: "Email and OTP are required" });
  }

  const storedData = otpStorage.get(email);

  if (!storedData) {
    return res.status(400).json({ message: "No OTP found for this email" });
  }

  // Check if OTP expired
  if (Date.now() > storedData.expiry) {
    otpStorage.delete(email);
    return res.status(400).json({ message: "OTP has expired" });
  }

  // Verify OTP
  if (storedData.otp !== otp) {
    return res.status(400).json({ message: "Invalid OTP" });
  }

  // Mark as verified
  storedData.verified = true;
  otpStorage.set(email, storedData);

  res.json({ message: "OTP verified successfully" });
});

// ===== RESET PASSWORD =====
app.post("/reset-password", async (req, res) => {
  const { email, newPassword } = req.body;

  if (!email || !newPassword) {
    return res.status(400).json({ message: "Email and new password are required" });
  }

  const storedData = otpStorage.get(email);

  if (!storedData || !storedData.verified) {
    return res.status(400).json({ message: "OTP not verified" });
  }

  try {
    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password based on user type
    let updateQuery = "";
    const userType = storedData.userType;

    if (userType === "admin") {
      updateQuery = "UPDATE admindetails SET hashedPassword = ? WHERE email = ?";
    } else if (userType === "seller") {
      updateQuery = "UPDATE sellerdetails SET hashedPassword = ? WHERE email = ?";
    } else if (userType === "buyer") {
      updateQuery = "UPDATE buyerdetails SET hashedPassword = ? WHERE email = ?";
    }

    db.query(updateQuery, [hashedPassword, email], (err, result) => {
      if (err) {
        console.error("Password update error:", err);
        return res.status(500).json({ message: "Error updating password" });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({ message: "User not found" });
      }

      // Clear OTP data after successful password reset
      otpStorage.delete(email);

      res.json({ message: "Password reset successfully" });
    });

  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/admin/buyers", isAdminLoggedIn, (req,res)=>{

db.query(
"SELECT * FROM buyerdetails",
(err,result)=>{

if(err){
console.log(err);
return res.status(500).json({message:"Database error"});
}

res.json(result);

});

});
app.delete("/admin/delete-seller/:id", (req,res)=>{

const sellerId = req.params.id;

db.query(
"DELETE FROM sellerdetails WHERE seller_id = ?",
[sellerId],
(err,result)=>{

if(err){
console.log(err);
return res.status(500).json({message:"Delete failed"});
}

res.json({message:"Seller deleted successfully"});
});

});
app.delete("/admin/delete-buyer/:id",(req,res)=>{

const buyerId = req.params.id;

db.query(
"DELETE FROM buyerdetails WHERE buyer_id = ?",
[buyerId],
(err,result)=>{

if(err){
console.log(err);
return res.status(500).json({message:"Delete failed"});
}

res.json({message:"Buyer deleted"});
});

});

//
app.put("/api/orders/:id/cancel", async (req, res) => {
  const orderId = req.params.id;

  try {
    await db.query(
  "UPDATE orders SET status = 'cancelled', cancelled_by = 'buyer' WHERE order_id = ?",
  [orderId]
);

    res.json({ success: true, message: "Order cancelled" });
  } catch (err) {
    console.error(err);
    res.json({ success: false });
  }
});

//
app.put("/api/orders/:id/cancel", async (req, res) => {
  const orderId = req.params.id;

  try {
    // 1. Get order
    const [rows] = await db.query(
      "SELECT * FROM orders WHERE order_id = ?",
      [orderId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Order not found" });
    }

    const order = rows[0];

    // 2. Check status
    if (order.status === "delivered") {
      return res.json({ message: "Cannot cancel delivered order" });
    }

    if (order.status === "cancelled") {
      return res.json({ message: "Already cancelled" });
    }

    // 3. Update order status
    await db.query(
      "UPDATE orders SET status = 'cancelled' WHERE order_id = ?",
      [orderId]
    );

    // 4. Restore quantity
    await db.query(
      "UPDATE products SET quantity = quantity + ? WHERE product_id = ?",
      [order.quantity, order.product_id]
    );

    res.json({ success: true, message: "Order cancelled" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

//=========ADMIN==================

app.get("/seller/current", isSellerLoggedIn, (req, res) => {

  const sellerId = req.session.user.seller_id;

  const sql = "SELECT seller_id, name, email, smartcard_id, hostel FROM sellerdetails WHERE seller_id = ?";

  db.query(sql, [sellerId], (err, result) => {

    if (err) {
      console.log(err);
      return res.status(500).json({ message: "Database error" });
    }

    if (result.length === 0) {
      return res.status(404).json({ message: "Seller not found" });
    }

    res.json(result[0]);

  });

});
app.get("/admin/sellers", isAdminLoggedIn, (req,res)=>{

db.query(
"SELECT * FROM sellerdetails",
(err,result)=>{

if(err){
console.log(err);
return res.status(500).json({message:"Database error"});
}

res.json(result);

});

});
app.get("/admin/buyers", isAdminLoggedIn, (req,res)=>{

db.query(
"SELECT * FROM buyerdetails",
(err,result)=>{

if(err){
console.log(err);
return res.status(500).json({message:"Database error"});
}

res.json(result);

});

});
app.delete("/admin/delete-seller/:id", (req,res)=>{

const sellerId = req.params.id;

db.query(
"DELETE FROM sellerdetails WHERE seller_id = ?",
[sellerId],
(err,result)=>{

if(err){
console.log(err);
return res.status(500).json({message:"Delete failed"});
}

res.json({message:"Seller deleted successfully"});
});

});
app.delete("/admin/delete-buyer/:id",(req,res)=>{

const buyerId = req.params.id;

db.query(
"DELETE FROM buyerdetails WHERE buyer_id = ?",
[buyerId],
(err,result)=>{

if(err){
console.log(err);
return res.status(500).json({message:"Delete failed"});
}

res.json({message:"Buyer deleted"});
});

});


app.get("/admin/products", (req,res)=>{

const sql = "SELECT * FROM product";

db.query(sql,(err,result)=>{
if(err) return res.status(500).json(err);
res.json(result);
});

});
const fs = require("fs");

app.delete("/admin/delete-product/:id", (req, res) => {

  const id = req.params.id;

  // 1️⃣ Get image name first
  const getImageSql = "SELECT image FROM product WHERE product_id = ?";

  db.query(getImageSql, [id], (err, result) => {

    if (err) {
      console.log(err);
      return res.status(500).json({ message: "Error fetching product" });
    }

    if (result.length === 0) {
      return res.status(404).json({ message: "Product not found" });
    }

    const imageName = result[0].image;

    // 2️⃣ Delete image from folder
    const imagePath = path.join(__dirname, "images", imageName);

    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
      console.log("Image deleted:", imageName);
    }

    // 3️⃣ Delete product from DB
    const deleteSql = "DELETE FROM product WHERE product_id = ?";

    db.query(deleteSql, [id], (err2) => {

      if (err2) {
        console.log(err2);
        return res.status(500).json({ message: "Delete failed" });
      }

      res.json({ message: "Product + Image deleted successfully" });

    });

  });

});
app.delete("/admin/delete-all-products", (req, res) => {

  const getImagesSql = "SELECT image FROM product";

  db.query(getImagesSql, (err, results) => {

    if (err) {
      console.log(err);
      return res.status(500).json({ message: "Error fetching products" });
    }

    // Delete all images
    results.forEach(item => {
      const imagePath = path.join(__dirname, "images", item.image);

      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }
    });

    // Delete all products from DB
    db.query("DELETE FROM product", (err2) => {

      if (err2) {
        console.log(err2);
        return res.status(500).json({ message: "Delete all failed" });
      }

      res.json({ message: "All products deleted successfully" });

    });

  });

});
app.delete("/admin/delete-all-sellers", (req, res) => {

  db.query("DELETE FROM sellerdetails", (err) => {
    if (err) {
      console.log(err);
      return res.status(500).json({ message: "Delete all sellers failed" });
    }

    res.json({ message: "All sellers deleted successfully" });
  });

});
app.delete("/admin/delete-all-buyers", (req, res) => {

  db.query("DELETE FROM buyerdetails", (err) => {
    if (err) {
      console.log(err);
      return res.status(500).json({ message: "Delete all buyers failed" });
    }

    res.json({ message: "All buyers deleted successfully" });
  });

});



app.post("/api/complaints", async (req, res) => {
  try {
    console.log("Complaint request body:", req.body);
    console.log("Complaint session user:", req.session ? req.session.user : null);

    const { product, type, text } = req.body;

    if (!req.session.user || req.session.user.role !== "buyer") {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: please log in as a buyer"
      });
    }

    const buyerId = req.session.user.buyer_id;

    if (!buyerId || buyerId === '0') {
      return res.status(401).json({ success: false, message: "Unauthorized: invalid buyer session." });
    }

    if (!product || !type || !text) {
      return res.status(400).json({ success: false, message: "Please fill in all complaint fields." });
    }

    const query = `
      INSERT INTO complaints (buyer_id, product, type, text, date)
      VALUES (?, ?, ?, ?, NOW())
    `;

    db.query(query, [buyerId, product, type, text], (err, result) => {
      if (err) {
        console.error("DB error on complaint insert:", err);
        return res.status(500).json({ success: false, message: "Database error while saving complaint" });
      }

      res.json({
        success: true,
        message: "Complaint saved in database"
      });
    });

  } catch (err) {
    console.error("Server error in /api/complaints:", err);
    res.status(500).json({ success: false, message: "Server error while submitting complaint" });
  }
});

//***************************** supprot center */
app.get("/api/admin/complaints", (req, res) => {

  const sql = "SELECT * FROM complaints ORDER BY date DESC";

  db.query(sql, (err, result) => {
    if (err) {
      console.log("Fetch complaints error:", err);
      return res.status(500).json({ message: "Database error" });
    }

    res.json(result);
  });

});
app.delete("/api/admin/complaints/:id", (req, res) => {
  const { id } = req.params;

  const sql = "DELETE FROM complaints WHERE id = ?";

  db.query(sql, [id], (err, result) => {
    if (err) {
      console.log(err);
      return res.status(500).json({ message: "Delete failed" });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Complaint not found" });
    }

    res.json({ message: "Complaint resolved successfully" });
  });
});

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});