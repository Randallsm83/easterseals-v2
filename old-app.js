const express = require('express')
const sqlite3 = require('sqlite3').verbose()
const path = require('path')

const app = express()
const port = 8001

const db = new sqlite3.Database('es.db', (err) => {
  if (err) {
    throw err
  } else {
    console.log('Connected to the database.')
  }

  db.exec('PRAGMA foreign_keys = ON;', function (error) {
    if (error) {
      console.error("===ERROR=== Pragma statement didn't work.")
    } else {
      console.log('Foreign Key Enforcement is on.')
    }
  })

  db.serialize(() => {
    db.run('CREATE TABLE IF NOT EXISTS session_configuration (configId TEXT NOT NULL PRIMARY KEY, config TEXT)', [], (err) => {
      if (err) {
        throw err.message
      } else {
        console.log('Session config table setup is ready.')
      }
    })
  })

  db.serialize(() => {
    db.run('CREATE TABLE IF NOT EXISTS session_event_log (participantId TEXT NOT NULL, sessionId TEXT NOT NULL, configId TEXT NOT NULL, event TEXT, value TEXT, timestamp DATETIME, FOREIGN KEY (configId) REFERENCES session_configuration(configId))', [], (err) => {
      if (err) {
        throw err.message
      } else {
        console.log('Session event log table setup is ready.')
      }
    })
  })
})

app.set('view engine', 'pug')
app.set('views', path.join(__dirname, 'views'))

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.use(express.static('public'))
app.use('/favicon.ico', express.static('public/images/favicon.ico'))

app.get('/', (req, res) => {
  res.redirect('run')
})

// Show Setup
app.get('/setup', (req, res) => {
  res.render('setupForm', { currentPath: 'setup' })
})

// Save Setup
app.post('/setup', async (req, res) => {
  const data = req.body

  db.get('SELECT * FROM session_configuration WHERE configId = ?', [data.configId], (err, row) => {
    if (err) {
      console.error(err.message)
      res.status(500).send('Internal Server Error')
    } else if (row) {
      console.error('Configuration not saved, ID already exists.')
      res.status(400).send('Configuration ID already exists. Please enter a different one.')
    } else {
      if (data.buttonActive === 'none') {
        data.moneyAwarded = '0'
        data.awardInterval = '0'
        data.startingMoney = '0'
        data.moneyLimit = '0'
      } else {
        if (data.denominationInput === 'dollars') {
          data.moneyAwarded = (data.moneyAwarded * 100).toString()
          data.startingMoney = (data.startingMoney * 100).toString()
          data.moneyLimit = (data.moneyLimit * 100).toString()
        }
      }
      db.run('INSERT INTO session_configuration (configId, config) VALUES (?, ?)', [data.configId, JSON.stringify(data)], (err) => {
        if (err) {
          console.error(err.message)
          res.status(500).send('Internal Server Error')
        } else {
          console.log(`Logged config ${data.configId}`)
          res.render('setupForm', { currentPath: 'setup', submitStatus: true, configId: `${data.configId}` })
        }
      })
    }
  })
})

// Run Session Select
app.get('/run', (req, res) => {
  const query = 'SELECT DISTINCT configId FROM session_configuration ORDER BY configId ASC'

  db.all(query, [], (err, rows) => {
    if (err) {
      console.error(err.message)
      res.status(500).send('Internal Server Error')
    } else {
      res.render('sessionSelect', { currentPath: 'run', data: rows })
    }
  })
})

// Run Session
app.post('/run', (req, res) => {
  const data = req.body

  db.all('SELECT * FROM session_event_log WHERE participantId = ?', [data.participantId], (err, events) => {
    if (err) {
      console.error(err.message)
      res.status(500).send('Internal Server Error')
    } else {
      const newSessionId = events.reduce((max, item) => Math.max(max, parseInt(item.sessionId, 10)), 0) + 1

      db.get('SELECT * FROM session_configuration WHERE configId = ?', [data.configId], (err, config) => {
        if (err) {
          console.error(err.message)
          res.status(500).send('Internal Server Error')
        } else if (!config) {
          console.error('No config found')
          res.status(404).send('Config not found')
        } else {
          res.render('session', { currentPath: 'run', participantId: data.participantId, sessionId: newSessionId, config: JSON.parse(config.config) })
        }
      })
    }
  })
})

app.post('/log-event', (req, res) => {
  const { participantId, sessionId, configId, event } = req.body
  const timestamp = req.body.timestamp ? req.body.timestamp : new Date().toISOString()
  const value = JSON.stringify(req.body.value)

  db.run('INSERT INTO session_event_log (participantId, sessionId, configId, event, value, timestamp) VALUES (?, ?, ?, ?, ?, ?)', [participantId, sessionId, configId, event, value, timestamp], (err) => {
    if (err) {
      console.error(err.message)
    } else {
      console.log(`Logged event ${event} with value ${value}`)
      res.send('Logged event')
    }
  })
})

// View Session Select
app.get('/view', (req, res) => {
  const participantQuery = 'SELECT DISTINCT participantId FROM session_event_log ORDER BY participantId ASC'

  db.all(participantQuery, [], (err, participants) => {
    if (err) {
      console.error(err.message)
      res.status(500).send('Internal Server Error')
    } else {
      res.render('sessionGraphs', { currentPath: 'view', participants })
    }
  })
})

// Get Sessions For Participant
app.get('/view/:participantId', (req, res) => {
  const { participantId } = req.params
  const sessionQuery = 'SELECT DISTINCT sessionId FROM session_event_log WHERE participantId = ? ORDER BY sessionId ASC'

  db.all(sessionQuery, [participantId], (err, sessions) => {
    if (err) {
      console.error(err.message)
      res.status(500).send('Internal Server Error')
    } else {
      res.json(sessions)
    }
  })
})

// View Session Data
app.get('/view/:participantId/:sessionId', async (req, res) => {
  const participantId = req.params.participantId
  const sessionId = req.params.sessionId

  try {
    // Session Config
    const configId = await new Promise((resolve, reject) => {
      db.get('SELECT configId FROM session_event_log WHERE participantId = ? AND sessionId = ? LIMIT 1', [participantId, sessionId], (err, row) => {
        if (err) reject(err)
        else resolve(row)
      })
    })
    const sessionConfig = await new Promise((resolve, reject) => {
      db.get('SELECT config FROM session_configuration WHERE configId = ? LIMIT 1', [configId.configId], (err, row) => {
        if (err) reject(err)
        else resolve(row)
      })
    })

    // Session Start
    const startEvent = await new Promise((resolve, reject) => {
      db.get('SELECT value, timestamp FROM session_event_log WHERE participantId = ? AND sessionId = ? AND event = ? LIMIT 1', [participantId, sessionId, 'start'], (err, row) => {
        if (err) reject(err)
        else resolve(row)
      })
    })

    // Session End
    let endEvent = await new Promise((resolve, reject) => {
      db.get('SELECT value, timestamp FROM session_event_log WHERE participantId = ? AND sessionId = ? AND event = ? LIMIT 1', [participantId, sessionId, 'end'], (err, row) => {
        if (err) reject(err)
        else resolve(row)
      })
    })
    if (!endEvent) {
      endEvent = await new Promise((resolve, reject) => {
        db.get('SELECT value, timestamp FROM session_event_log WHERE participantId = ? AND sessionId = ? ORDER BY timestamp DESC LIMIT 1', [participantId, sessionId], (err, row) => {
          if (err) reject(err)
          else resolve(row)
        })
      })
    }

    // All Clicks
    const allClicks = await new Promise((resolve, reject) => {
      db.all('SELECT value, timestamp FROM session_event_log WHERE participantId = ? AND sessionId = ? AND event = ? ORDER BY timestamp ASC', [participantId, sessionId, 'click'], (err, rows) => {
        if (err) reject(err)
        else resolve(rows)
      })
    })
    const responseData = {
      sessionConfig,
      startEvent,
      endEvent,
      allClicks
    }
    res.json(responseData)
  } catch (error) {
    console.error('Error fetching session data:', error)
    res.status(500).send('Internal Server Error')
  }
})

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`)
})
