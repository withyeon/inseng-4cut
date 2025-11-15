const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const path = require('path');

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

app.post('/send-photo', async (req, res) => {
  try {
    const { email, image } = req.body || {};
    if (!email || !image) {
      return res.status(400).json({ message: 'Missing email or image.' });
    }

    // Expecting data:image/png;base64,....
    const base64Data = image.replace(/^data:image\/png;base64,/, '');

    const fromAddress = process.env.GMAIL_USER || 'YOUR_GMAIL_EMAIL@gmail.com';
    const mailOptions = {
      from: fromAddress,
      to: email,
      subject: 'Your Chopiti Photo!',
      text: 'Here is your photo from the Chopiti Photo Booth!',
      attachments: [
        {
          filename: 'chopiti-photo.png',
          content: base64Data,
          encoding: 'base64',
        },
      ],
    };

    await transporter.sendMail(mailOptions);
    return res.status(200).json({ message: 'Email sent successfully!' });
  } catch (err) {
    console.error('Error sending email:', err);
    return res.status(500).json({ message: 'Error sending email.' });
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


