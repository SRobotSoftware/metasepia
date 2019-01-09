const irc = require('irc')

const config = {
  channels: ['#skwid'],
  username: 'Metasepia',
  realName: 'Metasepia Pfefferi',
  autoRejoin: true,
  floodProtection: true,
  autoConnect: false,
}

const client = new irc.Client('irc.quakenet.org', 'metasepia', config)

const shutdown = (code = 0, reason = '') => {
  console.log('Shutting Down', reason)
  const message = (code === 0) ? 'Shutting Down' : 'Error'
  client.disconnect(message, () => process.exit(code))
}

client.addListener('message', (from, to, message) => {
  console.log(from, to, message)
  // eslint-disable-next-line prefer-destructuring
  const parsedCommand = /!(\S*)/.exec(message)
  const command = parsedCommand ? parsedCommand[1].toLowerCase() : ''
  if (to[0] === '#') {
    if (command === 'played' || command === 'p')
      client.say(to, command)
  }
})

client.addListener('topic', (channel, topic, nick, message) => {
  if (message.command !== 'TOPIC') return null
  console.log('Topic Change Detected:', topic)
  const streamer = /Streamer:(.*?)\|/.exec(topic)
  const game = /Game:(.*?)(\||$)/.exec(topic)
  console.log(streamer[1], game[1])
})

client.addListener('registered', () => {
  console.log('Client connected...')
})

client.addListener('error', err => shutdown(1, err))

process.on('SIGINT', () => shutdown())
process.on('uncaughtException', err => shutdown(1, err))

client.connect()
