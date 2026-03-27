const bcrypt = require('bcryptjs')

const raw = process.argv[2]

if (!raw) {
  console.error('Usage: npm run hash:password -- yourPasswordHere')
  process.exit(1)
}

const hash = bcrypt.hashSync(raw, 10)
console.log(hash)
