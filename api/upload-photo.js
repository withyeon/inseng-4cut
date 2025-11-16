import { put } from '@vercel/blob';
import { v4 as uuidv4 } from 'uuid';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  try {
    const { image } = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    if (!image || typeof image !== 'string') {
      return res.status(400).json({ message: 'Invalid image payload' });
    }

    const base64 = image.replace(/^data:image\/png;base64,/, '');
    const buffer = Buffer.from(base64, 'base64');

    const fileName = `${uuidv4()}.png`;
    const blob = await put(fileName, buffer, {
      access: 'public',
      contentType: 'image/png',
    });

    return res.status(200).json({ url: blob.url });
  } catch (err) {
    console.error('Blob upload error:', err);
    return res.status(500).json({ message: 'Upload failed' });
  }
}


