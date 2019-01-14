/*
**  Requires
*/

const Irc = require('irc')
const Pino = require('pino')
const config = require('config')
const mysql = require('mysql')

/*
**  Config
*/

const pinoConfig = config.get('pinoConfig')
const ircConfig = config.get('irc')
const dbConfig = config.get('dbConfig')
// const urlWords = config.get('meta.urlWords')
// const streamerAliases = config.get('meta.streamerAliases')
const topicTrackingChannels = config.get('meta.topicTrackingChannels')

/*
**  Initialization
*/

const db = mysql.createConnection(dbConfig)
const client = new Irc.Client(ircConfig.server, ircConfig.name, ircConfig.config)
const log = Pino(pinoConfig)
// Killswitch for when things get hung up, ctrl+c twice to hit it
let forceKill = false

/*
**  Functions
*/

/*
** SQL COMMANDS
** LastPlayed: select * from sessions_view limit 1
** FirstPlayed: select * from sessions_view order by session_id asc limit 1
** TotalPlayed: call totalSession('%activity%', '%streamer%')
** totalSession requires you to pass '%%' as defaults, mysql doesn't
** allow for default parameters apparently.
**
** Unmapped Activities Count: select COUNT(activity_raw) as `Unmapped Activities Count` from activities_mapping where ISNULL(fk_activity_types)
** This is used to alert the operator if there's any wacky new activity types that aren't
** yet mapped to one of the few "normal" activities
**
** Start session: call newSession(streamer, activity, raw_topic, activity_type)
** Start session returns session_id and will call endSession() before starting a new one
** End session: call endSession()
*/

const parseTopic = (channel, topic, nick, message) => {
  // Short circuit if we get a topic message from a channel we don't care about
  if (!topicTrackingChannels.some(x => x === channel)) return null
  // Short circuit if we get a topic message from a source OTHER than a user
  if (message.command !== 'TOPIC') return null

  log.debug('Topic Change Detected:', topic)

  const streamers = getStreamers(topic)
  const activityType = getActivityType(topic)
  const activity = getActivity(activityType, topic)

  if (streamers && activity)
    startSession(streamers, activityType, activity, topic)
  else
    endSession()
}

const startSession = (streamers, activityType, activity, topicString) => {
  log.debug({
    session: {
      streamers,
      activityType,
      activity,
      topicString,
    }
  }, 'Starting session')
  // Don't worry about calling endSession first
  // newSession will automatically close any previous sessions
  db.query({
    sql: 'call newSession(?, ?, ?, ?)',
    values: [streamers, activity, topicString, activityType]
  }, (err, res) => {
    if (err) return log.error(err)
    const sessionId = res[0][0].session_id
    log.debug({ sessionId }, 'Session successfully started')
  })
  return null
}

const endSession = () => {
  log.debug('Ending session')
  db.query({ sql: 'call endSession()' }, (err, res) => {
    if (err) return log.error(err)
    log.debug({ results: res }, 'Session successfully ended')
  })
}

const getStreamers = str => {
  log.debug('Getting Streamers...')
  // TODO: Process on found streamers to:
  // strip funny characters
  const streamers = /Streamers?:(?:\s*)(.*?)(?:\s*)\|/.exec(str)
  log.debug({ streamers }, 'STREAMERS RESULT')
  return streamers[1].toLowerCase()
}

const getActivityType = str => {
  log.debug('Getting Activity Type...')
  // TODO: Process on found activity to:
  // strip funny characters
  const activityType = /\|(?:\s*)(\S+)(?:\s*):/.exec(str)
  log.debug({ activityType }, 'ACTIVITY TYPE RESULT')
  return activityType[1].toLowerCase()
}

const getActivity = (type, str) => {
  log.debug('Getting Activity...')
  // TODO: Process on found activity to:
  // strip funny characters
  const activity = (new RegExp(`${type}:(?:\\s*)(.*?)(?:\\s*)(?:\\||$)`, 'i')).exec(str)
  log.debug({ activity }, 'ACTIVITY RESULT')
  return activity[1].toLowerCase()
}

const parseMessage = (from, to, message) => {
  log.debug(from, to, message)
  // eslint-disable-next-line prefer-destructuring
  const parsedCommand = /^!(\S*)/.exec(message)
  const command = parsedCommand ? parsedCommand[1].toLowerCase() : ''
  if ((to[0] === '#' || to === ircConfig.name) && command) {
    if (to === ircConfig.name) to = from
    if (commands.hasOwnProperty(command)) {
      log.debug({ command }, `Command parsed: ${command}`)
      commands[command](from, to, message)
    } else
      log.debug({ command }, `Unrecognized Command given: ${command}`)
  }
}

const linkDiscord = (from, to) => {
  client.say(to, `${from}: https://discord.gg/R7cazz8`)
}

const linkOnDemand = (from, to) => {
  client.say(to, `${from}: http://vacker.tv/ondemand/`)
}

const parseOptions = str => {
  // g: game
  // t: type
  // s: streamer
  const g = /g:(?:\s*)(.*?)(?:\s*(?:\S:)|$)/i.exec(str)
  const t = /t:(?:\s*)(.*?)(?:\s*(?:\S:)|$)/i.exec(str)
  const s = /s:(?:\s*)(.*?)(?:\s*(?:\S:)|$)/i.exec(str)
  const res = {
    g: g ? g[1] : null,
    t: t ? t[1] : null,
    s: s ? s[1] : null,
  }
  log.debug(res, 'OPTIONS RESULTS')
  return res
}

const secondsSince = dateStr => {
  // 25200000 is 7 hours in milliseconds for the purposes of local testing with timezone differences
  const then = (new Date(dateStr)).getTime() - 25200000
  const now = Date.now()
  const seconds = Math.floor((now - then) / 1000)
  return seconds
}

const lastPlayed = (from, to, message) => {
  const options = parseOptions(message)
  const optionsQuery = [' WHERE ']

  if (Object.keys(options).some(x => options[x])) {
    if (options.g) optionsQuery.push(`\`activity\` LIKE '%${options.g}%'`)
    if (options.t) optionsQuery.push(`\`activity_type\` LIKE '%${options.t}%'`)
    if (options.s) optionsQuery.push(`\`streamer\` LIKE '%${options.s}%'`)
    if (optionsQuery.length > 2) optionsQuery.map((x, i) => (i > 0) ? ' AND ' + x : x)
  }

  const where = optionsQuery.length > 1 ? optionsQuery.join('') : ''

  const sql = `select * from sessions_view${where} limit 1`
  log.debug({ sql }, 'SQL QUERY RESULT')
  db.query({ sql }, (err, res) => {
    if (err) return log.error(err)
    log.debug({ res })
    if (!res.length) return null

    // DEBUG: REMOVE THIS LATER, it's a silencer so the bot can sit in #dopefish_lives and learn
    if (to === '#dopefish_lives') return null

    // TODO: FIX THIS ESLINT RULE, we don't need it on arrays
    // eslint-disable-next-line prefer-destructuring
    res = res[0]

    // `${to} Nobody has been playing anything for ${Math.floor(duration / 1000)}`
    // TODO: This needs to spit out time in a readable fashion
    const output = `${from}: ${res.streamer} streamed the ${res.activity_type} ${res.activity} for ${res.duration_in_seconds} seconds ${secondsSince(res.end_timestamp)} seconds ago`
    client.say(to, output)
  })
}

// const firstPlayed = (from, to, message) => {
//   return null
// }

// const totalPlayed = (from, to, message) => {
//   return null
// }

// const currentlyPlaying = (from, to, message) => {
//   return null
// }

const shutdown = (code = 0, reason = '') => {
  if (forceKill) {
    log.debug('!!! FORCING SHUTDOWN !!!')
    db.destroy()
    client.conn.destroy()
    process.exit(1)
  }
  log.debug({ reason }, 'Shutting Down')
  db.end(err => {
    if (err) log.error(err)
    log.debug('DB: Disconnected')
    client.disconnect((code === 0) ? 'Shutting Down' : 'Error', () => process.exit(code))
  })
  forceKill = true
}

// Command mapping
const commands = {
  'p': lastPlayed,
  'played': lastPlayed,
  'lastplayed': lastPlayed,
  'last': lastPlayed,
  // 'firstplayed': firstPlayed,
  // 'totalplayed': totalPlayed,
  // 'currentlyplaying': currentlyPlaying,
  'discord': linkDiscord,
  'ondemand': linkOnDemand,
  // 'playedtoday': playedToday,
}

/*
**  Event Listeners
*/

client.addListener('message', parseMessage)
client.addListener('topic', parseTopic)
client.addListener('registered', () => log.debug('Client connected...'))
client.addListener('error', err => shutdown(1, err))
process.on('SIGINT', () => shutdown())
process.on('uncaughtException', err => shutdown(1, err))

/*
**  Run
*/

log.debug('Connecting...')
db.connect(err => {
  if (err) return shutdown(1, err)
  log.debug(`DB: Connected as id ${db.threadId}`)
  client.connect()
})
