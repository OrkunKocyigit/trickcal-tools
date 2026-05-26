#!/usr/bin/env node
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const pkg = require('../package.json')
const dist = path.resolve(__dirname, '../dist')

let commit = 'unknown'
try {
  commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
} catch {}

const info = {
  version: pkg.version,
  buildTime: Date.now(),
  commit,
}

fs.mkdirSync(dist, { recursive: true })
fs.writeFileSync(path.join(dist, 'version.json'), JSON.stringify(info, null, 2))
