/*
**  Requires
*/

const Irc = require('irc')
const Pino = require('pino')
const config = require('config')
const knex = require('knex')
const moment = require('moment-timezone')
const Chance = require('chance')
const Discord = require('discord.js')
const express = require('express')
const helmet = require('helmet')

/*
**  Config
*/

const pinoConfig = config.get('pinoConfig')
const ircConfig = config.get('irc')
const dbConfig = config.get('dbConfig')
const discordConfig = config.get('discord')
const apiConfig = config.get('api')
const {
  streamerAliases,
  topicTrackingChannels,
  topicTrackingChannelsDiscord,
  silentChannels,
  commandPrefix,
  longbowAdvice,
} = config.get('meta')

/*
**  Initialization
*/

const log = Pino(pinoConfig)
const client = new Irc.Client(ircConfig.server, ircConfig.name, ircConfig.config)
const db = knex(dbConfig)
moment.tz.setDefault('Etc/GMT')
const chance = new Chance()
const discord = new Discord.Client()
const api = express()

// Killswitch for when things get hung up, ctrl+c twice to hit it
let forceKill = false

/*
**  Functions
*/

const fixNick = () => {
  if (client.nick !== ircConfig.name) {
    client.send('nick', ircConfig.name)
    setTimeout(() => fixNick(), 1000 * 60)
  }
}

const escapeRegex = str => str.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')

const hasNotNull = (obj, prop) => {
  return obj && typeof obj === 'object' && obj.hasOwnProperty(prop) && obj[prop]
}

const mangleNick = nick => {
  let mangled = false
  const mangleMap = {
    'a': '\u00E0',
    'c': '\u00E7',
    'e': '\u00E8',
    'i': '\u00EC',
    'n': '\u00F1',
    'o': '\u00F2',
    'u': '\u00F9',
    'y': '\u00FD',
    'A': '\u00C0',
    'C': '\u00C7',
    'D': '\u00D0',
    'E': '\u00C8',
    'I': '\u00CC',
    'N': '\u00D1',
    'O': '\u00D2',
    'U': '\u00D9',
    'Y': '\u00DD',
  }

  return nick
    .split('')
    .map(char => {
      if (mangled) return char
      const mangleKey = Object.keys(mangleMap).find(key => char === key)
      if (mangleKey) {
        mangled = true
        return mangleMap[mangleKey]
      }
      return char
    })
    .join('')
}

const findAndMangleNicks = str => {
  const aliases = streamerAliases
    .reduce((p, c) => p.concat(c), [])
    .map(x => escapeRegex(x))
    .join('|')
  const search = new RegExp(`\\b(?:${aliases})\\b`, 'gi')
  const matches = []
  let res = search.exec(str)

  while (res) {
    matches.push(res[0])
    res = search.exec(str)
  }

  matches.forEach(nick => {
    str = str.replace(new RegExp(`\\b${nick}\\b`), mangleNick(nick))
  })

  return str
}

const parseTopic = (channel, topic, nick, message) => {
  // Short circuit if we get a topic message from a channel we don't care about
  if (!topicTrackingChannels.some(x => x === channel)) return null
  // Short circuit if we get a topic message from a source OTHER than a user
  if (message.command !== 'TOPIC') return null

  log.info('Topic Change Detected:', topic)
  setPresence()

  const streamers = getStreamers(topic)
  const activityType = getActivityType(topic)
  const activity = getActivity(activityType, topic)

  if (streamers && activity)
    startSession(streamers, activityType, activity, topic)
  else
    endSession()

  // setDiscordTopic(topic)
}

const parseDiscordTopic = e => {
  log.info('Topic Change Detected:', topic)
  const { topic, name } = e
  if (!topicTrackingChannelsDiscord.some(x => x === name)) return null

  setPresence()

  const streamers = getStreamers(topic)
  const activityType = getActivityType(topic)
  const activity = getActivity(activityType, topic)

  if (streamers && activity)
    startSession(streamers, activityType, activity, topic)
  else
    endSession()

  // setIRCTopic(topic)
}

const setIRCTopic = topic => {
  log.info('CHANGING TOPIC', { topic })
  topicTrackingChannels.forEach(channel => client.send('topic', channel, topic))
}

const setDiscordTopic = topic => {
  log.info('CHANGING TOPIC', { channels: Object.keys(discord.channels), topic })
  topicTrackingChannelsDiscord.forEach(x => discord.channels[x].setTopic(topic))
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
  db.raw('call newSession(?, ?, ?, ?)', [streamers, activity, topicString, activityType])
    .then(res => {
      const sessionId = res[0][0].session_id
      log.debug({ sessionId }, 'Session successfully started')
    })
    .catch(err => {
      log.error(err)
    })
}

const endSession = () => {
  log.debug('Ending session')
  db.raw('call endSession()')
    .then(res => log.debug({ results: res }, 'Session successfully ended'))
    .catch(err => log.error(err))
}

const getStreamers = str => {
  log.debug('Getting Streamers...')
  const streamers = /streamers?:(?:\s*)(.*?)(?:\s*)\|/i.exec(str)
  log.debug({ streamers }, 'STREAMERS RESULT')
  return streamers[1].toLowerCase()
}

const getActivityType = str => {
  log.debug('Getting Activity Type...')
  const activityType = /\|(?:\s*)(\S+)(?:\s*):/.exec(str)
  log.debug({ activityType }, 'ACTIVITY TYPE RESULT')
  return activityType[1].toLowerCase()
}

const getActivity = (type, str) => {
  log.debug('Getting Activity...')
  const activity = (new RegExp(`${type}:(?:\\s*)(.*?)(?:\\s*)(?:\\||$)`, 'i')).exec(str)
  log.debug({ activity }, 'ACTIVITY RESULT')
  return activity[1].toLowerCase()
}

const parseMessage = (from, to, message) => {
  log.debug(from, to, message)
  const parsedCommand = (new RegExp(`^${commandPrefix}(\\S*)`)).exec(message)
  let command = parsedCommand ? parsedCommand[1] : ''
  if ((to[0] === '#' || to === ircConfig.name) && from !== 'ii' && command) {
    if (to === ircConfig.name) to = from

    const opts = {
      leet: /leet/i.test(command),
      yell: command.replace(/[a-z]/g, '') === command,
      notice: false,
    }
    command = command
      .replace(/leet/i, '')
      .toLowerCase()

    command = (commands.hasOwnProperty(command)) ? command : Object.keys(commands)
      .filter(x => x[x.length - 1] === '*')
      .map(x => x.substr(0, x.length - 1))
      .find(x => command.search(x) >= 0) + '*' || command

    if (commands.hasOwnProperty(command)) {
      log.debug({ command }, `Command parsed: ${command}`)
      commands[command](from, to, message, opts)
    } else
      log.debug({ command }, `Unrecognized Command given: ${command}`)
  }
}

const parseDiscordMessage = message => {
  const from = message.member.nickname || message.author.username
  const to = message.channel.name
  const content = message.cleanContent
  const channel = {
    name: message.channel.name,
    topic: message.channel.topic,
    guild: message.channel.guild.name
  }
  log.info({ from, content, channel })

  if (from === 'dopelives-irc' || message.author.bot) return

  processDiscordTriggers(from, to, content, { discord: message })

  const parsedCommand = (new RegExp(`^${commandPrefix}(\\S*)`)).exec(content)
  let command = parsedCommand ? parsedCommand[1] : ''
  if (command) {
    const opts = {
      leet: /leet/i.test(command),
      yell: command.replace(/[a-z]/g, '') === command,
      notice: false,
      discord: message,
    }
    command = command
      .replace(/leet/i, '')
      .toLowerCase()

    command = (commands.hasOwnProperty(command)) ? command : Object.keys(commands)
      .filter(x => x[x.length - 1] === '*')
      .map(x => x.substr(0, x.length - 1))
      .find(x => command.search(x) >= 0) + '*' || command

    if (commands.hasOwnProperty(command)) {
      log.debug({ command }, `Command parsed: ${command}`)
      commands[command](from, to, message, opts)
    }
  }
}

const processDiscordTriggers = (from, to, content, opts) => {
  if (/bully/i.test(content)) {
    const emoji = opts.discord.guild.emojis.find(emoji => emoji.name === 'nostreams') || '🙅'
    opts.discord.react(emoji).catch(e => log.error({ e }))
    // linkBully(from, to, content, opts)
  }
  if (/smug/i.test(content)) {
    const emoji = opts.discord.guild.emojis.find(e => e.name === 'smug') || '😏'
    opts.discord.react(emoji).catch(e => log.error({ e }))
  }
}

const parseNames = (channel, nicks) => {
  log.debug({ channel, nicks }, 'NAMES EVENT RECEIVED')
}

const linkFunc = link => (from, to, message, opts) => {
  delete opts.leet
  send(to, `${from}: ${link}`, opts)
}

const linkDiscord = linkFunc('https://discord.gg/R7cazz8')
const linkOnDemand = linkFunc('https://vacker.tv/ondemand/')
const linkWebDB = linkFunc('https://played.vacker.tv/')
const linkYT = linkFunc('https://www.youtube.com/user/Dopelives')
const linkBingo = linkFunc('Get your BINGO card and play along at: https://skabingo.neocities.org/')
const linkNext = linkFunc('https://www.youtube.com/watch?v=4VXQSs1Qfcc')
const linkAnniversary = linkFunc('nonono, happy skanniversary to you!')
const linkBully = linkFunc('Don\'t bully!')
const linkRules = linkFunc('https://dopelives.com/newfriend.html')
const linkVacker = linkFunc('https://vacker.tv/')
const linkSource = linkFunc('https://github.com/StupidRobotClub/metasepia')

const larryHelp = (from, to, message, opts) => {
  const advice = chance.pickone(longbowAdvice)
  send(to, `\u001D_${findAndMangleNicks(advice)}_`, opts)
}

const parseOptions = str => {
  // g: activity
  // t: type
  // s: streamer
  // e: exclusion (from activity)
  // i: how many entries back (only used in lastPlayed)
  const g = /g:(?:\s*)([\w\d\s&%$#@!*()_,+=[\]{}'"./\\-]*?)(?:[\W]*)(?:(?:[gtse]:)|$)/i.exec(str)
  const t = /t:(?:\s*)([\w\d\s-]*?)(?:[\W]*)(?:(?:[gtse]:)|$)/i.exec(str)
  const s = /s:(?:\s*)([\w\d\s-]*?)(?:[\W]*)(?:(?:[gtse]:)|$)/i.exec(str)
  const e = /e:(?:\s*)([\w\d\s&%$#@!*()_,+=[\]{}'"./\\-]*?)(?:[\W]*)(?:(?:[gtse]:)|$)/i.exec(str)
  const i = /(?:(?:p(?:layed)?)|(?:l(?:.*?(?:ast)|(?:played))?))(?:\s*)-(\d+)/.exec(str)
  const res = {
    g: g ? g[1] : null,
    t: t ? t[1] : null,
    s: s ? s[1] : null,
    e: e ? e[1].split(/(?:\s*)(?:([\w\d\s&%$#@!*()_-]*),?)/).filter(x => x !== '') : null,
    i: i ? i[1] : null,
  }
  log.debug(res, 'OPTIONS RESULTS')
  return res
}

const playedConstructor = options => {
  const query = db.select()
    .from('sessions_view')
    .where(builder => {
      if (options.g) builder.andWhere('activity', 'LIKE', `%${options.g}%`)
      if (options.e) builder.andWhere(builder => {
        options.e.forEach(exclusion => {
          builder.andWhere('activity', 'NOT LIKE', `%${exclusion}%`)
        })
      })
      if (options.t) builder.andWhere('activity_type', 'LIKE', `%${options.t}%`)
      if (options.s) builder.andWhere(builder => {
        const aliases = streamerAliases.find(x => x.some(y => y.toLowerCase() === options.s))
        if (aliases) aliases.forEach(alias => builder.orWhere('streamer', 'RLIKE', `[[:<:]]${alias}[[:>:]]`))
        else builder.andWhere('streamer', 'RLIKE', `[[:<:]]${options.s}[[:>:]]`)
      })
    })
  log.debug({ query: query.toString() }, 'CONSTRUCTED QUERY')

  return query
}

const parseTime = duration => {
  const durationDays = Math.floor(duration.asDays())
  duration.subtract(durationDays, 'days')
  const durationHours = Math.floor(duration.asHours())
  duration.subtract(durationHours, 'hours')
  const durationMinutes = Math.floor(duration.asMinutes())

  return [durationDays, durationHours, durationMinutes].reduce((p, c, i) => {
    if (i === 0 && c > 0) p += `${c} day${c > 1 ? 's' : ''} `
    else if (i === 1 && (c > 0 || p.length > 0)) p += `${c} hour${c > 1 ? 's' : ''} and `
    else if (i === 2) p += `${c} minute${c > 1 ? 's' : ''}`
    return p
  }, '')
}

const playedConstructorRandom = () => db.select()
  .from('sessions_view')
  .whereNotNull('end_timestamp')
  .orderByRaw('RAND()')
  .limit(1)

const fakePlayed = (from, to, message, opts) => {
  const name = /\w+(.*)/i.exec(message)[1] || 'nobody'
  // db.raw(`select * from sessions_view where end_timestamp IS NOT NULL order by session_id`)
  const query = playedConstructorRandom()

  query
    .then(res => {
      res = res[0]
      const duration = moment.duration(res.duration_in_seconds, 'seconds')
      const output = findAndMangleNicks(`${name} has been playing ${res.activity} for ${parseTime(duration)}`)
      send(to, output, opts)
    })
    .catch(err => log.error(err))
}

const randomPlayed = (from, to, message, opts) => {
  const query = playedConstructorRandom()

  query
    .then(res => {
      res = res[0]
      const duration = moment.duration(res.duration_in_seconds, 'seconds')
      const output = findAndMangleNicks(`${res.streamer} has been streaming the ${res.activity_type} ${res.activity} for ${parseTime(duration)}`)
      send(to, `${from}: ${output}`, opts)
    })
    .catch(err => log.error(err))
}

const stream = (from, to, message, opts) => {
  const query = playedConstructorRandom()
  const feeling = chance.pickone([
    'happy',
    'sad',
    'glad',
    'mad',
    'apathetic',
    'furious',
    'so mad!',
    'insane!',
    'cool.',
    'hate everything',
    'love everybody',
    'want to kick ass!',
    'feel bad',
  ])

  query
    .then(res => {
      res = res[0]
      const output = findAndMangleNicks(`rememeber when ${res.streamer} streamed the ${res.activity_type} ${res.activity}? That stream made me ${feeling}`)
      send(to, `Hey ${from}, ${output}`, opts)
    })
    .catch(err => log.error(err))
}

const lastPlayed = (from, to, message, opts) => {
  const options = parseOptions(message)

  playedConstructor(options)
    .limit(options.i + 1 || 1)
    .whereNotNull('end_timestamp')
    .then(res => {
      if (!res.length) {
        send(to, `I didn't find any results for "${message}"`)
        return null
      }
      res = res[Math.min(options.i, res.length - 1) || 0]
      const duration = moment.duration(res.duration_in_seconds, 'seconds')
      const preOutput = `${res.streamer} streamed the ${res.activity_type} ${res.activity} for ${parseTime(duration)}, about ${moment(res.end_timestamp).fromNow()}`
      const output = `${from}: ${findAndMangleNicks(preOutput)}`
      send(to, output, opts)
    })
    .catch(err => log.error(err))
}

const firstPlayed = (from, to, message, opts) => {
  const options = parseOptions(message)

  playedConstructor(options)
    .limit(1)
    .whereNotNull('end_timestamp')
    .orderBy('session_id', 'ASC')
    .then(res => {
      if (!res.length) {
        send(to, `I didn't find any results for "${message}"`, opts)
        return null
      }
      res = res[0]
      const duration = moment.duration(res.duration_in_seconds, 'seconds')
      const preOutput = `${res.streamer} first streamed the ${res.activity_type} ${res.activity} for ${parseTime(duration)}, about ${moment(res.end_timestamp).fromNow()}`
      const output = `${from}: ${findAndMangleNicks(preOutput)}`
      send(to, output, opts)
    })
    .catch(err => log.error(err))
  return null
}

const totalPlayed = (from, to, message, opts) => {
  const options = parseOptions(message)
  const searchQuery = playedConstructor(options)

  db
    .raw('SET SQL_MODE=\'ALLOW_INVALID_DATES\'')
    .then(() => db.raw('drop temporary table if exists totalgames'))
    .then(() => db.raw(searchQuery.toString()).wrap('create temporary table totalgames(primary key(session_id))'))
    .then(() => db.raw('select start_timestamp into @st from totalgames order by session_id asc limit 1'))
    .then(() => db.raw('select end_timestamp into @en from totalgames order by session_id desc limit 1'))
    .then(() => db.raw('select streamer into @str from totalgames order by session_id desc limit 1'))
    .then(() => db.raw('select sum(duration_in_seconds) into @dur from totalgames'))
    .then(() => db.raw('select @st as start_timestamp, @en as end_timestamp, @str as streamer, @dur as duration_in_seconds'))
    .then(res => {
      res = res[0][0]
      const durationText = parseTime(moment.duration(res.duration_in_seconds, 'seconds'))
      const output = `${from}: ${findAndMangleNicks(options.g || 'something')} was last streamed by ${findAndMangleNicks(res.streamer)} ${moment(res.end_timestamp).fromNow()}, was first streamed ${moment(res.start_timestamp).fromNow()}, and has been streamed for a total of ${durationText}.`
      send(to, output, opts)
    })
    .catch(err => log.error(err))

  return null
}

const currentlyPlaying = (from, to, message, opts) => {
  db.select()
    .from('sessions_view')
    .limit(1)
    .then(res => {
      if (!res.length) {
        send(to, `Sorry ${from}, it looks to me like nobody's ever streamed.`, opts)
        return null
      }

      res = res[0]

      const duration = moment.duration(moment().diff(moment(res.start_timestamp), 'milliseconds'), 'milliseconds')
      const response = (res.end_timestamp) ? 'Nobody is currently streaming.' : `${res.streamer} has been streaming the ${res.activity_type} ${res.activity} for ${parseTime(duration)}`
      const output = `${from}: ${findAndMangleNicks(response)}`
      send(to, output, opts)
    })
    .catch(err => log.error(err))
}

const playedToday = (from, to, message, opts) => {
  db.select()
    .from('sessions_view')
    .where('start_timestamp', '>', moment().subtract('24', 'hours').format('Y-MM-DD kk:mm:ss'))
    .then(res => {
      if (!res.length) {
        send(to, `Sorry ${from}, it looks like nobody's streamed in the last 24 hours.`, opts)
        return null
      }
      const streamers = res.map(x => x.streamer).join(', ')
      const duration = moment.duration(res.reduce((p, c) => p += c.duration_in_seconds, 0), 'seconds')
      const preOutput = `found ${res.length} streams (${streamers}), totalling ${parseTime(duration)}.`
      const output = `${from}: ${findAndMangleNicks(preOutput)}`
      send(to, output, opts)
    })
    .catch(err => log.error(err))
}

const leet = str => str
  .replace(/a/ig, '4')
  .replace(/b/g, '6')
  .replace(/e/ig, '3')
  .replace(/g/g, '9')
  .replace(/[iIl]/g, '1')
  .replace(/o/ig, '0')
  .replace(/s/ig, '5')
  .replace(/t/ig, '7')
  .replace(/z/ig, '2')

// For legacy commands
const leetCommand = func => (from, to, message) => func(from, to, message, { leet: true })

const yell = str => `**\u0002${str.toUpperCase()}**`

const send = (to, message, opts) => {
  // Valid options:
  // {
  //   notice: false,
  //   leet: false,
  //   yell: false,
  // }
  if (hasNotNull(opts, 'notice')) return client.notice(to, message)
  if (silentChannels.some(channel => channel === to)) return null

  // Fun things!
  if (hasNotNull(opts, 'leet')) message = leet(message)
  if (hasNotNull(opts, 'yell')) message = yell(message)

  if (opts.hasOwnProperty('discord') && opts.discord) {
    opts.discord.channel.send(message)
  } else
    client.say(to, message)
}

const setPresence = () => {
  const { topic } = discord.channels.find(x => x.name === 'stream-irc')
  const streamers = getStreamers(topic)
  const activityType = getActivityType(topic)
  const activity = getActivity(activityType, topic)
  const online = {
    game: {
      name: `${streamers} stream ${activity}`,
      type: 'WATCHING'
    },
    status: 'online'
  }
  const offline = {
    game: {
      name: 'with bits and bytes',
      type: 'PLAYING'
    },
    status: 'idle'
  }
  const status = (streamers && activity) ? online : offline
  discord.user.setPresence(status)
}

const shutdown = (code = 0, reason = '') => {
  if (forceKill) {
    log.error('!!! FORCING SHUTDOWN !!!')
    client.conn.destroy()
    process.exit(1)
  }
  log.warn({ reason }, 'Shutting Down')
  discord.destroy()
    .then(() => {
      client.disconnect((code === 0) ? 'Shutting Down' : 'Error', () => process.exit(code))
      process.exit(0)
    })
    .catch(e => {
      log.error(e)
      process.exit(1)
    })
  forceKill = true
}

// Command mapping
const commands = {
  'l': lastPlayed,
  'last': lastPlayed,
  'lastplayed': lastPlayed,
  'p': lastPlayed,
  'played': lastPlayed,
  'f': firstPlayed,
  'first': firstPlayed,
  'firstplayed': firstPlayed,
  't': totalPlayed,
  'total': totalPlayed,
  'totalplayed': totalPlayed,
  'c': currentlyPlaying,
  'current': currentlyPlaying,
  'currentlyplaying': currentlyPlaying,
  'disco': linkDiscord,
  'discord': linkDiscord,
  'ondemand': linkOnDemand,
  'vod': linkOnDemand,
  'db': linkWebDB,
  'web': linkWebDB,
  'playedweb': linkWebDB,
  'yt': linkYT,
  'youtube': linkYT,
  'today': playedToday,
  'playedtoday': playedToday,

  // Larry
  'larry*': larryHelp,
  'larrylongbow*': larryHelp,
  'longbow*': larryHelp,
  'wwld*': larryHelp,

  // Ska
  'bingo': linkBingo,
  'skabingo': linkBingo,
  'anniversary': linkAnniversary,

  // Other
  'bully': linkBully,
  'vacker': linkVacker,
  'servers': linkVacker,
  'rules': linkRules,
  'newfriend': linkRules,
  'source': linkSource,
  'stream*': stream,
  'nostalgia*': stream,

  // LEGACY
  'f1r57p14y3d': leetCommand(firstPlayed),
  'pl4y3d': leetCommand(lastPlayed),
  'p14y3d': leetCommand(lastPlayed),
  'l457p14y3d': leetCommand(lastPlayed),
  '1457p14y3d': leetCommand(lastPlayed),
  'played24h': playedToday,
  'todayplayed': playedToday,
  'nextplayed': linkNext,
  'notrealplayed': fakePlayed,
  'prayed': fakePlayed,
  'piayed': fakePlayed,
  'p1ayed': fakePlayed,
  'playedruse': fakePlayed,
  'fake': fakePlayed,
  'playedfake': fakePlayed,
  'r4nd0mp14y3d': leetCommand(randomPlayed),
  'randomplayed': randomPlayed,
  'random': randomPlayed,
  'nobody': randomPlayed, // Should actually be stuff like "no meme has been memed for ${randomDuration}"
  'nobodyplayed': randomPlayed,

  // WISDOM opt
  // "flying and shooting lasers and shit"
  // Not actually sure what this one does?
  // But add it as a modifier with the same setup as leet
  // my $com_lastplayedwisdomleet = "!p14y3dw15d0m";
  // my $com_lastplayedwisdom = "!lastplayedwisdom";
  // my $com_lastplayedwisdom2 = "!playedwisdom";
}

/*
**  Event Listeners
*/

client.addListener('message', parseMessage)
client.addListener('topic', parseTopic)
client.addListener('names', parseNames)
client.addListener('registered', () => log.info('Client connected...'))
client.addListener('error', err => shutdown(1, err))
process.on('SIGINT', () => shutdown())
process.on('uncaughtException', err => shutdown(1, err))
discord.on('ready', () => {
  log.info(`Logged in as ${discord.user.tag}!`)
  setPresence()
})
discord.on('message', parseDiscordMessage)
discord.on('channelUpdate', (p, c) => parseDiscordTopic(c))

/*
**  Run
*/
log.info('Connecting...')
db.raw('call countUnmappedActivities()')
  .then(res => {
    log.warn(res[0][0][0])
    discord.login(discordConfig.token)
    client.connect()
    apiSetup()
    fixNick()
  })
  .catch(err => {
    log.error(err)
    shutdown(1, err)
  })

const apiSetup = () => {
  api.use(helmet())
  api.get('/', (apiReq, apiRes) => {
    db.select()
      .from('sessions_view')
      .limit(1)
      .then(res => {
        if (!res.length) {
          res.status(500).send('Server Error')
          return null
        }

        res = res[0]

        const duration = moment.duration(moment().diff(moment(res.start_timestamp), 'milliseconds'), 'milliseconds')
        const result = {
          'streamer': (res.end_timestamp) ? '' : res.streamer,
          'activity': (res.end_timestamp) ? '' : res.activity,
          'activity_type': (res.end_timestamp) ? '' : res.activity_type,
          'duration': parseTime(duration),
          'stream_start': res.start_timestamp,
          'stream_end': res.end_timestamp,
          'is_live': !res.end_timestamp,
          'timestamp': Date.now(),
          // 'topicString': 'Streamer: | Game: | https://somelink.fuckit/idunno'
        }
        apiRes.json(result)
      })
      .catch(err => {
        apiRes.status(500).send('Server Error')
        log.error(err)
      })
  })
  api.listen(apiConfig.port, () => log.info(`Example app listening on port ${apiConfig.port}!`))
}
