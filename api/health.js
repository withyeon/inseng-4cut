export default function handler(req, res) {
  console.log('[health] hit method=%s', req.method);
  res.status(200).json({ ok: true, method: req.method });
}


