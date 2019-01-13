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
const ircConfig = config.get('ircConfig')
const dbConfig = config.get('dbConfig')
// const urlWords = config.get('meta.urlWords')
// const streamerAliases = config.get('meta.streamerAliases')
const topicTrackingChannels = config.get('meta.topicTrackingChannels')

/*
**  Initialization
*/

const db = mysql.createConnection(dbConfig)
const client = new Irc.Client('irc.quakenet.org', 'metasepia', ircConfig)
const log = Pino(pinoConfig)

const sessions = []

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
  const parsedCommand = /!(\S*)/.exec(message)
  const command = parsedCommand ? parsedCommand[1].toLowerCase() : ''
  if (to[0] === '#' && command) {
    if (commands.hasOwnProperty(command)) {
      log.debug({ command }, `Command parsed: ${command}`)
      commands[command](from, to, message)
    } else
      log.debug({ command }, `Unrecognized Command given: ${command}`)
  }
}

const linkDiscord = (from, to, message) => {
  client.say(to, 'https://discord.gg/meu4Jx')
}

const lastPlayed = (from, to, message) => {
  if (sessions.length < 2) return null
  const filteredSessions = sessions.filter(x => x.endTime)
  const session = filteredSessions[filteredSessions.length - 1]
  const duration = session.endTime - session.startTime
  const output = (!session.streamer)
    ? `${to} Nobody has been playing anything for ${Math.floor(duration / 1000)}`
    : `${to}, ${session.streamer} played ${session.activity} for ${Math.floor(duration / 1000)} seconds`
  client.say(to, output)
}

const firstPlayed = (from, to, message) => {
  return null
}

const totalPlayed = (from, to, message) => {
  return null
}

const currentlyPlaying = (from, to, message) => {
  return null
}

const shutdown = (code = 0, reason = '') => {
  if (forceKill) {
    log.debug('!!! FORCING SHUTDOWN !!!')
    db.destroy()
    client.conn.destroy()
    process.exit(1)
  }
  log.debug({ reason }, 'Shutting Down')
  const message = (code === 0) ? 'Shutting Down' : 'Error'
  db.end(err => {
    if (err) log.error(err)
    log.debug('DB: Disconnected')
    client.disconnect(message, () => process.exit(code))
  })
  forceKill = true
}

// Command mapping
const commands = {
  'p': lastPlayed,
  'played': lastPlayed,
  'lastplayed': lastPlayed,
  'firstplayed': firstPlayed,
  'totalplayed': totalPlayed,
  'currentlyplaying': currentlyPlaying,
  'discord': linkDiscord,
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
