import express from 'express'
import sqlite3 from 'sqlite3'

// set up express web server
const app = express()

// set up static content and ejs views
app.use(express.static('public'))
app.set('view engine', 'ejs')

// open database
process.env.DATABASE_PATH ||= './db.sqlite3'
const db = new sqlite3.Database(process.env.DATABASE_PATH)

// last known count
let count = 0

// Main page
app.get('/', async(_request, response) => {
  // increment count, creating table row if necessary
  await new Promise((resolve, reject) => {
    db.get('SELECT "count" from "welcome"', (err, row) => {
      let query = 'UPDATE "welcome" SET "count" = ?'

      if (err) {
        reject(err)
        return
      } else if (row) {
        count = row.count + 1
      } else {
        count = 1
        query = 'INSERT INTO "welcome" VALUES(?)'
      }

      db.run(query, [count], err => {
        err ? reject(err) : resolve()
      })
    })
  })

  // render HTML response
  response.render('index', { count });
})

// Ensure welcome table exists
db.run('CREATE TABLE IF NOT EXISTS "welcome" ( "count" INTEGER )')

// Start web server on port 3000
app.listen(3000, () => {
  console.log('Server is listening on port 3000')
})
