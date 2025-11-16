import { put } from '@vercel/blob';
import { v4 as uuidv4 } from 'uuid';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '15mb',
    },
  },
};

export default async function handler(req, res) {
  console.log('[upload-photo] method=%s content-type=%s tokenPresent=%s', req.method, req.headers['content-type'], !!process.env.BLOB_READ_WRITE_TOKEN);
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  try {
    const { image } = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    console.log('[upload-photo] bodyType=%s imagePresent=%s', typeof req.body, !!image);
    if (!image || typeof image !== 'string') {
      return res.status(400).json({ message: 'Invalid image payload' });
    }

    const base64 = image.replace(/^data:image\/png;base64,/, '');
    const buffer = Buffer.from(base64, 'base64');
    console.log('[upload-photo] base64Length=%d bufferBytes=%d', base64.length, buffer.byteLength);

    const fileName = `${uuidv4()}.png`;
    console.log('[upload-photo] start put -> %s', fileName);
    const blob = await put(fileName, buffer, {
      access: 'public',
      contentType: 'image/png',
    });
    console.log('[upload-photo] put ok url=%s', blob.url);

    return res.status(200).json({ url: blob.url });
  } catch (err) {
    console.error('Blob upload error:', err);
    return res.status(500).json({ message: 'Upload failed' });
  }
}


