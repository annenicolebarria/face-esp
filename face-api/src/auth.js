const jwt = require('jsonwebtoken')

function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '12h' })
}

function signAdminToken(admin) {
  return signToken({
    sub: admin.id,
    username: admin.username,
    role: 'admin',
    scope: 'admin',
  })
}

function signUserToken(user) {
  return signToken({
    sub: user.id,
    username: user.username,
    role: 'user',
    scope: 'user',
  })
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const [scheme, token] = header.split(' ')

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ message: 'Missing or invalid Authorization header.' })
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    req.auth = payload
    return next()
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token.' })
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.auth?.role) {
      return res.status(401).json({ message: 'Unauthorized.' })
    }
    if (!roles.includes(req.auth.role)) {
      return res.status(403).json({ message: 'Forbidden.' })
    }
    return next()
  }
}

module.exports = {
  signAdminToken,
  signUserToken,
  requireAuth,
  requireRole,
}
