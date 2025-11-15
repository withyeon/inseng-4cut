const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const path = require('path');
// Load .env if available (optional)
try {
  require('dotenv').config();
} catch (e) {
  // dotenv not installed; env vars can be provided by the environment
}

const app = express();
const DEFAULT_PORT = Number(process.env.PORT) || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' })); // Allow large base64 payloads
app.use(express.static('public')); // Serve frontend files

// Nodemailer (Gmail)
// IMPORTANT: Use a Gmail "App Password" (Google Account -> Security -> 2-Step Verification -> App Passwords).
// You can also set environment variables GMAIL_USER and GMAIL_APP_PASSWORD instead of editing the code.
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER || 'YOUR_GMAIL_EMAIL@gmail.com',
    pass: process.env.GMAIL_APP_PASSWORD || 'YOUR_GMAIL_APP_PASSWORD',
  },
});

if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
  console.warn(
    '[WARN] GMAIL_USER/GMAIL_APP_PASSWORD가 설정되지 않았습니다. 이메일 전송이 실패할 수 있습니다. ' +
    '로컬에서는 프로젝트 루트의 .env 파일에 GMAIL_USER, GMAIL_APP_PASSWORD를 설정하세요 (Google App Password 권장).'
  );
}
app.post('/send-photo', async (req, res) => {
  try {
    const { email, image } = req.body || {};
    if (!email || !image) {
      return res.status(400).json({ message: '이메일 주소 또는 이미지가 없습니다.' });
    }

    // Expecting data:image/png;base64,....
    const base64Data = image.replace(/^data:image\/png;base64,/, '');

    const fromAddress = process.env.GMAIL_USER || 'YOUR_GMAIL_EMAIL@gmail.com';
    const mailOptions = {
      from: fromAddress,
      to: email,
      subject: '인생네컷 사진이 도착했어요!',
      text: '촬영하신 인생네컷 사진을 첨부했습니다. 소중한 순간을 공유해 보세요!',
      attachments: [
        {
          filename: 'chopiti-photo.png',
          content: base64Data,
          encoding: 'base64',
        },
      ],
    };

    await transporter.sendMail(mailOptions);
    return res.status(200).json({ message: '이메일이 성공적으로 전송되었습니다.' });
  } catch (err) {
    console.error('Error sending email:', err);
    return res.status(500).json({ message: '이메일 전송 중 오류가 발생했습니다.' });
  }
});

function startServer(port, retries = 5) {
  const server = app.listen(port, () => {
    console.log(`Chopiti server running on http://localhost:${port}`);
  });
  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE' && retries > 0) {
      const nextPort = port + 1;
      console.warn(`Port ${port} is in use. Retrying on port ${nextPort}...`);
      startServer(nextPort, retries - 1);
      return;
    }
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

startServer(DEFAULT_PORT);


