export function requireStaff(req, res, next) {
  if (!req.session?.staffId) return res.status(401).json({ error: "Please sign in" });
  next();
}
