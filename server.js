const express = require("express")
const bodyParser = require("body-parser")
const chalk = require("chalk")
const qrcode = require("qrcode")
const path = require("path")
const crypto = require("crypto")
const session = require("express-session")
const app = express()

// Constants
const DEFAULT_NMID = "ID123456789012"
const MERCHANT_NAME = "PAYMU-WANZOFC"
const MERCHANT_CITY = "DKI JAKARTA"
const MERCHANT_COUNTRY_CODE = "ID"
const MERCHANT_CATEGORY_CODE = "5499"
const GLOBALLY_UNIQUE_IDENTIFIER = "id.co.qris.demo"

// In-memory database (replace with real DB in production)
const users = []
const transactions = []
const games = [
  { id: "ml", name: "Mobile Legends", image: "/images/ml.jpg", currency: "Diamonds" },
  { id: "ff", name: "Free Fire", image: "/images/ff.jpg", currency: "Diamonds" },
  { id: "pubg", name: "PUBG Mobile", image: "/images/pubg.jpg", currency: "UC" },
  { id: "genshin", name: "Genshin Impact", image: "/images/genshin.jpg", currency: "Genesis Crystals" },
  { id: "valorant", name: "Valorant", image: "/images/valorant.jpg", currency: "Valorant Points" },
  { id: "codm", name: "Call of Duty Mobile", image: "/images/codm.jpg", currency: "CP" },
]

// Middleware
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))
app.use(express.static(path.join(__dirname, "public")))
app.use(
  session({
    secret: "paymu-secret-key",
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }, // 24 hours
  }),
)

app.set("view engine", "ejs")
app.set("views", path.join(__dirname, "views"))

// Helper functions
function formatTLV(tag, value) {
  if (value === null || value === undefined || String(value).trim() === "") return ""
  const valueStr = String(value)
  const length = valueStr.length.toString().padStart(2, "0")
  return `${tag}${length}${valueStr}`
}

function crc16ccitt(data) {
  let crc = 0xffff
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = (crc << 1) ^ 0x1021
      } else {
        crc <<= 1
      }
    }
  }
  return (crc & 0xffff).toString(16).toUpperCase().padStart(4, "0")
}

function generateManualQrisPayload(config) {
  let payload = ""
  payload += formatTLV("00", "01")
  const poiMethod = config.amount && Number.parseFloat(config.amount) > 0 ? "12" : "11"
  payload += formatTLV("01", poiMethod)
  let merchantAccountInfo = ""
  merchantAccountInfo += formatTLV("00", config.globallyUniqueIdentifier)
  merchantAccountInfo += formatTLV("02", config.nmid)
  payload += formatTLV("26", merchantAccountInfo)
  payload += formatTLV("52", config.merchantCategoryCode)
  payload += formatTLV("53", "360")
  if (poiMethod === "12" && config.amount) {
    const amountStr = Number.parseFloat(config.amount).toFixed(2).toString()
    payload += formatTLV("54", amountStr)
  }
  payload += formatTLV("58", config.merchantCountryCode)
  payload += formatTLV("59", config.merchantName.substring(0, 25))
  payload += formatTLV("60", config.merchantCity.substring(0, 15))
  payload += "6304"
  const crcValue = crc16ccitt(payload)
  payload += crcValue
  return payload
}

// Authentication middleware
function isAuthenticated(req, res, next) {
  if (req.session.user) {
    return next()
  }
  res.redirect("/login")
}

// Routes
app.get("/", (req, res) => {
  res.render("home", {
    user: req.session.user || null,
    games: games,
  })
})

app.get("/register", (req, res) => {
  if (req.session.user) {
    return res.redirect("/dashboard")
  }
  res.render("register", { error: null })
})

app.post("/register", (req, res) => {
  const { username, email, password, confirmPassword } = req.body

  // Basic validation
  if (!username || !email || !password || !confirmPassword) {
    return res.render("register", { error: "Semua field harus diisi" })
  }

  if (password !== confirmPassword) {
    return res.render("register", { error: "Password tidak cocok" })
  }

  // Check if user already exists
  if (users.find((u) => u.email === email || u.username === username)) {
    return res.render("register", { error: "Username atau email sudah terdaftar" })
  }

  // Create new user
  const newUser = {
    id: crypto.randomUUID(),
    username,
    email,
    password, // In production, hash this password!
    balance: 0,
    createdAt: new Date(),
    transactions: [],
  }

  users.push(newUser)

  // Auto login after registration
  req.session.user = {
    id: newUser.id,
    username: newUser.username,
    email: newUser.email,
    balance: newUser.balance,
  }

  res.redirect("/dashboard")
})

app.get("/login", (req, res) => {
  if (req.session.user) {
    return res.redirect("/dashboard")
  }
  res.render("login", { error: null })
})

app.post("/login", (req, res) => {
  const { email, password } = req.body

  // Find user
  const user = users.find((u) => u.email === email && u.password === password)

  if (!user) {
    return res.render("login", { error: "Email atau password salah" })
  }

  // Set session
  req.session.user = {
    id: user.id,
    username: user.username,
    email: user.email,
    balance: user.balance,
  }

  res.redirect("/dashboard")
})

app.get("/logout", (req, res) => {
  req.session.destroy()
  res.redirect("/")
})

app.get("/dashboard", isAuthenticated, (req, res) => {
  const userTransactions = transactions.filter((t) => t.userId === req.session.user.id)

  // Get updated user balance
  const user = users.find((u) => u.id === req.session.user.id)
  if (user) {
    req.session.user.balance = user.balance
  }

  res.render("dashboard", {
    user: req.session.user,
    transactions: userTransactions,
  })
})

app.get("/deposit", isAuthenticated, (req, res) => {
  res.render("deposit", {
    user: req.session.user,
    defaultNmid: DEFAULT_NMID,
    merchantName: MERCHANT_NAME,
    merchantCity: MERCHANT_CITY,
  })
})

app.post("/generate-qris", isAuthenticated, async (req, res) => {
  const { amount } = req.body

  if (!amount || isNaN(amount) || Number.parseFloat(amount) <= 0) {
    return res.status(400).json({ success: false, message: "Jumlah tidak valid" })
  }

  try {
    const qrisConfig = {
      nmid: DEFAULT_NMID,
      merchantName: MERCHANT_NAME,
      merchantCity: MERCHANT_CITY,
      merchantCountryCode: MERCHANT_COUNTRY_CODE,
      merchantCategoryCode: MERCHANT_CATEGORY_CODE,
      globallyUniqueIdentifier: GLOBALLY_UNIQUE_IDENTIFIER,
      amount: Number.parseFloat(amount),
    }

    const qrisPayload = generateManualQrisPayload(qrisConfig)
    const qrCodeImage = await qrcode.toDataURL(qrisPayload)

    // Create transaction record
    const transaction = {
      id: crypto.randomUUID(),
      userId: req.session.user.id,
      type: "deposit",
      amount: Number.parseFloat(amount),
      status: "pending",
      createdAt: new Date(),
      qrisPayload,
    }

    transactions.push(transaction)

    res.json({
      success: true,
      qrImage: qrCodeImage,
      transactionId: transaction.id,
      amount: Number.parseFloat(amount),
    })
  } catch (error) {
    console.error("Error generating QRIS:", error)
    res.status(500).json({ success: false, message: "Gagal membuat QRIS" })
  }
})

app.post("/confirm-payment", isAuthenticated, (req, res) => {
  const { transactionId } = req.body

  // Find transaction
  const transaction = transactions.find((t) => t.id === transactionId && t.userId === req.session.user.id)

  if (!transaction) {
    return res.status(404).json({ success: false, message: "Transaksi tidak ditemukan" })
  }

  // Update transaction status (in real app, this would be done by payment callback)
  transaction.status = "completed"

  // Update user balance
  const user = users.find((u) => u.id === req.session.user.id)
  if (user) {
    user.balance += transaction.amount
    req.session.user.balance = user.balance
  }

  res.json({ success: true, newBalance: user.balance })
})

app.get("/topup/:gameId", isAuthenticated, (req, res) => {
  const { gameId } = req.params
  const game = games.find((g) => g.id === gameId)

  if (!game) {
    return res.redirect("/dashboard")
  }

  res.render("topup", {
    user: req.session.user,
    game: game,
    packages: [
      { id: 1, name: `${game.currency} Small`, amount: 50, price: 10000 },
      { id: 2, name: `${game.currency} Medium`, amount: 150, price: 25000 },
      { id: 3, name: `${game.currency} Large`, amount: 300, price: 45000 },
      { id: 4, name: `${game.currency} XL`, amount: 500, price: 70000 },
      { id: 5, name: `${game.currency} XXL`, amount: 1000, price: 130000 },
    ],
  })
})

app.post("/process-topup", isAuthenticated, (req, res) => {
  const { gameId, packageId, gameUserId, gameServer } = req.body

  const game = games.find((g) => g.id === gameId)
  if (!game) {
    return res.status(400).json({ success: false, message: "Game tidak ditemukan" })
  }

  // Find package (in real app, this would come from database)
  const packages = [
    { id: 1, name: `${game.currency} Small`, amount: 50, price: 10000 },
    { id: 2, name: `${game.currency} Medium`, amount: 150, price: 25000 },
    { id: 3, name: `${game.currency} Large`, amount: 300, price: 45000 },
    { id: 4, name: `${game.currency} XL`, amount: 500, price: 70000 },
    { id: 5, name: `${game.currency} XXL`, amount: 1000, price: 130000 },
  ]

  const selectedPackage = packages.find((p) => p.id === Number.parseInt(packageId))
  if (!selectedPackage) {
    return res.status(400).json({ success: false, message: "Paket tidak ditemukan" })
  }

  // Check user balance
  const user = users.find((u) => u.id === req.session.user.id)
  if (!user || user.balance < selectedPackage.price) {
    return res.status(400).json({ success: false, message: "Saldo tidak mencukupi" })
  }

  // Create transaction
  const transaction = {
    id: crypto.randomUUID(),
    userId: req.session.user.id,
    type: "topup",
    gameId,
    gameUserId,
    gameServer: gameServer || "N/A",
    packageName: selectedPackage.name,
    amount: selectedPackage.amount,
    price: selectedPackage.price,
    status: "completed",
    createdAt: new Date(),
  }

  // Update user balance
  user.balance -= selectedPackage.price
  req.session.user.balance = user.balance

  // Save transaction
  transactions.push(transaction)

  res.json({
    success: true,
    transaction,
    newBalance: user.balance,
  })
})

app.get("/transactions", isAuthenticated, (req, res) => {
  const userTransactions = transactions.filter((t) => t.userId === req.session.user.id)

  res.render("transactions", {
    user: req.session.user,
    transactions: userTransactions,
    games: games,
  })
})

// Legacy routes
app.get("/order", (req, res) => {
  const { amount, nmid } = req.query
  if (!amount) {
    return res.status(400).render("transaksi", {
      message: "Jumlah (amount) wajib diisi untuk membuat pesanan dari URL.",
      details: "Pastikan parameter 'amount' ada dan berisi nilai numerik.",
    })
  }
  const targetNmid = nmid || DEFAULT_NMID
  res.redirect(`/?amount=${encodeURIComponent(amount)}&nmid=${encodeURIComponent(targetNmid)}&autosubmit=true`)
})

app.get("/orderkuota/createpayment", async (req, res) => {
  const { amount, nmid } = req.query
  if (!amount) {
    return res.status(400).json({ status: false, error: "Parameter 'amount' is required." })
  }
  const currentNmid = nmid || DEFAULT_NMID
  if (!currentNmid) {
    return res.status(400).json({ status: false, error: "NMID is missing." })
  }
  const numericAmount = Number.parseFloat(amount)
  if (isNaN(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ status: false, error: "Parameter 'amount' harus angka positif." })
  }
  try {
    const qrisConfig = {
      nmid: currentNmid,
      merchantName: MERCHANT_NAME,
      merchantCity: MERCHANT_CITY,
      merchantCountryCode: MERCHANT_COUNTRY_CODE,
      merchantCategoryCode: MERCHANT_CATEGORY_CODE,
      globallyUniqueIdentifier: GLOBALLY_UNIQUE_IDENTIFIER,
      amount: numericAmount,
    }
    const qrisPayload = generateManualQrisPayload(qrisConfig)
    const qrCodeImage = await qrcode.toDataURL(qrisPayload)
    res.json({
      status: true,
      message: "QRIS Payment created successfully.",
      data: {
        nmid: currentNmid,
        amount: numericAmount,
        merchantName: MERCHANT_NAME,
        merchantCity: MERCHANT_CITY,
        qrisPayloadString: qrisPayload,
        qrCodeImageDataUrl: qrCodeImage,
      },
    })
  } catch (error) {
    res.status(500).json({ status: false, error: "Failed to generate QRIS payment.", details: error.message })
  }
})

app.get("/orderkuota/cekstatus", async (req, res) => {
  const { merchant, keyorkut } = req.query
  if (!merchant || !keyorkut) {
    return res.status(400).json({ status: false, error: "Parameters 'merchant' and 'keyorkut' are required." })
  }
  const possibleStatus = ["PENDING", "SUCCESS", "FAILED"]
  const randomStatus = possibleStatus[Math.floor(Math.random() * possibleStatus.length)]
  res.json({
    status: true,
    message: "Cek Status endpoint called (mocked).",
    data: { orderId: keyorkut, merchant: merchant, paymentStatus: randomStatus, timestamp: new Date().toISOString() },
  })
})

app.post("/topup", async (req, res) => {
  const { product, amount, transactionId, userIdGame } = req.body
  if (!product || !amount || !transactionId || !userIdGame) {
    return res
      .status(400)
      .json({ status: false, error: "Parameters 'product', 'amount', 'transactionId', and 'userIdGame' are required." })
  }
  res.json({
    status: true,
    message: "Top up request received and is being processed.",
    data: { product, amount, userIdGame, transactionId, topUpStatus: "PROCESSING" },
  })
})

const port = process.env.PORT || 3000
app.listen(port, () => {
  console.log(chalk.cyan(`Server running on port ${port}`))
  console.log(chalk.yellow(`Frontend: http://localhost:${port}`))
  console.log(chalk.green(`Register: http://localhost:${port}/register`))
  console.log(chalk.green(`Login: http://localhost:${port}/login`))
})
