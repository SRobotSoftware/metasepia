// TODO: Move config to actual configuration, convict?

const Irc = require('irc')
const Pino = require('pino')

const pinoConfig = {
  level: 'debug',
}

const ircConfig = {
  channels: ['#skwid'],
  username: 'Metasepia',
  realName: 'Metasepia Pfefferi',
  autoRejoin: true,
  floodProtection: true,
  autoConnect: false,
}

const client = new Irc.Client('irc.quakenet.org', 'metasepia', ircConfig)
const log = Pino(pinoConfig)

const parseTopic = (channel, topic, nick, message) => {
  // Short circuit if we get a topic message from a source OTHER than a user
  if (message.command !== 'TOPIC') return null

  // DEBUGGING STATEMENT
  log.debug('Topic Change Detected:', topic)

  // Begin actual parsing
  // These regexes are going to need a lot of work...
  const streamer = /Streamer:(.*?)\|/.exec(topic)
  const game = /Game:(.*?)(\||$)/.exec(topic)

  // DEBUGGING STATEMENT
  log.debug(streamer[1], game[1])
}

const parseMessage = (from, to, message) => {
  log.debug(from, to, message)
  // eslint-disable-next-line prefer-destructuring
  const parsedCommand = /!(\S*)/.exec(message)
  const command = parsedCommand ? parsedCommand[1].toLowerCase() : ''
  if (to[0] === '#') {
    if (command === 'played' || command === 'p')
      client.say(to, command)
  }
}

const shutdown = (code = 0, reason = '') => {
  log.debug('Shutting Down', reason)
  const message = (code === 0) ? 'Shutting Down' : 'Error'
  client.disconnect(message, () => process.exit(code))
}

client.addListener('message', parseMessage)
client.addListener('topic', parseTopic)
client.addListener('registered', () => log.debug('Client connected...'))
client.addListener('error', err => shutdown(1, err))
process.on('SIGINT', () => shutdown())
process.on('uncaughtException', err => shutdown(1, err))

client.connect()
