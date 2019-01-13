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
  channels: [
    '#skwid',
    /* Copied over from GoaLitium's snippets */
    // '#dopefish_lives',
    // '#freamonsmind',
    // '#weeklyweebshit',
    // '#dopelives.fi',
    // '#dopefish_agdq',
    // '#dopefish_sgdq',
    // '#dopefish_gdq',
  ],
  username: 'Metasepia',
  realName: 'Metasepia Pfefferi',
  autoRejoin: true,
  floodProtection: true,
  autoConnect: false,
}

const urlWords = [
  'http://www.hitbox.tv/',
  'http://www.hitbox.tv/embed/',
  'www.hitbox.tv/',
  'www.hitbox.tv/embed/',
  'http://hitbox.tv/',
  'http://hitbox.tv/embed/',
  'http://www.twitch.tv/',
  'www.twitch.tv/',
  'http://www.livestream.com/',
  'www.livestream.com/',
  'http://www.ustream.com/channel/',
  'www.ustream.com/channel/',
]

const streamerAliases = [
  ['dopefish', 'dopefish_lives', 'dope', 'laddergoat'],
  ['arch', 'a', 'a-', 'a_'],
  ['boomer', 'booom3', 'booom', 'iron_boomer'],
  ['soulSilver', 'soul'],
  ['sir_Andersen', 'sirandersen', 'andersen', 'sir andersen'],
  ['qipz', 'chips'],
  ['flippinKamikaze', 'flippin', 'kamikaze', 'flip'],
  ['ramstrong', 'ram'],
  ['po_', 'po',],
  ['lexi', 'lexitheswift'],
  ['lewishM', 'lewish', 'animeWeedLord'],
  ['fateweaver', 'splitweaver',],
  ['fgw_wolf', 'fgwwolf', 'wolf'],
  ['derpfoot', 'foot'],
  ['i-h', 'ih', 'ironheart', 'I-HBot'],
  ['ratix', 'www', 'warau'],
  ['suitepee', 'suite', 'pee'],
  ['ska', 'butts', 'sittits'],
  ['q', '???', 'cue', 'mystery'],
  ['jimmy', 'did nothing wrong'],
  ['hitman_spike', 'hitman', 'spike'],
  ['darkZoma', 'zoma'],
  ['greenMiscreant', 'greene', 'tutturuu'],
  ['skwid', 'mcskwid'],
  ['qeird', 'meryl', 'futa', 'futanari'],
  ['rumia', 'rumiapilkington', 'circle nine', 'circle9'],
  ['danofthetubes', 'dan'],
  ['gutsmansass', 'guts', 'gutsman', 'gutsmang'],
]

/*
**  Initialization
*/

const client = new Irc.Client('irc.quakenet.org', 'metasepia', ircConfig)
const log = Pino(pinoConfig)

let currentSessionId = 0
const sessions = []

/*
**  Functions
*/

/*
** SQL COMMANDS
** LastPlayed: select * from sessions_view limit 1
** FirstPlayed: select * from sessions_view order by session_id asc limit 1
** TotalPlayed:
**
** Unmapped Activities Count: select COUNT(activity_raw) as `Unmapped Activities Count` from activities_mapping where ISNULL(fk_activity_types)
**
** Start session: call newSession(streamer, activity, raw_topic, activity_type)
** Start session returns session_id and will call endSession() before starting a new one
** End session: call endSession()
*/

const parseTopic = (channel, topic, nick, message) => {
  // Short circuit if we get a topic message from a source OTHER than a user
  if (message.command !== 'TOPIC') return null
  log.debug('Topic Change Detected:', topic)

  // Begin actual parsing
  // These regexes are going to need a lot of work...
  const streamer = getStreamers(topic)
  const game = getActivity('game', topic)
  log.debug({ streamer, game })

  endSession(currentSessionId)
  currentSessionId = startSession(streamer, 'game', game, Date.now(), topic)
}

const startSession = (streamers, activityType, activity, startTime, topicString) => {
  log.debug('Attempting to start session...')
  const id = currentSessionId += 1
  const session = {
    id,
    streamer: streamers,
    activityType,
    activity,
    startTime,
    endTime: null,
    topicString,
  }
  log.debug(session, 'Starting session:')
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
  log.debug('Getting Streamers...')
  const streamer = /Streamers?:\s?(.*?)\s?\|/.exec(str)
  log.debug('Found:', streamer)
  return streamer[1]
}

const getActivityType = str => {
  return str
}

const getActivity = (type, str) => {
  log.debug('Getting Activity...')
  const activity = /Game:\s?(.*?)\s?(\||$)/.exec(str)
  log.debug('Found:', activity)
  return activity[1]
}

const parseMessage = (from, to, message) => {
  log.debug(from, to, message)
  // eslint-disable-next-line prefer-destructuring
  const parsedCommand = /!(\S*)/.exec(message)
  const command = parsedCommand ? parsedCommand[1].toLowerCase() : ''
  if (to[0] === '#' && command) {
    if (commands.hasOwnProperty(command))
      commands[command](from, to, message)
    else
      client.say(to, 'I\'m sorry but I do not recognize that command.')
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

const list = (from, to, message) => {
  log.debug({ sessions }, 'Sessions dump:')
}

const shutdown = (code = 0, reason = '') => {
  log.debug('Shutting Down', reason)
  const message = (code === 0) ? 'Shutting Down' : 'Error'
  client.disconnect(message, () => process.exit(code))
}

// Command mapping
const commands = {
  'p': lastPlayed,
  'played': lastPlayed,
  'lastplayed': lastPlayed,
  'firstplayed': firstPlayed,
  'totalplayed': totalPlayed,
  'currentlyplaying': currentlyPlaying,
  'l': list,
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
client.connect()
