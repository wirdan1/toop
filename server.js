const express = require('express');
const bodyParser = require('body-parser');
const chalk = require('chalk');
const qrcode = require('qrcode');
const path = require('path');
const app = express();
const DEFAULT_NMID = "ID123456789012";
const MERCHANT_NAME = "PAYMU-WANZOFC";
const MERCHANT_CITY = "DKI JAKARTA";
const MERCHANT_COUNTRY_CODE = "ID";
const MERCHANT_CATEGORY_CODE = "5499";
const GLOBALLY_UNIQUE_IDENTIFIER = "id.co.qris.demo";
// mashkin url qris lu contoh gopay atau dana 
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

function formatTLV(tag, value) {
    if (value === null || value === undefined || String(value).trim() === '') return '';
    const valueStr = String(value);
    const length = valueStr.length.toString().padStart(2, '0');
    return `${tag}${length}${valueStr}`;
}

function crc16ccitt(data) {
    let crc = 0xFFFF;
    for (let i = 0; i < data.length; i++) {
        crc ^= data.charCodeAt(i) << 8;
        for (let j = 0; j < 8; j++) {
            if ((crc & 0x8000) !== 0) {
                crc = (crc << 1) ^ 0x1021;
            } else {
                crc <<= 1;
            }
        }
    }
    return (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
}

function generateManualQrisPayload(config) {
    let payload = "";
    payload += formatTLV("00", "01");
    const poiMethod = config.amount && parseFloat(config.amount) > 0 ? "12" : "11";
    payload += formatTLV("01", poiMethod);
    let merchantAccountInfo = "";
    merchantAccountInfo += formatTLV("00", config.globallyUniqueIdentifier);
    merchantAccountInfo += formatTLV("02", config.nmid);
    payload += formatTLV("26", merchantAccountInfo);
    payload += formatTLV("52", config.merchantCategoryCode);
    payload += formatTLV("53", "360");
    if (poiMethod === "12" && config.amount) {
        const amountStr = parseFloat(config.amount).toFixed(2).toString();
        payload += formatTLV("54", amountStr);
    }
    payload += formatTLV("58", config.merchantCountryCode);
    payload += formatTLV("59", config.merchantName.substring(0, 25));
    payload += formatTLV("60", config.merchantCity.substring(0, 15));
    payload += "6304";
    const crcValue = crc16ccitt(payload);
    payload += crcValue;
    return payload;
}

app.get('/', (req, res) => {
  const prefillAmount = req.query.amount || '';
  const prefillNmid = req.query.nmid || DEFAULT_NMID;
  const autoSubmit = req.query.autosubmit === 'true';
  const errorFromRedirect = req.query.error || null;
  let initialMessage = null;

  if (errorFromRedirect === 'AmountIsRequiredFromOrder') {
    initialMessage = "Jumlah (amount) wajib diisi untuk membuat pesanan.";
  }

  res.render('index', {
    defaultNmid: DEFAULT_NMID,
    merchantName: MERCHANT_NAME,
    merchantCity: MERCHANT_CITY,
    prefillAmount: prefillAmount,
    prefillNmidForAction: prefillNmid,
    autoSubmit: autoSubmit,
    initialMessage: initialMessage,
    isError: errorFromRedirect ? true : false
  });
});

app.get('/order', (req, res) => {
    const { amount, nmid } = req.query;
    if (!amount) {
        return res.status(400).render('transaksi', {
            message: "Jumlah (amount) wajib diisi untuk membuat pesanan dari URL.",
            details: "Pastikan parameter 'amount' ada dan berisi nilai numerik."
        });
    }
    const targetNmid = nmid || DEFAULT_NMID;
    res.redirect(`/?amount=${encodeURIComponent(amount)}&nmid=${encodeURIComponent(targetNmid)}&autosubmit=true`);
});

app.get('/orderkuota/createpayment', async (req, res) => {
  let { amount, nmid } = req.query;
  if (!amount) {
    return res.status(400).json({ status: false, error: "Parameter 'amount' is required." });
  }
  const currentNmid = nmid || DEFAULT_NMID;
  if (!currentNmid) {
    return res.status(400).json({ status: false, error: "NMID is missing." });
  }
  const numericAmount = parseFloat(amount);
  if (isNaN(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ status: false, error: "Parameter 'amount' harus angka positif." });
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
    };
    const qrisPayload = generateManualQrisPayload(qrisConfig);
    const qrCodeImage = await qrcode.toDataURL(qrisPayload);
    res.json({
      status: true,
      message: 'QRIS Payment created successfully.',
      data: {
        nmid: currentNmid,
        amount: numericAmount,
        merchantName: MERCHANT_NAME,
        merchantCity: MERCHANT_CITY,
        qrisPayloadString: qrisPayload,
        qrCodeImageDataUrl: qrCodeImage,
      }
    });
  } catch (error) {
    res.status(500).json({ status: false, error: 'Failed to generate QRIS payment.', details: error.message });
  }
});

app.get('/orderkuota/cekstatus', async (req, res) => {
  const { merchant, keyorkut } = req.query;
  if (!merchant || !keyorkut) {
    return res.status(400).json({ status: false, error: "Parameters 'merchant' and 'keyorkut' are required." });
  }
  const possibleStatus = ['PENDING', 'SUCCESS', 'FAILED'];
  const randomStatus = possibleStatus[Math.floor(Math.random() * possibleStatus.length)];
  res.json({
    status: true,
    message: 'Cek Status endpoint called (mocked).',
    data: { orderId: keyorkut, merchant: merchant, paymentStatus: randomStatus, timestamp: new Date().toISOString() }
  });
});

app.post('/topup', async (req, res) => {
  const { product, amount, transactionId, userIdGame } = req.body;
  if (!product || !amount || !transactionId || !userIdGame) {
    return res.status(400).json({ status: false, error: "Parameters 'product', 'amount', 'transactionId', and 'userIdGame' are required." });
  }
  res.json({
    status: true,
    message: 'Top up request received and is being processed.',
    data: { product, amount, userIdGame, transactionId, topUpStatus: 'PROCESSING' }
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(chalk.cyan(`Server running on port ${port}`));
  console.log(chalk.yellow(`Frontend: http://localhost:${port}`));
  console.log(chalk.blue(`Coba akses /order: http://localhost:${port}/order?amount=25000`));
});
