/*
**  Requires
*/

const Irc = require('irc')
const Pino = require('pino')

/*
**  Config
*/

// TODO: Move config to actual configuration, convict?
const pinoConfig = {
  level: 'trace',
}

const ircConfig = {
  channels: ['#skwid'],
  username: 'Metasepia',
  realName: 'Metasepia Pfefferi',
  autoRejoin: true,
  floodProtection: true,
  autoConnect: false,
}

/*
**  Initialization
*/

const client = new Irc.Client('irc.quakenet.org', 'metasepia', ircConfig)
const log = Pino(pinoConfig)
const parseLog = log.child('Parsed')

let currentSessionId = 0
const sessions = []

/*
**  Functions
*/

const parseTopic = (channel, topic, nick, message) => {
  // Short circuit if we get a topic message from a source OTHER than a user
  if (message.command !== 'TOPIC') return null
  parseLog.debug('Topic Change Detected:', topic)

  // Begin actual parsing
  // These regexes are going to need a lot of work...
  const streamer = getStreamers(topic)
  const game = getActivity('game', topic)
  parseLog.debug({ streamer, game })

  endSession(currentSessionId)
  currentSessionId = startSession(streamer, game, Date.now())
}

const startSession = (streamers, activityType, activity, startTime) => {
  log.debug('Attempting to start session...')
  const id = currentSessionId += 1
  const session = {
    id,
    streamer: streamers,
    activityType,
    activity,
    startTime,
    endTime: null,
  }
  parseLog.debug(session, 'Starting session:')
  sessions.push(session)
  return id
}

const endSession = id => {
  log.debug('Ending session:', id, '...')
  if (id === 0) return null
  const session = sessions.find(x => x.id === id)
  if (session.endTime === null) session.endTime = Date.now()
}

const getStreamers = str => {
  parseLog.debug('Getting Streamers...')
  const streamer = /Streamer:(.*?)\|/.exec(str)
  parseLog.debug('Found:', streamer)
  return streamer[1]
}

const getActivityType = str => {
  return str
}

const getActivity = (type, str) => {
  parseLog.debug('Getting Activity...')
  const activity = /Game:(.*?)(\||$)/.exec(str)
  parseLog.debug('Found:', activity)
  return activity[1]
}

const parseMessage = (from, to, message) => {
  parseLog.debug(from, to, message)
  // eslint-disable-next-line prefer-destructuring
  const parsedCommand = /!(\S*)/.exec(message)
  const command = parsedCommand ? parsedCommand[1].toLowerCase() : ''
  if (to[0] === '#') {
    if (command === 'played' || command === 'p') {
      client.say(to, command)
      parseLog.debug({ sessions }, 'Sessions dump:')
    }
  }
}

const shutdown = (code = 0, reason = '') => {
  log.debug('Shutting Down', reason)
  const message = (code === 0) ? 'Shutting Down' : 'Error'
  client.disconnect(message, () => process.exit(code))
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
client.connect()
